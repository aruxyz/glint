use std::path::Path;

use crate::models::{AspectMode, AudioTrackMix, ExportPreset};

pub(crate) const LOUDNORM_FILTER: &str = "loudnorm=I=-16:TP=-1.5:LRA=11";

#[derive(Debug, Clone, PartialEq)]
pub struct BitratePlan {
    pub effective_mb: f64,
    pub duration_sec: f64,
    pub video_kbps: i64,
    pub audio_kbps: i64,
    pub downscale_720p: bool,
    pub too_long_warning: bool,
}

enum VideoFilterMode {
    None,
    SimpleVf(String),
    VerticalBlur916 { stretch_fg: bool },
}

pub fn calculate_discord_bitrate(
    preset: ExportPreset,
    duration_sec: f64,
    src_height: i32,
    has_active_audio: bool,
) -> Option<BitratePlan> {
    let effective_mb = match preset {
        ExportPreset::Discord10mb => 9.2,
        ExportPreset::Discord25mb => 24.0,
        ExportPreset::LosslessTrim
        | ExportPreset::VerticalBlur916
        | ExportPreset::VerticalCrop916 => return None,
    };

    let d = duration_sec.max(0.5);
    let audio_kbps = if !has_active_audio {
        0
    } else if d > 45.0 {
        96
    } else {
        128
    };

    let total_kbits = effective_mb * 8192.0;
    let raw_video_kbps = (total_kbits / d).floor() as i64 - audio_kbps;
    let downscale_720p = raw_video_kbps < 1200 && src_height > 720;
    let too_long_warning = raw_video_kbps < 600;
    let video_kbps = raw_video_kbps.max(150);

    Some(BitratePlan {
        effective_mb,
        duration_sec: d,
        video_kbps,
        audio_kbps,
        downscale_720p,
        too_long_warning,
    })
}

pub fn discord_limit_bytes(preset: ExportPreset) -> Option<i64> {
    match preset {
        ExportPreset::Discord10mb => Some(10 * 1024 * 1024),
        ExportPreset::Discord25mb => Some(25 * 1024 * 1024),
        ExportPreset::LosslessTrim
        | ExportPreset::VerticalBlur916
        | ExportPreset::VerticalCrop916 => None,
    }
}

pub fn scale_bitrate_plan_for_overshoot(
    plan: &BitratePlan,
    limit_bytes: i64,
    actual_size: i64,
    src_height: i32,
) -> Option<BitratePlan> {
    if limit_bytes <= 0 || actual_size <= 0 {
        return None;
    }
    let scale = ((limit_bytes as f64 / actual_size as f64) * 0.88).clamp(0.45, 0.90);
    let scaled_kbps = ((plan.video_kbps as f64) * scale).floor() as i64;
    if scaled_kbps < 150 {
        return None;
    }

    Some(BitratePlan {
        effective_mb: plan.effective_mb,
        duration_sec: plan.duration_sec,
        video_kbps: scaled_kbps,
        audio_kbps: plan.audio_kbps,
        downscale_720p: plan.downscale_720p || (scaled_kbps < 1200 && src_height > 720),
        too_long_warning: scaled_kbps < 600,
    })
}

pub fn validate_export_plan(preset: ExportPreset, plan: &BitratePlan) -> Result<(), String> {
    if preset == ExportPreset::Discord10mb && plan.too_long_warning {
        return Err(format!(
            "Clip is too long for 10 MB Discord export (estimated video bitrate {} kbps is below 600 kbps). Trim shorter or use the 25 MB preset.",
            plan.video_kbps
        ));
    }
    Ok(())
}

pub fn is_unmodified_audio_mix(audio_mix: &[AudioTrackMix], track_count: usize) -> bool {
    if audio_mix.is_empty() {
        return true;
    }
    if audio_mix.len() != track_count {
        return false;
    }
    audio_mix
        .iter()
        .all(|m| !m.muted && (m.volume - 1.0).abs() < 0.01)
}

pub fn compute_stretch_16_9_dims(src_height: i32, downscale_720p: bool) -> (i32, i32) {
    if downscale_720p {
        return (1280, 720);
    }
    let h = (src_height.max(240) / 2) * 2;
    let w = (((h as f64) * 16.0 / 9.0 / 2.0).round() as i32) * 2;
    (w, h)
}

