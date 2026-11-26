use std::path::Path;
use std::time::UNIX_EPOCH;

use chrono::{SecondsFormat, Utc};
use tokio::sync::Semaphore;

use crate::db::{Db, ScannedClipInsert};
use crate::error::AppResult;
use crate::exporter::args::{append_hq_video_encoder_args, LOUDNORM_FILTER};
use crate::exporter::runner::{run_hw_with_x264_fallback, ActiveJobControl, ExportRunError, ProgressCallback};
use crate::media::{generate_thumbnail, probe_clip};
use crate::models::{AspectMode, SourceType};
use crate::paths::AppPaths;

#[derive(Debug, Clone)]
pub struct MergeClipInput {
    pub file_path: String,
    pub duration_sec: f64,
    pub has_audio: bool,
}

pub fn build_merge_clips_args(
    inputs: &[MergeClipInput],
    out_path: &Path,
    aspect_mode: AspectMode,
    normalize_audio: bool,
    encoder: &str,
    with_progress: bool,
) -> Vec<String> {
    let mut args = vec!["-y".to_string()];
    let mut fc_parts = Vec::with_capacity(inputs.len() * 2 + 2);
    let mut concat_inputs = String::new();

    for (i, input) in inputs.iter().enumerate() {
        args.push("-i".to_string());
        args.push(input.file_path.clone());

        let v_filter = match aspect_mode {
            AspectMode::Stretch169 => {
                format!("[{i}:v:0]scale=1920:1080,setsar=1,fps=60,format=yuv420p[v{i}]")
            }
            AspectMode::Original => {
                format!("[{i}:v:0]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=60,format=yuv420p[v{i}]")
            }
        };
        fc_parts.push(v_filter);

        let a_filter = if input.has_audio {
            format!("[{i}:a:0]aformat=sample_rates=48000:channel_layouts=stereo,asetpts=PTS-STARTPTS[a{i}]")
        } else {
            format!(
                "anullsrc=r=48000:cl=stereo:d={:.3}[a{i}]",
                input.duration_sec.max(0.1)
            )
        };
        fc_parts.push(a_filter);
        concat_inputs.push_str(&format!("[v{i}][a{i}]"));
    }

    let concat_a = if normalize_audio { "a_concat" } else { "aout" };
    fc_parts.push(format!(
        "{concat_inputs}concat=n={}:v=1:a=1[vout][{concat_a}]",
        inputs.len()
    ));
    if normalize_audio {
        fc_parts.push(format!("[a_concat]{LOUDNORM_FILTER}[aout]"));
    }

    args.extend([
        "-filter_complex".to_string(),
        fc_parts.join(";"),
        "-map".to_string(),
        "[vout]".to_string(),
        "-map".to_string(),
        "[aout]".to_string(),
    ]);

    append_hq_video_encoder_args(&mut args, encoder, 19, 19);
    args.extend([
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "192k".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
    ]);
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
pub async fn execute_merge_pipeline(
    on_progress: Option<ProgressCallback>,
    job_id: &str,
    inputs: &[MergeClipInput],
    out_path: &Path,
    total_duration: f64,
    aspect_mode: AspectMode,
    normalize_audio: bool,
    hw_encoders: &[&str],
    ctrl: &ActiveJobControl,
) -> Result<(i64, String), ExportRunError> {
    run_hw_with_x264_fallback(
        on_progress,
        job_id,
        out_path,
        total_duration,
        None,
        hw_encoders,
        ctrl,
        |encoder| {
            build_merge_clips_args(
                inputs,
                out_path,
                aspect_mode,
                normalize_audio,
                encoder,
                true,
            )
        },
    )
    .await
}

pub(crate) async fn register_merged_clip_in_library(
    db: &Db,
    paths: &AppPaths,
    thumb_sem: &Semaphore,
    out_path: &Path,
    game_id: Option<String>,
    source_type: SourceType,
    output_name: Option<&str>,
) -> AppResult<String> {
    let meta = tokio::fs::metadata(out_path).await?;
    let file_size_bytes = meta.len() as i64;
    let file_mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let probe = probe_clip(out_path).await?;
    let file_name = out_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("glint_montage.mp4")
        .to_string();
    let recorded_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    let (new_clip_id, _) = db.upsert_scanned_clip(ScannedClipInsert {
        file_path: out_path.to_string_lossy().to_string(),
        file_name,
        file_size_bytes,
        file_mtime,
        source_type,
        game_id,
        recorded_at,
        duration_sec: probe.duration_sec,
        width: probe.width,
        height: probe.height,
        fps: probe.fps,
        video_codec: probe.video_codec,
        audio_tracks: probe.audio_tracks,
        thumb_path: None,
    })?;

    let thumb_path = paths.thumb_path(&new_clip_id);
    if generate_thumbnail(out_path, probe.duration_sec, &thumb_path, thumb_sem)
        .await
        .is_ok()
    {
        let _ = db.update_clip_thumb_path(&new_clip_id, &thumb_path.to_string_lossy());
    }

    if let Some(title) = output_name.map(str::trim).filter(|s| !s.is_empty()) {
        let _ = db.update_clip_meta(
            &new_clip_id,
            Some(title.to_string()),
            None,
            None,
            None,
            None,
            "",
            "",
        );
    }

    Ok(new_clip_id)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_merge_filter_complex_with_silent_fallback_and_loudnorm() {
        let merge_args = build_merge_clips_args(
            &[
                MergeClipInput {
                    file_path: r"C:\a.mp4".to_string(),
                    duration_sec: 2.0,
                    has_audio: true,
                },
                MergeClipInput {
                    file_path: r"C:\b.mp4".to_string(),
                    duration_sec: 3.0,
                    has_audio: false,
                },
            ],
            Path::new(r"C:\montage.mp4"),
            AspectMode::Original,
            true,
            "h264_nvenc",
            true,
        );
        let m_fc = merge_args
            .windows(2)
            .find(|w| w[0] == "-filter_complex")
            .map(|w| w[1].clone())
            .expect("merge filter_complex");
        assert!(m_fc.contains("anullsrc=r=48000:cl=stereo:d=3.000[a1]"));
        assert!(m_fc.contains("concat=n=2:v=1:a=1[vout][a_concat]"));
        assert!(m_fc.contains("[a_concat]loudnorm=I=-16:TP=-1.5:LRA=11[aout]"));
    }
}