fn build_aspect_vf(
    aspect_mode: AspectMode,
    src_height: i32,
    downscale_720p: bool,
) -> Option<String> {
    match aspect_mode {
        AspectMode::Stretch169 => {
            let (w, h) = compute_stretch_16_9_dims(src_height, downscale_720p);
            Some(format!("scale={w}:{h},setsar=1"))
        }
        AspectMode::Original => {
            if downscale_720p {
                Some("scale=-2:720".to_string())
            } else {
                None
            }
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_lossless_args(
    src_path: &Path,
    out_path: &Path,
    start_sec: f64,
    duration_sec: f64,
    unmodified_mix: bool,
    audio_mix: &[AudioTrackMix],
    track_count: usize,
    normalize_audio: bool,
) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        "-ss".to_string(),
        format!("{start_sec:.3}"),
        "-i".to_string(),
        src_path.to_string_lossy().to_string(),
        "-t".to_string(),
        format!("{duration_sec:.3}"),
    ];

    if unmodified_mix {
        args.extend([
            "-c".to_string(),
            "copy".to_string(),
            "-map".to_string(),
            "0:v:0".to_string(),
            "-map".to_string(),
            "0:a?".to_string(),
        ]);
    } else {
        args.extend(["-c:v".to_string(), "copy".to_string()]);
        append_video_and_audio_filters(
            &mut args,
            VideoFilterMode::None,
            audio_mix,
            track_count,
            192,
            normalize_audio,
            true,
        );
    }

    args.extend([
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-nostats".to_string(),
        out_path.to_string_lossy().to_string(),
    ]);
    args
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn build_encoded_args(
    src_path: &Path,
    out_path: &Path,
    start_sec: f64,
    duration_sec: f64,
    src_height: i32,
    aspect_mode: AspectMode,
    plan: &BitratePlan,
    encoder: &str,
    audio_mix: &[AudioTrackMix],
    track_count: usize,
    normalize_audio: bool,
) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        "-ss".to_string(),
        format!("{start_sec:.3}"),
        "-i".to_string(),
        src_path.to_string_lossy().to_string(),
        "-t".to_string(),
        format!("{duration_sec:.3}"),
    ];

    let video_mode = match build_aspect_vf(aspect_mode, src_height, plan.downscale_720p) {
        Some(vf) => VideoFilterMode::SimpleVf(vf),
        None => VideoFilterMode::None,
    };

    append_video_and_audio_filters(
        &mut args,
        video_mode,
        audio_mix,
        track_count,
        plan.audio_kbps.max(96),
        normalize_audio,
        false,
    );

    append_bitrate_video_encoder_args(&mut args, plan, encoder);

    args.extend([
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-progress".to_string(),
        "pipe:1".to_string(),
        "-nostats".to_string(),
        out_path.to_string_lossy().to_string(),
    ]);
    args
}

pub(crate) fn append_bitrate_video_encoder_args(
    args: &mut Vec<String>,
    plan: &BitratePlan,
    encoder: &str,
) {
    let maxrate = ((plan.video_kbps as f64) * 1.05).round() as i64;
    let bufsize = plan.video_kbps;

    match encoder {
        "h264_nvenc" => {
            args.extend([
                "-c:v".to_string(),
                "h264_nvenc".to_string(),
                "-preset".to_string(),
                "p4".to_string(),
                "-rc".to_string(),
                "vbr".to_string(),
            ]);
        }
        "h264_amf" => {
            args.extend([
                "-c:v".to_string(),
                "h264_amf".to_string(),
                "-quality".to_string(),
                "balanced".to_string(),
                "-rc".to_string(),
                "vbr_latency".to_string(),
            ]);
        }
        "h264_qsv" => {
            args.extend([
                "-c:v".to_string(),
                "h264_qsv".to_string(),
                "-preset".to_string(),
                "medium".to_string(),
            ]);
        }
        _ => {
            args.extend([
                "-c:v".to_string(),
                "libx264".to_string(),
                "-preset".to_string(),
                "fast".to_string(),
            ]);
        }
    }

    args.extend([
        "-b:v".to_string(),
        format!("{}k", plan.video_kbps),
        "-maxrate".to_string(),
        format!("{maxrate}k"),
        "-bufsize".to_string(),
        format!("{bufsize}k"),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
    ]);
}

#[allow(clippy::too_many_arguments)]
pub fn build_vertical_args(
    src_path: &Path,
    out_path: &Path,
    start_sec: f64,
    duration_sec: f64,
    preset: ExportPreset,
    aspect_mode: AspectMode,
    encoder: &str,
    audio_mix: &[AudioTrackMix],
    track_count: usize,
    normalize_audio: bool,
    with_progress: bool,
) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        "-ss".to_string(),
        format!("{start_sec:.3}"),
        "-i".to_string(),
        src_path.to_string_lossy().to_string(),
        "-t".to_string(),
        format!("{duration_sec:.3}"),
    ];

    let video_mode = match preset {
        ExportPreset::VerticalBlur916 => VideoFilterMode::VerticalBlur916 {
            stretch_fg: aspect_mode == AspectMode::Stretch169,
        },
        _ => VideoFilterMode::SimpleVf(
            "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1"
                .to_string(),
        ),
    };

    append_video_and_audio_filters(
        &mut args,
        video_mode,
        audio_mix,
        track_count,
        192,
        normalize_audio,
        false,
    );

    append_hq_video_encoder_args(&mut args, encoder, 20, 20);
    args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    if with_progress {
        args.extend([
            "-progress".to_string(),
            "pipe:1".to_string(),
            "-nostats".to_string(),
        ]);
    }
    args.push(out_path.to_string_lossy().to_string());
    args
}

pub(crate) fn append_hq_video_encoder_args(
    args: &mut Vec<String>,
    encoder: &str,
    hw_cq: u8,
    x264_crf: u8,
) {
    match encoder {
        "h264_nvenc" => {
            args.extend([
                "-c:v".to_string(),
                "h264_nvenc".to_string(),
                "-preset".to_string(),
                "p4".to_string(),
                "-cq".to_string(),
                hw_cq.to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ]);
        }
        "h264_amf" => {
            args.extend([
                "-c:v".to_string(),
                "h264_amf".to_string(),
                "-quality".to_string(),
                "balanced".to_string(),
                "-rc".to_string(),
                "cqp".to_string(),
                "-qp_i".to_string(),
                hw_cq.to_string(),
                "-qp_p".to_string(),
                hw_cq.to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ]);
        }
        "h264_qsv" => {
            args.extend([
                "-c:v".to_string(),
                "h264_qsv".to_string(),
                "-preset".to_string(),
                "medium".to_string(),
                "-global_quality".to_string(),
                hw_cq.to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ]);
        }
        _ => {
            args.extend([
                "-c:v".to_string(),
                "libx264".to_string(),
                "-preset".to_string(),
                "veryfast".to_string(),
                "-crf".to_string(),
                x264_crf.to_string(),
                "-pix_fmt".to_string(),
                "yuv420p".to_string(),
            ]);
        }
    }
}

#[allow(clippy::too_many_arguments)]
pub fn build_hq_trim_args(
    src_path: &Path,
    out_path: &Path,
    start_sec: f64,
    duration_sec: f64,
    src_height: i32,
    aspect_mode: AspectMode,
    encoder: &str,
    nvenc_cq: u8,
    audio_mix: &[AudioTrackMix],
    track_count: usize,
    normalize_audio: bool,
    with_progress: bool,
) -> Vec<String> {
    let mut args = vec![
        "-y".to_string(),
        "-ss".to_string(),
        format!("{start_sec:.3}"),
        "-i".to_string(),
        src_path.to_string_lossy().to_string(),
        "-t".to_string(),
        format!("{duration_sec:.3}"),
    ];

    let video_mode = match build_aspect_vf(aspect_mode, src_height, false) {
        Some(vf) => VideoFilterMode::SimpleVf(vf),
        None => VideoFilterMode::None,
    };

    append_video_and_audio_filters(
        &mut args,
        video_mode,
        audio_mix,
        track_count,
        192,
        normalize_audio,
        true,
    );
    append_hq_video_encoder_args(&mut args, encoder, nvenc_cq, 18);

    args.extend(["-movflags".to_string(), "+faststart".to_string()]);
    if with_progress {
        args.extend([
            "-progress".to_string(),
            "pipe:1".to_string(),
            "-nostats".to_string(),
        ]);
    }
    args.push(out_path.to_string_lossy().to_string());
    args
}

#[allow(clippy::too_many_arguments)]
pub fn build_save_trim_args(
    src_path: &Path,
    out_path: &Path,
    start_sec: f64,
    duration_sec: f64,
    src_height: i32,
    aspect_mode: AspectMode,
    encoder: &str,
    audio_mix: &[AudioTrackMix],
    track_count: usize,
    normalize_audio: bool,
) -> Vec<String> {
    build_hq_trim_args(
        src_path,
        out_path,
        start_sec,
        duration_sec,
        src_height,
        aspect_mode,
        encoder,
        19,
        audio_mix,
        track_count,
        normalize_audio,
        false,
    )
}

fn append_video_and_audio_filters(
    args: &mut Vec<String>,
    video_mode: VideoFilterMode,
    audio_mix: &[AudioTrackMix],
    track_count: usize,
    audio_kbps: i64,
    normalize_audio: bool,
    preserve_all_unmodified: bool,
) {
    let active: Vec<&AudioTrackMix> = audio_mix
        .iter()
        .filter(|m| !m.muted && m.volume > 0.001)
        .collect();
    let use_complex = matches!(video_mode, VideoFilterMode::VerticalBlur916 { .. })
        || (!audio_mix.is_empty() && active.len() >= 2);

    if !use_complex {
        if let VideoFilterMode::SimpleVf(vf) = video_mode {
            args.extend(["-vf".to_string(), vf]);
        }
        append_simple_audio_args(
            args,
            audio_mix,
            &active,
            track_count,
            audio_kbps,
            normalize_audio,
            preserve_all_unmodified,
        );
        return;
    }

    let mut fc_parts = Vec::new();
    let v_map = match video_mode {
        VideoFilterMode::VerticalBlur916 { stretch_fg } => {
            let fg_scale = if stretch_fg {
                "scale=1080:608"
            } else {
                "scale=1080:-2:force_original_aspect_ratio=decrease"
            };
            fc_parts.push(format!(
                "[0:v:0]split=2[bg_src][fg_src];[bg_src]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:6,setsar=1[bg];[fg_src]{fg_scale},setsar=1[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1[vout]"
            ));
            "[vout]"
        }
        VideoFilterMode::SimpleVf(vf) => {
            fc_parts.push(format!("[0:v:0]{vf}[vout]"));
            "[vout]"
        }
        VideoFilterMode::None => "0:v:0",
    };

    if audio_mix.is_empty() {
        if track_count == 0 {
            args.extend([
                "-filter_complex".to_string(),
                fc_parts.join(";"),
                "-map".to_string(),
                v_map.to_string(),
                "-an".to_string(),
            ]);
        } else if normalize_audio {
            fc_parts.push(format!("[0:a:0]{LOUDNORM_FILTER}[aout]"));
            args.extend([
                "-filter_complex".to_string(),
                fc_parts.join(";"),
                "-map".to_string(),
                v_map.to_string(),
                "-map".to_string(),
                "[aout]".to_string(),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                format!("{audio_kbps}k"),
            ]);
        } else {
            let a_map = if preserve_all_unmodified {
                "0:a?"
            } else {
                "0:a:0?"
            };
            args.extend([
                "-filter_complex".to_string(),
                fc_parts.join(";"),
                "-map".to_string(),
                v_map.to_string(),
                "-map".to_string(),
                a_map.to_string(),
                "-c:a".to_string(),
                "aac".to_string(),
                "-b:a".to_string(),
                format!("{audio_kbps}k"),
            ]);
        }
    } else if active.is_empty() {
        args.extend([
            "-filter_complex".to_string(),
            fc_parts.join(";"),
            "-map".to_string(),
            v_map.to_string(),
            "-an".to_string(),
        ]);
    } else if active.len() == 1 {
        let track = active[0];
        let mut chain = Vec::new();
        if (track.volume - 1.0).abs() > 0.01 {
            chain.push(format!("volume={:.3}", track.volume.clamp(0.0, 2.0)));
        }
        if normalize_audio {
            chain.push(LOUDNORM_FILTER.to_string());
        }
        let a_map = if chain.is_empty() {
            format!("0:{}", track.stream_index)
        } else {
            fc_parts.push(format!("[0:{}]{}[aout]", track.stream_index, chain.join(",")));
            "[aout]".to_string()
        };
        args.extend([
            "-filter_complex".to_string(),
            fc_parts.join(";"),
            "-map".to_string(),
            v_map.to_string(),
            "-map".to_string(),
            a_map,
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            format!("{audio_kbps}k"),
        ]);
    } else {
        let mut inputs_labels = String::new();
        for (i, track) in active.iter().enumerate() {
            let vol = track.volume.clamp(0.0, 2.0);
            fc_parts.push(format!("[0:{}]volume={vol:.3}[a{i}]", track.stream_index));
            inputs_labels.push_str(&format!("[a{i}]"));
        }
        let norm_suffix = if normalize_audio {
            format!(",{LOUDNORM_FILTER}")
        } else {
            String::new()
        };
        fc_parts.push(format!(
            "{inputs_labels}amix=inputs={}:duration=longest:normalize=0{norm_suffix}[aout]",
            active.len()
        ));
        args.extend([
            "-filter_complex".to_string(),
            fc_parts.join(";"),
            "-map".to_string(),
            v_map.to_string(),
            "-map".to_string(),
            "[aout]".to_string(),
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            format!("{audio_kbps}k"),
        ]);
    }
}

fn append_simple_audio_args(
    args: &mut Vec<String>,
    audio_mix: &[AudioTrackMix],
    active: &[&AudioTrackMix],
    track_count: usize,
    audio_kbps: i64,
    normalize_audio: bool,
    preserve_all_unmodified: bool,
) {
    if audio_mix.is_empty() {
        if track_count == 0 {
            args.extend(["-map".to_string(), "0:v:0".to_string(), "-an".to_string()]);
            return;
        }
        let a_map = if preserve_all_unmodified {
            "0:a?"
        } else {
            "0:a:0?"
        };
        args.extend([
            "-map".to_string(),
            "0:v:0".to_string(),
            "-map".to_string(),
            a_map.to_string(),
        ]);
        if normalize_audio {
            args.extend(["-af".to_string(), LOUDNORM_FILTER.to_string()]);
        }
        args.extend([
            "-c:a".to_string(),
            "aac".to_string(),
            "-b:a".to_string(),
            format!("{audio_kbps}k"),
        ]);
        return;
    }

    if active.is_empty() {
        args.extend(["-map".to_string(), "0:v:0".to_string(), "-an".to_string()]);
        return;
    }

    let track = active[0];
    args.extend([
        "-map".to_string(),
        "0:v:0".to_string(),
        "-map".to_string(),
        format!("0:{}", track.stream_index),
    ]);
    let mut af_parts = Vec::new();
    if (track.volume - 1.0).abs() > 0.01 {
        af_parts.push(format!("volume={:.3}", track.volume.clamp(0.0, 2.0)));
    }
    if normalize_audio {
        af_parts.push(LOUDNORM_FILTER.to_string());
    }
    if !af_parts.is_empty() {
        args.extend(["-af".to_string(), af_parts.join(",")]);
    }
    args.extend([
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        format!("{audio_kbps}k"),
    ]);
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::exporter::sanitize::validate_save_trim_range;
    use crate::models::{MergeClipsRequest, SaveTrimmedClipRequest, StartExportRequest};

    #[test]
    fn calculates_discord_10mb_bitrate_and_720p_downscale() {
        let short_plan =
            calculate_discord_bitrate(ExportPreset::Discord10mb, 20.0, 1080, true)
                .expect("plan");
        assert!((short_plan.effective_mb - 9.2).abs() < 0.001);
        assert_eq!(short_plan.audio_kbps, 128);
        assert_eq!(short_plan.video_kbps, 3640);
        assert!(!short_plan.downscale_720p);
        assert!(!short_plan.too_long_warning);

        let long_plan =
            calculate_discord_bitrate(ExportPreset::Discord10mb, 70.0, 1080, true)
                .expect("long plan");
        assert_eq!(long_plan.audio_kbps, 96);
        assert_eq!(long_plan.video_kbps, 980);
        assert!(long_plan.downscale_720p);

        let muted_plan =
            calculate_discord_bitrate(ExportPreset::Discord10mb, 30.0, 720, false)
                .expect("muted plan");
        assert_eq!(muted_plan.audio_kbps, 0);
        assert_eq!(muted_plan.video_kbps, 2512);

        let plan_25 =
            calculate_discord_bitrate(ExportPreset::Discord25mb, 30.0, 1080, true)
                .expect("25mb plan");
        assert!((plan_25.effective_mb - 24.0).abs() < 0.001);
        assert_eq!(plan_25.audio_kbps, 128);
        assert_eq!(plan_25.video_kbps, 6425);

        assert!(calculate_discord_bitrate(ExportPreset::LosslessTrim, 20.0, 1080, true).is_none());
    }

    #[test]
    fn tightens_vbr_burst_for_short_discord_clip_and_scales_bitrate_on_overshoot() {
        let plan_978 = calculate_discord_bitrate(ExportPreset::Discord10mb, 9.78, 1080, true)
            .expect("9.78s plan");
        assert!((plan_978.effective_mb - 9.2).abs() < 0.001);
        assert!(validate_export_plan(ExportPreset::Discord10mb, &plan_978).is_ok());

        let args = build_encoded_args(
            Path::new(r"C:\src.mp4"),
            Path::new(r"C:\out.mp4"),
            0.0,
            9.78,
            1080,
            AspectMode::Original,
            &plan_978,
            "h264_nvenc",
            &[],
            1,
            false,
        );
        let expected_maxrate = format!("{}k", ((plan_978.video_kbps as f64) * 1.05).round() as i64);
        let expected_bufsize = format!("{}k", plan_978.video_kbps);
        assert!(args.windows(2).any(|w| w == ["-maxrate", expected_maxrate.as_str()]));
        assert!(args.windows(2).any(|w| w == ["-bufsize", expected_bufsize.as_str()]));

        let limit_10 = discord_limit_bytes(ExportPreset::Discord10mb).expect("10mb limit");
        let scaled_1 = scale_bitrate_plan_for_overshoot(&plan_978, limit_10, 11_200_000, 1080)
            .expect("scaled plan 1");
        assert!(scaled_1.video_kbps < plan_978.video_kbps);
        assert!(scaled_1.video_kbps >= 150);

        let scaled_2 = scale_bitrate_plan_for_overshoot(&scaled_1, limit_10, 10_900_000, 1080)
            .expect("scaled plan 2");
        assert!(scaled_2.video_kbps < scaled_1.video_kbps);
        assert!(scaled_2.video_kbps >= 150);

        let limit_25 = discord_limit_bytes(ExportPreset::Discord25mb).expect("25mb limit");
        assert_eq!(limit_25, 25 * 1024 * 1024);
        assert!(discord_limit_bytes(ExportPreset::LosslessTrim).is_none());

        let low_plan = BitratePlan {
            effective_mb: 9.2,
            duration_sec: 120.0,
            video_kbps: 160,
            audio_kbps: 96,
            downscale_720p: true,
            too_long_warning: true,
        };
        assert!(scale_bitrate_plan_for_overshoot(&low_plan, limit_10, 15_000_000, 1080).is_none());
    }

    #[test]
    fn rejects_discord_10mb_when_bitrate_below_600_kbps_with_25mb_hint() {
        let too_long_plan =
            calculate_discord_bitrate(ExportPreset::Discord10mb, 130.0, 1080, true)
                .expect("plan");
        assert!(too_long_plan.too_long_warning);
        let err = validate_export_plan(ExportPreset::Discord10mb, &too_long_plan)
            .expect_err("10 MB export should reject < 600 kbps clips");
        assert!(err.contains("too long"));
        assert!(err.contains("25 MB"));

        let fallback_plan =
            calculate_discord_bitrate(ExportPreset::Discord25mb, 130.0, 1080, true)
                .expect("25mb plan");
        assert!(validate_export_plan(ExportPreset::Discord25mb, &fallback_plan).is_ok());
    }

    #[test]
    fn validates_save_trim_range_and_builds_frame_accurate_args() {
        assert!(validate_save_trim_range(2.0, 2.0, 10.0).is_err());
        assert!(validate_save_trim_range(2.0, 2.15, 10.0).is_err());
        assert!(validate_save_trim_range(10.0, 11.0, 10.0).is_err());
        let dur = validate_save_trim_range(1.0, 2.2, 10.0).expect("valid range");
        assert!((dur - 1.2).abs() < 0.0001);

        let args = build_save_trim_args(
            Path::new(r"C:\src.mp4"),
            Path::new(r"C:\out.mp4"),
            1.0,
            1.2,
            1080,
            AspectMode::Original,
            "h264_nvenc",
            &[],
            2,
            false,
        );
        assert!(args.windows(2).any(|w| w == ["-c:v", "h264_nvenc"]));
        assert!(args.windows(2).any(|w| w == ["-cq", "19"]));
        assert!(args.windows(2).any(|w| w == ["-map", "0:a?"]));
        assert!(!args.iter().any(|a| a == "-vf"));

        let x264_args = build_save_trim_args(
            Path::new(r"C:\src.mp4"),
            Path::new(r"C:\out.mp4"),
            1.0,
            1.2,
            1080,
            AspectMode::Stretch169,
            "libx264",
            &[AudioTrackMix {
                track_order: 0,
                stream_index: 1,
                muted: false,
                volume: 0.8,
            }],
            2,
            true,
        );
        assert!(x264_args.windows(2).any(|w| w == ["-c:v", "libx264"]));
        assert!(x264_args.windows(2).any(|w| w == ["-crf", "18"]));
        assert!(x264_args
            .windows(2)
            .any(|w| w == ["-vf", "scale=1920:1080,setsar=1"]));
        assert!(x264_args
            .windows(2)
            .any(|w| w == ["-af", "volume=0.800,loudnorm=I=-16:TP=-1.5:LRA=11"]));
    }

    #[test]
    fn computes_stretch_16_9_dimensions_and_serde_defaults() {
        assert_eq!(compute_stretch_16_9_dims(1080, false), (1920, 1080));
        assert_eq!(compute_stretch_16_9_dims(1440, false), (2560, 1440));
        assert_eq!(compute_stretch_16_9_dims(720, false), (1280, 720));
        assert_eq!(compute_stretch_16_9_dims(960, false), (1706, 960));
        assert_eq!(compute_stretch_16_9_dims(1080, true), (1280, 720));

        let default_req: StartExportRequest = serde_json::from_str(
            r#"{"clipId":"c1","preset":"lossless_trim","startSec":0,"endSec":5,"audioMix":[],"copyToClipboard":false}"#,
        )
        .expect("default aspectMode");
        assert_eq!(default_req.aspect_mode, AspectMode::Original);
        assert!(!default_req.normalize_audio);

        let stretch_req: StartExportRequest = serde_json::from_str(
            r#"{"clipId":"c1","preset":"discord_10mb","startSec":0,"endSec":5,"audioMix":[],"copyToClipboard":true,"aspectMode":"stretch_16_9","normalizeAudio":true}"#,
        )
        .expect("stretch_16_9 aspectMode");
        assert_eq!(stretch_req.aspect_mode, AspectMode::Stretch169);
        assert!(stretch_req.normalize_audio);

        let v_blur: StartExportRequest = serde_json::from_str(
            r#"{"clipId":"c1","preset":"vertical_blur_9_16","startSec":0,"endSec":5,"audioMix":[],"copyToClipboard":false}"#,
        )
        .expect("vertical_blur_9_16");
        assert_eq!(v_blur.preset, ExportPreset::VerticalBlur916);

        let v_crop: StartExportRequest = serde_json::from_str(
            r#"{"clipId":"c1","preset":"vertical_crop_9_16","startSec":0,"endSec":5,"audioMix":[],"copyToClipboard":false}"#,
        )
        .expect("vertical_crop_9_16");
        assert_eq!(v_crop.preset, ExportPreset::VerticalCrop916);

        let merge_req: MergeClipsRequest = serde_json::from_str(
            r#"{"clipIds":["a","b"],"outputName":"Ace Montage","aspectMode":"stretch_16_9","normalizeAudio":true,"copyToClipboard":true,"addToLibrary":true}"#,
        )
        .expect("MergeClipsRequest");
        assert_eq!(merge_req.clip_ids, vec!["a", "b"]);
        assert_eq!(merge_req.output_name.as_deref(), Some("Ace Montage"));
        assert_eq!(merge_req.aspect_mode, AspectMode::Stretch169);
        assert!(merge_req.normalize_audio);
        assert!(merge_req.copy_to_clipboard);
        assert!(merge_req.add_to_library);

        let trim_req: SaveTrimmedClipRequest = serde_json::from_str(
            r#"{"clipId":"c1","startSec":1,"endSec":3,"aspectMode":"stretch_16_9","normalizeAudio":true}"#,
        )
        .expect("save trim stretch_16_9");
        assert_eq!(trim_req.aspect_mode, AspectMode::Stretch169);
        assert!(trim_req.normalize_audio);

        let plan = calculate_discord_bitrate(ExportPreset::Discord10mb, 70.0, 1080, true)
            .expect("long plan");
        let discord_stretch_args = build_encoded_args(
            Path::new(r"C:\src.mp4"),
            Path::new(r"C:\out.mp4"),
            0.0,
            70.0,
            1080,
            AspectMode::Stretch169,
            &plan,
            "h264_nvenc",
            &[],
            1,
            false,
        );
        assert!(discord_stretch_args
            .windows(2)
            .any(|w| w == ["-vf", "scale=1280:720,setsar=1"]));

        let lossless_stretch_args = build_hq_trim_args(
            Path::new(r"C:\src.mp4"),
            Path::new(r"C:\out.mp4"),
            0.0,
            5.0,
            1080,
            AspectMode::Stretch169,
            "h264_nvenc",
            18,
            &[],
            1,
            false,
            true,
        );
        assert!(lossless_stretch_args
            .windows(2)
            .any(|w| w == ["-cq", "18"]));
        assert!(lossless_stretch_args
            .windows(2)
            .any(|w| w == ["-vf", "scale=1920:1080,setsar=1"]));
    }

    #[test]
    fn builds_vertical_and_amf_qsv_ffmpeg_args() {
        let blur_args = build_vertical_args(
            Path::new(r"C:\src.mp4"),
            Path::new(r"C:\out.mp4"),
            0.0,
            5.0,
            ExportPreset::VerticalBlur916,
            AspectMode::Stretch169,
            "h264_nvenc",
            &[
                AudioTrackMix {
                    track_order: 0,
                    stream_index: 1,
                    muted: false,
                    volume: 1.0,
                },
                AudioTrackMix {
                    track_order: 1,
                    stream_index: 2,
                    muted: false,
                    volume: 0.5,
                },
            ],
            2,
            true,
            true,
        );
        let fc = blur_args
            .windows(2)
            .find(|w| w[0] == "-filter_complex")
            .map(|w| w[1].clone())
            .expect("filter_complex");
        assert!(fc.contains("boxblur=24:6"));
        assert!(fc.contains("scale=1080:608"));
        assert!(fc.contains("amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11[aout]"));

        let crop_args = build_vertical_args(
            Path::new(r"C:\src.mp4"),
            Path::new(r"C:\out.mp4"),
            0.0,
            5.0,
            ExportPreset::VerticalCrop916,
            AspectMode::Original,
            "libx264",
            &[],
            1,
            false,
            false,
        );
        assert!(crop_args.windows(2).any(|w| {
            w == [
                "-vf",
                "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1",
            ]
        }));

        let plan = BitratePlan {
            effective_mb: 9.5,
            duration_sec: 10.0,
            video_kbps: 7500,
            audio_kbps: 128,
            downscale_720p: false,
            too_long_warning: false,
        };

        let amf_bitrate = build_encoded_args(
            Path::new(r"C:\src.mp4"),
            Path::new(r"C:\out_amf.mp4"),
            0.0,
            10.0,
            1080,
            AspectMode::Original,
            &plan,
            "h264_amf",
            &[],
            1,
            false,
        );
        assert!(amf_bitrate.windows(2).any(|w| w == ["-c:v", "h264_amf"]));
        assert!(amf_bitrate.windows(2).any(|w| w == ["-quality", "balanced"]));
        assert!(amf_bitrate.windows(2).any(|w| w == ["-rc", "vbr_latency"]));

        let qsv_bitrate = build_encoded_args(
            Path::new(r"C:\src.mp4"),
            Path::new(r"C:\out_qsv.mp4"),
            0.0,
            10.0,
            1080,
            AspectMode::Original,
            &plan,
            "h264_qsv",
            &[],
            1,
            false,
        );
        assert!(qsv_bitrate.windows(2).any(|w| w == ["-c:v", "h264_qsv"]));
        assert!(qsv_bitrate.windows(2).any(|w| w == ["-preset", "medium"]));

        let amf_hq = build_save_trim_args(
            Path::new(r"C:\src.mp4"),
            Path::new(r"C:\trim_amf.mp4"),
            1.0,
            2.0,
            1080,
            AspectMode::Original,
            "h264_amf",
            &[],
            1,
            false,
        );
        assert!(amf_hq.windows(2).any(|w| w == ["-rc", "cqp"]));
        assert!(amf_hq.windows(2).any(|w| w == ["-qp_i", "19"]));
        assert!(amf_hq.windows(2).any(|w| w == ["-qp_p", "19"]));

        let qsv_hq = build_save_trim_args(
            Path::new(r"C:\src.mp4"),
            Path::new(r"C:\trim_qsv.mp4"),
            1.0,
            2.0,
            1080,
            AspectMode::Original,
            "h264_qsv",
            &[],
            1,
            false,
        );
        assert!(qsv_hq.windows(2).any(|w| w == ["-preset", "medium"]));
        assert!(qsv_hq.windows(2).any(|w| w == ["-global_quality", "19"]));
    }
}
