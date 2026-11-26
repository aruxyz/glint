use std::path::Path;

use crate::db::Db;
use crate::error::{AppError, AppResult};
use crate::exporter::args::{
    append_bitrate_video_encoder_args, append_hq_video_encoder_args, calculate_discord_bitrate,
    validate_export_plan, BitratePlan, LOUDNORM_FILTER,
};
use crate::exporter::runner::{
    run_discord_export_with_retry, run_hw_with_x264_fallback, ActiveJobControl, ExportRunError,
    ProgressCallback,
};
use crate::exporter::sanitize::validate_export_range;
use crate::models::{
    AudioTrackMix, EditorAudioLayerInput, EditorSegmentInput, ExportPreset, SourceType,
    StartEditorExportRequest,
};
use crate::paths::normalize_windows_path;

const MIN_EDITOR_SEGMENT_SEC: f64 = 0.25;
const DEFAULT_CROSSFADE_SEC: f64 = 0.35;
const MAX_TRANSITION_SEC: f64 = 3.0;
const MIN_TRANSITION_SEC: f64 = 0.10;
const MIN_BODY_RESERVE_SEC: f64 = 0.20;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorPresetMode {
    Original,
    Discord(ExportPreset),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EditorVerticalMode {
    None,
    Blur,
    Crop,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub enum EditorTransitionMode {
    Cut,
    Fade(f64),
    Crossfade(f64),
}

#[derive(Debug, Clone, Copy, PartialEq, Default)]
pub enum EditorTransitionOutMode {
    #[default]
    Cut,
    Fade(f64),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum EditorFraming {
    #[default]
    Fit,
    Fill,
    Stretch,
}

#[derive(Debug, Clone)]
pub struct PreparedEditorSegment {
    pub clip_id: String,
    pub file_path: String,
    pub start_sec: f64,
    pub raw_dur: f64,
    pub effective_dur: f64,
    pub speed: f64,
    pub src_height: i32,
    pub track_count: usize,
    pub audio_mix: Vec<AudioTrackMix>,
    pub master_volume: f64,
    pub master_muted: bool,
    pub transition_in: EditorTransitionMode,
    pub transition_out: EditorTransitionOutMode,
    pub vibrance: f64,
    pub saturation: f64,
    pub framing: EditorFraming,
}

impl PreparedEditorSegment {
    pub fn has_audible_audio(&self) -> bool {
        let master_gain = (self.master_volume.clamp(0.0, 100.0)) / 100.0;
        if self.master_muted || master_gain <= 0.001 || self.track_count == 0 {
            return false;
        }
        if self.audio_mix.is_empty() {
            return true;
        }
        self.audio_mix.iter().any(|track| {
            !track.muted && (track.volume.clamp(0.0, 2.0) * master_gain) > 0.001
        })
    }
}

#[derive(Debug, Clone)]
pub struct PreparedEditorAudioLayer {
    pub file_path: String,
    pub timeline_offset_sec: f64,
    pub trim_start_sec: f64,
    pub active_dur: f64,
    pub volume: f64,
    pub muted: bool,
}

impl PreparedEditorAudioLayer {
    pub fn clipped_dur(&self, total_duration: f64) -> f64 {
        let remaining = (total_duration - self.timeline_offset_sec).max(0.0);
        self.active_dur.min(remaining)
    }

    pub fn is_audible(&self, total_duration: f64) -> bool {
        !self.muted
            && self.volume > 0.001
            && self.timeline_offset_sec < total_duration
            && self.clipped_dur(total_duration) >= 0.05
    }
}

pub struct PreparedEditorTimeline {
    pub segments: Vec<PreparedEditorSegment>,
    pub audio_layers: Vec<PreparedEditorAudioLayer>,
    pub preset_mode: EditorPresetMode,
    pub vertical_mode: EditorVerticalMode,
    pub total_duration: f64,
    pub inherited_game_id: Option<String>,
    pub inherited_source_type: SourceType,
}

pub fn parse_editor_preset(raw: &str) -> AppResult<EditorPresetMode> {
    match raw.trim() {
        "original" => Ok(EditorPresetMode::Original),
        "discord_10mb" => Ok(EditorPresetMode::Discord(ExportPreset::Discord10mb)),
        "discord_25mb" => Ok(EditorPresetMode::Discord(ExportPreset::Discord25mb)),
        other => Err(AppError::InvalidInput(format!(
            "Unsupported editor preset '{other}'"
        ))),
    }
}

pub fn parse_editor_vertical_style(raw: &str) -> AppResult<EditorVerticalMode> {
    match raw.trim() {
        "none" => Ok(EditorVerticalMode::None),
        "blur" => Ok(EditorVerticalMode::Blur),
        "crop" => Ok(EditorVerticalMode::Crop),
        other => Err(AppError::InvalidInput(format!(
            "Unsupported verticalStyle '{other}'"
        ))),
    }
}

fn transition_in_reserve_sec(mode: EditorTransitionMode) -> f64 {
    match mode {
        EditorTransitionMode::Cut => 0.0,
        EditorTransitionMode::Fade(d) | EditorTransitionMode::Crossfade(d) => d,
    }
}

fn parse_segment_transition_in(
    index: usize,
    raw: &str,
    raw_duration_sec: Option<f64>,
    legacy_crossfade_sec: f64,
    prev_effective_dur: Option<f64>,
    prev_in_reserve_sec: f64,
    curr_effective_dur: f64,
) -> AppResult<EditorTransitionMode> {
    let normalized = raw.trim();
    if normalized != "cut" && normalized != "crossfade" && normalized != "fade" {
        return Err(AppError::InvalidInput(format!(
            "Unsupported transitionIn '{normalized}'"
        )));
    }
    if normalized == "cut" {
        return Ok(EditorTransitionMode::Cut);
    }

    if index == 0 {
        if normalized != "fade" {
            return Ok(EditorTransitionMode::Cut);
        }
        let raw_dur = raw_duration_sec.unwrap_or(0.0);
        let max_fade = (curr_effective_dur - MIN_BODY_RESERVE_SEC).clamp(0.0, MAX_TRANSITION_SEC);
        if curr_effective_dur >= 0.30
            && raw_dur.is_finite()
            && raw_dur >= MIN_TRANSITION_SEC
            && max_fade >= MIN_TRANSITION_SEC
        {
            return Ok(EditorTransitionMode::Fade(raw_dur.min(max_fade)));
        }
        return Ok(EditorTransitionMode::Cut);
    }

    if normalized != "crossfade" {
        return Ok(EditorTransitionMode::Cut);
    }

    let raw_dur = match raw_duration_sec {
        Some(d) => d,
        None if legacy_crossfade_sec.is_finite() && legacy_crossfade_sec > 0.0 => {
            legacy_crossfade_sec
        }
        None => DEFAULT_CROSSFADE_SEC,
    };

    let prev_avail = prev_effective_dur
        .map(|d| (d - prev_in_reserve_sec - MIN_BODY_RESERVE_SEC).max(0.0))
        .unwrap_or(0.0);
    let curr_avail = (curr_effective_dur - MIN_BODY_RESERVE_SEC).max(0.0);
    let max_cf = prev_avail.min(curr_avail).min(MAX_TRANSITION_SEC);

    if raw_dur.is_finite() && raw_dur >= MIN_TRANSITION_SEC && max_cf >= MIN_TRANSITION_SEC {
        Ok(EditorTransitionMode::Crossfade(raw_dur.min(max_cf)))
    } else {
        Ok(EditorTransitionMode::Cut)
    }
}

fn parse_segment_transition_out(
    is_last: bool,
    raw: &str,
    raw_duration_sec: f64,
    curr_in_reserve_sec: f64,
    curr_effective_dur: f64,
) -> AppResult<EditorTransitionOutMode> {
    let normalized = raw.trim();
    if normalized != "cut" && normalized != "fade" {
        return Err(AppError::InvalidInput(format!(
            "Unsupported transitionOut '{normalized}'"
        )));
    }
    if !is_last || normalized == "cut" {
        return Ok(EditorTransitionOutMode::Cut);
    }

    let max_fade = (curr_effective_dur - curr_in_reserve_sec - MIN_BODY_RESERVE_SEC)
        .clamp(0.0, MAX_TRANSITION_SEC);
    if raw_duration_sec.is_finite()
        && raw_duration_sec >= MIN_TRANSITION_SEC
        && max_fade >= MIN_TRANSITION_SEC
    {
        Ok(EditorTransitionOutMode::Fade(raw_duration_sec.min(max_fade)))
    } else {
        Ok(EditorTransitionOutMode::Cut)
    }
}

fn validate_segment_speed(speed: f64) -> AppResult<f64> {
    if !speed.is_finite() || !(0.25..=4.0).contains(&speed) {
        return Err(AppError::InvalidInput(
            "Segment speed must be within 0.25..=4.0".to_string(),
        ));
    }
    Ok(speed)
}

fn validate_master_volume(master_volume: f64) -> AppResult<f64> {
    if !master_volume.is_finite() {
        return Err(AppError::InvalidInput(
            "Segment masterVolume must be finite".to_string(),
        ));
    }
    Ok(master_volume.clamp(0.0, 100.0))
}

pub fn clamp_segment_vibrance(raw: f64) -> f64 {
    if raw.is_finite() {
        raw.clamp(-100.0, 100.0)
    } else {
        0.0
    }
}

pub fn clamp_segment_saturation(raw: f64) -> f64 {
    if raw.is_finite() {
        raw.clamp(0.0, 200.0)
    } else {
        100.0
    }
}

pub fn parse_editor_framing(raw: &str) -> EditorFraming {
    match raw.trim().to_ascii_lowercase().as_str() {
        "fill" => EditorFraming::Fill,
        "stretch" => EditorFraming::Stretch,
        _ => EditorFraming::Fit,
    }
}

pub fn build_segment_color_filters(vibrance: f64, saturation: f64) -> Vec<String> {
    let v = clamp_segment_vibrance(vibrance);
    let s = clamp_segment_saturation(saturation);
    let mut filters = Vec::new();
    if (v - 0.0).abs() > 0.5 {
        filters.push(format!("vibrance=intensity={:.2}", v / 100.0));
    }
    if (s - 100.0).abs() > 0.5 {
        filters.push(format!("eq=saturation={:.2}", s / 100.0));
    }
    filters
}

pub fn prepare_editor_timeline(
    db: &Db,
    request: &StartEditorExportRequest,
) -> AppResult<PreparedEditorTimeline> {
    if request.segments.is_empty() {
        return Err(AppError::InvalidInput(
            "At least 1 segment is required for editor export".to_string(),
        ));
    }

    let preset_mode = parse_editor_preset(&request.preset)?;
    let vertical_mode = parse_editor_vertical_style(&request.vertical_style)?;

    let mut prepared = Vec::with_capacity(request.segments.len());
    let mut first_game_id: Option<String> = None;
    let mut same_game = true;
    let mut first_source_type = SourceType::Custom;

    let total_segments = request.segments.len();
    for (idx, seg) in request.segments.iter().enumerate() {
        let prev_info = prepared.last().map(|p: &PreparedEditorSegment| {
            (p.effective_dur, transition_in_reserve_sec(p.transition_in))
        });
        let (seg_prepared, game_id, source_type) = prepare_single_segment(
            db,
            idx,
            total_segments,
            seg,
            prev_info.map(|(d, _)| d),
            prev_info.map(|(_, r)| r).unwrap_or(0.0),
        )?;
        if idx == 0 {
            first_game_id = game_id;
            first_source_type = source_type;
        } else if game_id != first_game_id {
            same_game = false;
        }
        prepared.push(seg_prepared);
    }

    let total_duration = compute_timeline_duration(&prepared);
    let mut audio_layers = Vec::with_capacity(request.audio_layers.len());
    for layer in &request.audio_layers {
        audio_layers.push(prepare_single_audio_layer(layer)?);
    }

    let inherited_game_id = if same_game { first_game_id } else { None };
    let inherited_source_type = if inherited_game_id.is_some() {
        first_source_type
    } else {
        SourceType::Custom
    };

    Ok(PreparedEditorTimeline {
        segments: prepared,
        audio_layers,
        preset_mode,
        vertical_mode,
        total_duration,
        inherited_game_id,
        inherited_source_type,
    })
}

fn prepare_single_audio_layer(layer: &EditorAudioLayerInput) -> AppResult<PreparedEditorAudioLayer> {
    let src_path = normalize_windows_path(Path::new(&layer.file_path));
    if !src_path.exists() || !src_path.is_file() {
        return Err(AppError::NotFound(format!(
            "Audio layer file not found: {}",
            src_path.to_string_lossy()
        )));
    }
    if !layer.timeline_offset_sec.is_finite() || layer.timeline_offset_sec < 0.0 {
        return Err(AppError::InvalidInput(
            "Audio layer timelineOffsetSec must be finite and >= 0".to_string(),
        ));
    }
    if !layer.trim_start_sec.is_finite()
        || !layer.trim_end_sec.is_finite()
        || layer.trim_start_sec < 0.0
    {
        return Err(AppError::InvalidInput(
            "Audio layer trim range must be finite and >= 0".to_string(),
        ));
    }
    let active_dur = layer.trim_end_sec - layer.trim_start_sec;
    if active_dur < MIN_EDITOR_SEGMENT_SEC {
        return Err(AppError::InvalidInput(format!(
            "Audio layer active duration must be at least {MIN_EDITOR_SEGMENT_SEC}s"
        )));
    }
    let volume = if layer.volume.is_finite() {
        layer.volume.clamp(0.0, 200.0)
    } else {
        100.0
    };

    Ok(PreparedEditorAudioLayer {
        file_path: src_path.to_string_lossy().to_string(),
        timeline_offset_sec: layer.timeline_offset_sec,
        trim_start_sec: layer.trim_start_sec,
        active_dur,
        volume,
        muted: layer.muted,
    })
}

fn prepare_single_segment(
    db: &Db,
    index: usize,
    total_segments: usize,
    seg: &EditorSegmentInput,
    prev_effective_dur: Option<f64>,
    prev_in_reserve_sec: f64,
) -> AppResult<(PreparedEditorSegment, Option<String>, SourceType)> {
    let speed = validate_segment_speed(seg.speed)?;
    let master_volume = validate_master_volume(seg.master_volume)?;

    let detail = db.get_clip_detail(&seg.clip_id, "", "")?;
    if detail.clip.is_missing {
        return Err(AppError::NotFound(format!(
            "Clip '{}' is missing",
            seg.clip_id
        )));
    }
    let src_path = normalize_windows_path(Path::new(&detail.clip.file_path));
    if !src_path.exists() {
        return Err(AppError::NotFound(format!(
            "Source video file not found for clip '{}'",
            seg.clip_id
        )));
    }

    let (start_sec, _, raw_dur) = validate_export_range(
        seg.start_sec,
        seg.end_sec,
        detail.clip.duration_sec,
        MIN_EDITOR_SEGMENT_SEC,
    )?;
    let effective_dur = raw_dur / speed;
    let transition_in = parse_segment_transition_in(
        index,
        &seg.transition_in,
        seg.transition_in_duration_sec,
        seg.crossfade_duration_sec,
        prev_effective_dur,
        prev_in_reserve_sec,
        effective_dur,
    )?;
    let transition_out = parse_segment_transition_out(
        index + 1 == total_segments,
        &seg.transition_out,
        seg.transition_out_duration_sec,
        transition_in_reserve_sec(transition_in),
        effective_dur,
    )?;

    let prepared = PreparedEditorSegment {
        clip_id: detail.clip.id,
        file_path: src_path.to_string_lossy().to_string(),
        start_sec,
        raw_dur,
        effective_dur,
        speed,
        src_height: detail.clip.height,
        track_count: detail.audio_tracks.len().max(detail.clip.audio_track_count as usize),
        audio_mix: seg.audio_mix.clone(),
        master_volume,
        master_muted: seg.master_muted,
        transition_in,
        transition_out,
        vibrance: clamp_segment_vibrance(seg.vibrance),
        saturation: clamp_segment_saturation(seg.saturation),
        framing: parse_editor_framing(&seg.framing),
    };

    Ok((prepared, detail.clip.game_id, detail.clip.source_type))
}

pub fn compute_timeline_duration(segments: &[PreparedEditorSegment]) -> f64 {
    let sum: f64 = segments
        .iter()
        .enumerate()
        .map(|(idx, seg)| {
            let overlap = if idx > 0 {
                match seg.transition_in {
                    EditorTransitionMode::Crossfade(d) => d,
                    EditorTransitionMode::Cut | EditorTransitionMode::Fade(_) => 0.0,
                }
            } else {
                0.0
            };
            seg.effective_dur - overlap
        })
        .sum();
    sum.max(MIN_EDITOR_SEGMENT_SEC)
}

pub fn build_atempo_filters(speed: f64) -> Vec<String> {
    if (speed - 1.0).abs() < 0.001 {
        return Vec::new();
    }
    let mut filters = Vec::new();
    let mut rem = speed.clamp(0.25, 4.0);
    while rem < 0.5 {
        filters.push("atempo=0.5".to_string());
        rem /= 0.5;
    }
    while rem > 2.0 {
        filters.push("atempo=2.0".to_string());
        rem /= 2.0;
    }
    if (rem - 1.0).abs() >= 0.0005 {
        filters.push(format!("atempo={rem:.6}"));
    }
    filters
}

fn target_dimensions(vertical_mode: EditorVerticalMode, downscale_720p: bool) -> (i32, i32) {
    match vertical_mode {
        EditorVerticalMode::None => {
            if downscale_720p {
                (1280, 720)
            } else {
                (1920, 1080)
            }
        }
        EditorVerticalMode::Blur | EditorVerticalMode::Crop => {
            if downscale_720p {
                (720, 1280)
            } else {
                (1080, 1920)
            }
        }
    }
}

fn append_segment_video_filter(
    fc_parts: &mut Vec<String>,
    idx: usize,
    seg: &PreparedEditorSegment,
    vertical_mode: EditorVerticalMode,
    downscale_720p: bool,
) {
    let (w, h) = target_dimensions(vertical_mode, downscale_720p);
    let pts_expr = if (seg.speed - 1.0).abs() < 0.001 {
        "setpts=PTS-STARTPTS".to_string()
    } else {
        format!("setpts=(PTS-STARTPTS)/{:.6}", seg.speed)
    };
    let color_filters = build_segment_color_filters(seg.vibrance, seg.saturation);
    let color_suffix = if color_filters.is_empty() {
        String::new()
    } else {
        format!(",{}", color_filters.join(","))
    };

    match (vertical_mode, seg.framing) {
        (EditorVerticalMode::Blur, EditorFraming::Fit) => {
            fc_parts.push(format!(
                "[{idx}:v:0]{pts_expr},split=2[bg_src{idx}][fg_src{idx}];[bg_src{idx}]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=24:6,setsar=1[bg{idx}];[fg_src{idx}]scale={w}:-2:force_original_aspect_ratio=decrease,setsar=1[fg{idx}];[bg{idx}][fg{idx}]overlay=(W-w)/2:(H-h)/2,setsar=1{color_suffix},fps=60,format=yuv420p,settb=AVTB[v{idx}]"
            ));
        }
        (EditorVerticalMode::Blur, EditorFraming::Stretch) => {
            let fg_h = if downscale_720p { 406 } else { 608 };
            fc_parts.push(format!(
                "[{idx}:v:0]{pts_expr},split=2[bg_src{idx}][fg_src{idx}];[bg_src{idx}]scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},boxblur=24:6,setsar=1[bg{idx}];[fg_src{idx}]scale={w}:{fg_h},setsar=1[fg{idx}];[bg{idx}][fg{idx}]overlay=(W-w)/2:(H-h)/2,setsar=1{color_suffix},fps=60,format=yuv420p,settb=AVTB[v{idx}]"
            ));
        }
        (EditorVerticalMode::Crop, EditorFraming::Stretch) => {
            let (stretch_w, stretch_h) = if downscale_720p {
                (1280, 720)
            } else {
                (1920, 1080)
            };
            fc_parts.push(format!(
                "[{idx}:v:0]{pts_expr},scale={stretch_w}:{stretch_h},setsar=1,scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1{color_suffix},fps=60,format=yuv420p,settb=AVTB[v{idx}]"
            ));
        }
        (EditorVerticalMode::Crop, EditorFraming::Fit | EditorFraming::Fill)
        | (_, EditorFraming::Fill) => {
            fc_parts.push(format!(
                "[{idx}:v:0]{pts_expr},scale={w}:{h}:force_original_aspect_ratio=increase,crop={w}:{h},setsar=1{color_suffix},fps=60,format=yuv420p,settb=AVTB[v{idx}]"
            ));
        }
        (EditorVerticalMode::None, EditorFraming::Fit) => {
            fc_parts.push(format!(
                "[{idx}:v:0]{pts_expr},scale={w}:{h}:force_original_aspect_ratio=decrease,pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:black,setsar=1{color_suffix},fps=60,format=yuv420p,settb=AVTB[v{idx}]"
            ));
        }
        (EditorVerticalMode::None, EditorFraming::Stretch) => {
            fc_parts.push(format!(
                "[{idx}:v:0]{pts_expr},scale={w}:{h},setsar=1{color_suffix},fps=60,format=yuv420p,settb=AVTB[v{idx}]"
            ));
        }
    }
}

fn append_segment_audio_filter(
    fc_parts: &mut Vec<String>,
    idx: usize,
    seg: &PreparedEditorSegment,
) {
    let master_gain = (seg.master_volume.clamp(0.0, 100.0)) / 100.0;
    if seg.master_muted || master_gain <= 0.001 || seg.track_count == 0 {
        fc_parts.push(format!(
            "anullsrc=r=48000:cl=stereo:d={:.3}[a{idx}]",
            seg.effective_dur.max(0.1)
        ));
        return;
    }

    let tempo_filters = build_atempo_filters(seg.speed);
    let mut tail = tempo_filters;
    tail.push("aformat=sample_rates=48000:channel_layouts=stereo".to_string());
    tail.push("asetpts=PTS-STARTPTS".to_string());
    let tail_chain = tail.join(",");

    if seg.audio_mix.is_empty() {
        let mut chain = Vec::new();
        if (master_gain - 1.0).abs() > 0.01 {
            chain.push(format!("volume={master_gain:.3}"));
        }
        chain.push(tail_chain);
        fc_parts.push(format!("[{idx}:a:0]{}[a{idx}]", chain.join(",")));
        return;
    }

    let active: Vec<(&AudioTrackMix, f64)> = seg
        .audio_mix
        .iter()
        .filter_map(|track| {
            if track.muted {
                return None;
            }
            let combined = (track.volume.clamp(0.0, 2.0) * master_gain).clamp(0.0, 2.0);
            if combined <= 0.001 {
                None
            } else {
                Some((track, combined))
            }
        })
        .collect();

    if active.is_empty() {
        fc_parts.push(format!(
            "anullsrc=r=48000:cl=stereo:d={:.3}[a{idx}]",
            seg.effective_dur.max(0.1)
        ));
    } else if active.len() == 1 {
        let (track, combined) = active[0];
        let mut chain = Vec::new();
        if (combined - 1.0).abs() > 0.01 {
            chain.push(format!("volume={combined:.3}"));
        }
        chain.push(tail_chain);
        fc_parts.push(format!(
            "[{idx}:{}]{}[a{idx}]",
            track.stream_index,
            chain.join(",")
        ));
    } else {
        let mut mix_inputs = String::new();
        for (t_idx, (track, combined)) in active.iter().enumerate() {
            fc_parts.push(format!(
                "[{idx}:{}]volume={combined:.3}[a{idx}_{t_idx}]",
                track.stream_index
            ));
            mix_inputs.push_str(&format!("[a{idx}_{t_idx}]"));
        }
        fc_parts.push(format!(
            "{mix_inputs}amix=inputs={}:duration=longest:normalize=0,{tail_chain}[a{idx}]",
            active.len()
        ));
    }
}

#[allow(clippy::too_many_arguments)]
pub fn build_editor_export_args(
    segments: &[PreparedEditorSegment],
    audio_layers: &[PreparedEditorAudioLayer],
    out_path: &Path,
    vertical_mode: EditorVerticalMode,
    normalize_audio: bool,
    bitrate_plan: Option<&BitratePlan>,
    encoder: &str,
    with_progress: bool,
) -> Vec<String> {
    let mut args = vec!["-y".to_string()];
    let mut fc_parts = Vec::new();
    let downscale_720p = bitrate_plan.is_some_and(|p| p.downscale_720p);
    let total_duration = compute_timeline_duration(segments);
    let audible_layers: Vec<&PreparedEditorAudioLayer> = audio_layers
        .iter()
        .filter(|layer| layer.is_audible(total_duration))
        .collect();
    let has_music = !audible_layers.is_empty();

    for (idx, seg) in segments.iter().enumerate() {
        args.extend([
            "-ss".to_string(),
            format!("{:.3}", seg.start_sec),
            "-t".to_string(),
            format!("{:.3}", seg.raw_dur),
            "-i".to_string(),
            seg.file_path.clone(),
        ]);

        append_segment_video_filter(&mut fc_parts, idx, seg, vertical_mode, downscale_720p);
        append_segment_audio_filter(&mut fc_parts, idx, seg);
    }

    for layer in &audible_layers {
        let clipped_dur = layer.clipped_dur(total_duration);
        args.extend([
            "-ss".to_string(),
            format!("{:.3}", layer.trim_start_sec),
            "-t".to_string(),
            format!("{clipped_dur:.3}"),
            "-i".to_string(),
            layer.file_path.clone(),
        ]);
    }

    let has_crossfade = segments
        .iter()
        .skip(1)
        .any(|s| matches!(s.transition_in, EditorTransitionMode::Crossfade(_)));

    let fade_in_sec = match segments.first().map(|s| s.transition_in) {
        Some(EditorTransitionMode::Fade(d)) if d >= MIN_TRANSITION_SEC => d,
        _ => 0.0,
    };
    let fade_out_sec = match segments.last().map(|s| s.transition_out) {
        Some(EditorTransitionOutMode::Fade(d)) if d >= MIN_TRANSITION_SEC => d,
        _ => 0.0,
    };
    let has_edge_fade = fade_in_sec > 0.0 || fade_out_sec > 0.0;
    let has_any_clip_audio = segments.iter().any(|s| s.has_audible_audio());

    let (pre_fade_v, pre_fade_a) = if segments.len() == 1 {
        ("[v0]".to_string(), "[a0]".to_string())
    } else if !has_crossfade {
        let mut concat_inputs = String::new();
        for idx in 0..segments.len() {
            concat_inputs.push_str(&format!("[v{idx}][a{idx}]"));
        }
        let v_target = if has_edge_fade { "[v_cat]" } else { "[vout]" };
        let a_target = if normalize_audio || has_music || (has_edge_fade && has_any_clip_audio) {
            "[a_cat]"
        } else {
            "[aout]"
        };
        fc_parts.push(format!(
            "{concat_inputs}concat=n={}:v=1:a=1{v_target}{a_target}",
            segments.len()
        ));
        (v_target.to_string(), a_target.to_string())
    } else {
        let mut v_acc = "[v0]".to_string();
        let mut a_acc = "[a0]".to_string();
        let mut acc_dur = segments[0].effective_dur;

        let needs_a_post = normalize_audio || has_music || (has_edge_fade && has_any_clip_audio);
        for (idx, seg) in segments.iter().enumerate().skip(1) {
            let is_last = idx + 1 == segments.len();
            let v_out = if is_last && !has_edge_fade {
                "[vout]".to_string()
            } else {
                format!("[vm{idx}]")
            };
            let a_out = if is_last && !needs_a_post {
                "[aout]".to_string()
            } else {
                format!("[am{idx}]")
            };

            match seg.transition_in {
                EditorTransitionMode::Cut | EditorTransitionMode::Fade(_) => {
                    fc_parts.push(format!(
                        "{v_acc}{a_acc}[v{idx}][a{idx}]concat=n=2:v=1:a=1{v_out}{a_out}"
                    ));
                    acc_dur += seg.effective_dur;
                }
                EditorTransitionMode::Crossfade(xf_dur) => {
                    let offset = (acc_dur - xf_dur).max(0.0);
                    fc_parts.push(format!(
                        "{v_acc}[v{idx}]xfade=transition=fade:duration={xf_dur:.3}:offset={offset:.3}{v_out}"
                    ));
                    fc_parts.push(format!(
                        "{a_acc}[a{idx}]acrossfade=d={xf_dur:.3}{a_out}"
                    ));
                    acc_dur = (acc_dur + seg.effective_dur - xf_dur).max(0.1);
                }
            }

            v_acc = v_out;
            a_acc = a_out;
        }

        (v_acc, a_acc)
    };

    let final_v = if has_edge_fade {
        let mut v_fades = Vec::new();
        if fade_in_sec > 0.0 {
            v_fades.push(format!("fade=t=in:st=0:d={fade_in_sec:.3}"));
        }
        if fade_out_sec > 0.0 {
            let fade_out_start = (total_duration - fade_out_sec).max(0.0);
            v_fades.push(format!(
                "fade=t=out:st={fade_out_start:.3}:d={fade_out_sec:.3}"
            ));
        }
        fc_parts.push(format!("{pre_fade_v}{}[vout]", v_fades.join(",")));
        "[vout]".to_string()
    } else {
        pre_fade_v
    };

    let avideo_label = if has_edge_fade && has_any_clip_audio {
        let mut a_fades = Vec::new();
        if fade_in_sec > 0.0 {
            a_fades.push(format!("afade=t=in:st=0:d={fade_in_sec:.3}"));
        }
        if fade_out_sec > 0.0 {
            let fade_out_start = (total_duration - fade_out_sec).max(0.0);
            a_fades.push(format!(
                "afade=t=out:st={fade_out_start:.3}:d={fade_out_sec:.3}"
            ));
        }
        let target = if normalize_audio || has_music {
            "[avideo_faded]"
        } else {
            "[aout]"
        };
        fc_parts.push(format!("{pre_fade_a}{}{target}", a_fades.join(",")));
        target.to_string()
    } else {
        pre_fade_a
    };

    let final_a = if has_music {
        let mut music_inputs = String::new();
        for (i, layer) in audible_layers.iter().enumerate() {
            let m_idx = segments.len() + i;
            let clipped_dur = layer.clipped_dur(total_duration);
            let vol_factor = (layer.volume / 100.0).clamp(0.0, 2.0);
            let delay_ms = (layer.timeline_offset_sec * 1000.0).round() as u64;
            fc_parts.push(format!(
                "[{m_idx}:a:0]atrim=0:{clipped_dur:.3},asetpts=PTS-STARTPTS,volume={vol_factor:.3},aformat=sample_rates=48000:channel_layouts=stereo,adelay={delay_ms}|{delay_ms}[amusic{i}]"
            ));
            music_inputs.push_str(&format!("[amusic{i}]"));
        }

        let mix_target = if normalize_audio { "[amixed]" } else { "[aout]" };
        fc_parts.push(format!(
            "{avideo_label}{music_inputs}amix=inputs={}:duration=first:dropout_transition=0:normalize=0{mix_target}",
            1 + audible_layers.len()
        ));
        if normalize_audio {
            fc_parts.push(format!("[amixed]{LOUDNORM_FILTER}[aout]"));
        }
        "[aout]".to_string()
    } else if normalize_audio {
        fc_parts.push(format!("{avideo_label}{LOUDNORM_FILTER}[aout]"));
        "[aout]".to_string()
    } else {
        avideo_label
    };

    args.extend([
        "-filter_complex".to_string(),
        fc_parts.join(";"),
        "-map".to_string(),
        final_v,
        "-map".to_string(),
        final_a,
    ]);

    let audio_kbps = match bitrate_plan {
        Some(plan) => {
            append_bitrate_video_encoder_args(&mut args, plan, encoder);
            plan.audio_kbps.max(96)
        }
        None => {
            append_hq_video_encoder_args(&mut args, encoder, 19, 19);
            192
        }
    };

    args.extend([
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        format!("{audio_kbps}k"),
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
pub async fn execute_editor_export_pipeline(
    on_progress: Option<ProgressCallback>,
    job_id: &str,
    segments: &[PreparedEditorSegment],
    audio_layers: &[PreparedEditorAudioLayer],
    out_path: &Path,
    total_duration: f64,
    preset_mode: EditorPresetMode,
    vertical_mode: EditorVerticalMode,
    normalize_audio: bool,
    hw_encoders: &[&str],
    ctrl: &ActiveJobControl,
) -> Result<(i64, String), ExportRunError> {
    match preset_mode {
        EditorPresetMode::Original => {
            run_hw_with_x264_fallback(
                on_progress,
                job_id,
                out_path,
                total_duration,
                None,
                hw_encoders,
                ctrl,
                |encoder| {
                    build_editor_export_args(
                        segments,
                        audio_layers,
                        out_path,
                        vertical_mode,
                        normalize_audio,
                        None,
                        encoder,
                        true,
                    )
                },
            )
            .await
        }
        EditorPresetMode::Discord(preset) => {
            let has_active_audio = segments.iter().any(|s| s.has_audible_audio())
                || audio_layers.iter().any(|a| a.is_audible(total_duration));
            let max_src_height = segments.iter().map(|s| s.src_height).max().unwrap_or(1080);
            let plan = calculate_discord_bitrate(preset, total_duration, max_src_height, has_active_audio)
                .expect("discord preset returns bitrate plan");

            if let Err(msg) = validate_export_plan(preset, &plan) {
                tokio::time::sleep(std::time::Duration::from_millis(25)).await;
                return Err(ExportRunError::Failed(msg));
            }

            run_discord_export_with_retry(
                on_progress,
                job_id,
                out_path,
                total_duration,
                max_src_height,
                preset,
                plan,
                hw_encoders,
                ctrl,
                |active_plan, encoder| {
                    build_editor_export_args(
                        segments,
                        audio_layers,
                        out_path,
                        vertical_mode,
                        normalize_audio,
                        Some(active_plan),
                        encoder,
                        true,
                    )
                },
            )
            .await
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_seg(path: &str, start: f64, end: f64, speed: f64, transition: EditorTransitionMode) -> PreparedEditorSegment {
        PreparedEditorSegment {
            clip_id: "c1".to_string(),
            file_path: path.to_string(),
            start_sec: start,
            raw_dur: end - start,
            effective_dur: (end - start) / speed,
            speed,
            src_height: 1080,
            track_count: 2,
            audio_mix: vec![AudioTrackMix {
                track_order: 0,
                stream_index: 1,
                muted: false,
                volume: 1.0,
            }],
            master_volume: 100.0,
            master_muted: false,
            transition_in: transition,
            transition_out: EditorTransitionOutMode::Cut,
            vibrance: 0.0,
            saturation: 100.0,
            framing: EditorFraming::Fit,
        }
    }

    #[test]
    fn builds_editor_cut_concat_args_with_speed_and_vertical_blur() {
        let segs = vec![
            sample_seg(r"C:\a.mp4", 1.0, 4.0, 1.5, EditorTransitionMode::Cut),
            sample_seg(r"C:\b.mp4", 0.0, 2.0, 1.0, EditorTransitionMode::Cut),
        ];
        let args = build_editor_export_args(
            &segs,
            &[],
            Path::new(r"C:\out.mp4"),
            EditorVerticalMode::Blur,
            true,
            None,
            "h264_nvenc",
            true,
        );
        let fc = args
            .windows(2)
            .find(|w| w[0] == "-filter_complex")
            .map(|w| w[1].clone())
            .expect("filter_complex");

        assert!(fc.contains("setpts=(PTS-STARTPTS)/1.500000"));
        assert!(fc.contains("boxblur=24:6"));
        assert!(fc.contains("scale=1080:1920"));
        assert!(fc.contains("atempo=1.500000"));
        assert!(fc.contains("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][a_cat]"));
        assert!(fc.contains("[a_cat]loudnorm=I=-16:TP=-1.5:LRA=11[aout]"));
    }

    #[test]
    fn builds_editor_crossfade_and_mixed_cut_args_with_discord_bitrate() {
        let mut seg1 = sample_seg(r"C:\a.mp4", 0.0, 4.0, 1.0, EditorTransitionMode::Cut);
        seg1.master_muted = true;
        let seg2 = sample_seg(
            r"C:\b.mp4",
            2.0,
            6.0,
            2.0,
            EditorTransitionMode::Crossfade(0.35),
        );
        let seg3 = sample_seg(r"C:\c.mp4", 1.0, 3.0, 0.5, EditorTransitionMode::Cut);
        let segs = vec![seg1, seg2, seg3];

        let total_dur = compute_timeline_duration(&segs);
        // 4.0 + (4.0 / 2.0 - 0.35) + (2.0 / 0.5) = 4.0 + 1.65 + 4.0 = 9.65
        assert!((total_dur - 9.65).abs() < 0.001);

        let plan = calculate_discord_bitrate(ExportPreset::Discord10mb, total_dur, 1080, true)
            .expect("discord plan");
        let args = build_editor_export_args(
            &segs,
            &[],
            Path::new(r"C:\discord_edit.mp4"),
            EditorVerticalMode::None,
            false,
            Some(&plan),
            "h264_amf",
            true,
        );
        let fc = args
            .windows(2)
            .find(|w| w[0] == "-filter_complex")
            .map(|w| w[1].clone())
            .expect("filter_complex");

        // Segment 0 is masterMuted -> anullsrc
        assert!(fc.contains("anullsrc=r=48000:cl=stereo:d=4.000[a0]"));
        // Segment 0->1 crossfade at offset = 4.0 - 0.35 = 3.650
        assert!(fc.contains("[v0][v1]xfade=transition=fade:duration=0.350:offset=3.650[vm1]"));
        assert!(fc.contains("[a0][a1]acrossfade=d=0.350[am1]"));
        // Segment 1->2 cut via concat
        assert!(fc.contains("[vm1][am1][v2][a2]concat=n=2:v=1:a=1[vout][aout]"));
        assert!(fc.contains("atempo=0.500000"));
        assert!(args.windows(2).any(|w| w == ["-c:v", "h264_amf"]));
    }

    #[test]
    fn enforces_crossfade_and_speed_guardrails() {
        assert!(validate_segment_speed(0.25).is_ok());
        assert!(validate_segment_speed(4.0).is_ok());
        assert!(validate_segment_speed(0.1).is_err());
        assert!(validate_segment_speed(4.5).is_err());
        assert!(validate_segment_speed(f64::NAN).is_err());

        // Index 0: "crossfade" locked to Cut, "fade" allowed up to min(3.0, dur - 0.20)
        let t0_cf = parse_segment_transition_in(0, "crossfade", Some(0.35), 0.35, None, 0.0, 2.0)
            .expect("t0_cf");
        assert_eq!(t0_cf, EditorTransitionMode::Cut);
        let t0_fade = parse_segment_transition_in(0, "fade", Some(1.25), 0.0, None, 0.0, 2.0)
            .expect("t0_fade");
        assert_eq!(t0_fade, EditorTransitionMode::Fade(1.25));

        // Adjacent segment with left reserve leaving < 0.10s available falls back to Cut
        let t1_short =
            parse_segment_transition_in(1, "crossfade", Some(0.35), 0.35, Some(1.0), 0.75, 2.0)
                .expect("t1_short");
        assert_eq!(t1_short, EditorTransitionMode::Cut);

        // Dynamic crossfade > 1.0s allowed and clamped against leftReserve + 0.20
        let t1_dyn =
            parse_segment_transition_in(1, "crossfade", Some(2.50), 0.35, Some(3.0), 1.0, 4.0)
                .expect("t1_dyn");
        // prev_avail = 3.0 - 1.0 - 0.20 = 1.80
        assert_eq!(t1_dyn, EditorTransitionMode::Crossfade(1.80));

        // Transition out only allowed on last segment and clamped against in_reserve + 0.20
        let tout_mid = parse_segment_transition_out(false, "fade", 1.0, 0.0, 4.0).expect("tout_mid");
        assert_eq!(tout_mid, EditorTransitionOutMode::Cut);
        let tout_last =
            parse_segment_transition_out(true, "fade", 2.0, 1.2, 2.5).expect("tout_last");
        // max_fade = 2.5 - 1.2 - 0.20 = 1.10
        assert_eq!(tout_last, EditorTransitionOutMode::Fade(1.10));

        assert_eq!(build_atempo_filters(0.25), vec!["atempo=0.5", "atempo=0.500000"]);
        assert_eq!(build_atempo_filters(4.0), vec!["atempo=2.0", "atempo=2.000000"]);
    }

    #[test]
    fn builds_color_grading_and_framing_filters_with_extreme_value_clamping() {
        assert!((clamp_segment_vibrance(-250.0) - (-100.0)).abs() < f64::EPSILON);
        assert!((clamp_segment_vibrance(250.0) - 100.0).abs() < f64::EPSILON);
        assert!((clamp_segment_vibrance(f64::NAN) - 0.0).abs() < f64::EPSILON);

        assert!((clamp_segment_saturation(-50.0) - 0.0).abs() < f64::EPSILON);
        assert!((clamp_segment_saturation(500.0) - 200.0).abs() < f64::EPSILON);
        assert!((clamp_segment_saturation(f64::INFINITY) - 100.0).abs() < f64::EPSILON);

        assert_eq!(parse_editor_framing("fill"), EditorFraming::Fill);
        assert_eq!(parse_editor_framing("  STRETCH "), EditorFraming::Stretch);
        assert_eq!(parse_editor_framing("fit"), EditorFraming::Fit);
        assert_eq!(parse_editor_framing("unknown"), EditorFraming::Fit);

        // Default and near-default values emit no color filters
        assert!(build_segment_color_filters(0.0, 100.0).is_empty());
        assert!(build_segment_color_filters(0.4, 99.6).is_empty());

        let mut seg_fit = sample_seg(r"C:\fit.mp4", 0.0, 2.0, 1.0, EditorTransitionMode::Cut);
        seg_fit.framing = EditorFraming::Fit;

        let mut seg_fill = sample_seg(r"C:\fill.mp4", 0.0, 2.0, 1.0, EditorTransitionMode::Cut);
        seg_fill.framing = EditorFraming::Fill;
        seg_fill.vibrance = 150.0; // clamps to 100.0 -> intensity=1.00
        seg_fill.saturation = 145.0; // 1.45

        let mut seg_stretch = sample_seg(r"C:\stretch.mp4", 0.0, 2.0, 1.0, EditorTransitionMode::Cut);
        seg_stretch.framing = EditorFraming::Stretch;
        seg_stretch.vibrance = -150.0; // clamps to -100.0 -> intensity=-1.00
        seg_stretch.saturation = -20.0; // clamps to 0.0 -> saturation=0.00

        let args = build_editor_export_args(
            &[seg_fit, seg_fill, seg_stretch],
            &[],
            Path::new(r"C:\out_v2.mp4"),
            EditorVerticalMode::None,
            false,
            None,
            "libx264",
            true,
        );
        let fc = args
            .windows(2)
            .find(|w| w[0] == "-filter_complex")
            .map(|w| w[1].clone())
            .expect("filter_complex");

        // Fit with verticalStyle == none -> pad black, no color filters
        assert!(fc.contains("[0:v:0]setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=60,format=yuv420p,settb=AVTB[v0]"));
        // Fill + clamped vibrance 1.00 + saturation 1.45
        assert!(fc.contains("[1:v:0]setpts=PTS-STARTPTS,scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,setsar=1,vibrance=intensity=1.00,eq=saturation=1.45,fps=60,format=yuv420p,settb=AVTB[v1]"));
        // Stretch + clamped vibrance -1.00 + saturation 0.00
        assert!(fc.contains("[2:v:0]setpts=PTS-STARTPTS,scale=1920:1080,setsar=1,vibrance=intensity=-1.00,eq=saturation=0.00,fps=60,format=yuv420p,settb=AVTB[v2]"));

        // Vertical blur: Fit keeps blur background, Fill crops 1080x1920, Stretch keeps blur background + 16:9 foreground (1080x608)
        let mut v_fit = sample_seg(r"C:\vfit.mp4", 0.0, 2.0, 1.0, EditorTransitionMode::Cut);
        v_fit.framing = EditorFraming::Fit;
        v_fit.vibrance = 40.0;

        let mut v_fill = sample_seg(r"C:\vfill.mp4", 0.0, 2.0, 1.0, EditorTransitionMode::Cut);
        v_fill.framing = EditorFraming::Fill;

        let mut v_stretch = sample_seg(r"C:\vstretch.mp4", 0.0, 2.0, 1.0, EditorTransitionMode::Cut);
        v_stretch.framing = EditorFraming::Stretch;
        v_stretch.saturation = 75.0;

        let v_args = build_editor_export_args(
            &[v_fit, v_fill, v_stretch.clone()],
            &[],
            Path::new(r"C:\out_v2_vert.mp4"),
            EditorVerticalMode::Blur,
            false,
            None,
            "libx264",
            true,
        );
        let v_fc = v_args
            .windows(2)
            .find(|w| w[0] == "-filter_complex")
            .map(|w| w[1].clone())
            .expect("vertical filter_complex");

        assert!(v_fc.contains("[0:v:0]setpts=PTS-STARTPTS,split=2[bg_src0][fg_src0];[bg_src0]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:6,setsar=1[bg0];[fg_src0]scale=1080:-2:force_original_aspect_ratio=decrease,setsar=1[fg0];[bg0][fg0]overlay=(W-w)/2:(H-h)/2,setsar=1,vibrance=intensity=0.40,fps=60"));
        assert!(v_fc.contains("[1:v:0]setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=60"));
        assert!(v_fc.contains("[2:v:0]setpts=PTS-STARTPTS,split=2[bg_src2][fg_src2];[bg_src2]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=24:6,setsar=1[bg2];[fg_src2]scale=1080:608,setsar=1[fg2];[bg2][fg2]overlay=(W-w)/2:(H-h)/2,setsar=1,eq=saturation=0.75,fps=60"));
        assert!(!v_fc.contains("scale=1080:1920,setsar=1"));

        // Vertical crop + Stretch: stretches to 16:9 first, then center-crops to 9:16
        let crop_args = build_editor_export_args(
            std::slice::from_ref(&v_stretch),
            &[],
            Path::new(r"C:\out_v2_crop.mp4"),
            EditorVerticalMode::Crop,
            false,
            None,
            "libx264",
            true,
        );
        let crop_fc = crop_args
            .windows(2)
            .find(|w| w[0] == "-filter_complex")
            .map(|w| w[1].clone())
            .expect("vertical crop filter_complex");
        assert!(crop_fc.contains("[0:v:0]setpts=PTS-STARTPTS,scale=1920:1080,setsar=1,scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,eq=saturation=0.75,fps=60"));

        // Downscale 720p variants for Blur+Stretch (720x406 fg) and Crop+Stretch (1280x720 -> 720x1280 crop)
        let plan_720p = BitratePlan {
            effective_mb: 9.2,
            duration_sec: 70.0,
            video_kbps: 900,
            audio_kbps: 96,
            downscale_720p: true,
            too_long_warning: false,
        };
        let blur_720_args = build_editor_export_args(
            std::slice::from_ref(&v_stretch),
            &[],
            Path::new(r"C:\out_v2_blur_720.mp4"),
            EditorVerticalMode::Blur,
            false,
            Some(&plan_720p),
            "libx264",
            true,
        );
        let blur_720_fc = blur_720_args
            .windows(2)
            .find(|w| w[0] == "-filter_complex")
            .map(|w| w[1].clone())
            .expect("vertical blur 720p filter_complex");
        assert!(blur_720_fc.contains("[fg_src0]scale=720:406,setsar=1[fg0]"));

        let crop_720_args = build_editor_export_args(
            std::slice::from_ref(&v_stretch),
            &[],
            Path::new(r"C:\out_v2_crop_720.mp4"),
            EditorVerticalMode::Crop,
            false,
            Some(&plan_720p),
            "libx264",
            true,
        );
        let crop_720_fc = crop_720_args
            .windows(2)
            .find(|w| w[0] == "-filter_complex")
            .map(|w| w[1].clone())
            .expect("vertical crop 720p filter_complex");
        assert!(crop_720_fc.contains("[0:v:0]setpts=PTS-STARTPTS,scale=1280:720,setsar=1,scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,setsar=1,eq=saturation=0.75,fps=60"));
    }

    #[test]
    fn builds_audio_layer_mixing_with_adelay_volume_mute_and_loudnorm() {
        let mut seg0 = sample_seg(r"C:\vid0.mp4", 0.0, 5.0, 1.0, EditorTransitionMode::Cut);
        seg0.master_muted = true; // video muted, music still mixes cleanly against anullsrc
        let seg1 = sample_seg(r"C:\vid1.mp4", 0.0, 5.0, 1.0, EditorTransitionMode::Cut);

        let layers = vec![
            PreparedEditorAudioLayer {
                file_path: r"C:\music_bgm.mp3".to_string(),
                timeline_offset_sec: 1.5,
                trim_start_sec: 10.0,
                active_dur: 20.0, // clips to 8.5s at total_duration=10.0
                volume: 150.0,    // 1.500
                muted: false,
            },
            PreparedEditorAudioLayer {
                file_path: r"C:\music_muted.mp3".to_string(),
                timeline_offset_sec: 0.0,
                trim_start_sec: 0.0,
                active_dur: 5.0,
                volume: 100.0,
                muted: true,
            },
            PreparedEditorAudioLayer {
                file_path: r"C:\music_past_end.mp3".to_string(),
                timeline_offset_sec: 12.0,
                trim_start_sec: 0.0,
                active_dur: 4.0,
                volume: 100.0,
                muted: false,
            },
        ];

        let args = build_editor_export_args(
            &[seg0, seg1],
            &layers,
            Path::new(r"C:\out_music.mp4"),
            EditorVerticalMode::None,
            true,
            None,
            "libx264",
            true,
        );
        let fc = args
            .windows(2)
            .find(|w| w[0] == "-filter_complex")
            .map(|w| w[1].clone())
            .expect("filter_complex");

        // Only 1 audible audio layer should be added as input index 2
        assert!(args.contains(&r"C:\music_bgm.mp3".to_string()));
        assert!(!args.contains(&r"C:\music_muted.mp3".to_string()));
        assert!(!args.contains(&r"C:\music_past_end.mp3".to_string()));
        assert!(fc.contains("anullsrc=r=48000:cl=stereo:d=5.000[a0]"));
        assert!(fc.contains("[v0][a0][v1][a1]concat=n=2:v=1:a=1[vout][a_cat]"));
        assert!(fc.contains(
            "[2:a:0]atrim=0:8.500,asetpts=PTS-STARTPTS,volume=1.500,aformat=sample_rates=48000:channel_layouts=stereo,adelay=1500|1500[amusic0]"
        ));
        assert!(fc.contains(
            "[a_cat][amusic0]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[amixed]"
        ));
        assert!(fc.contains("[amixed]loudnorm=I=-16:TP=-1.5:LRA=11[aout]"));
    }

    #[test]
    fn builds_dynamic_crossfade_and_edge_fade_in_out_before_music_mix() {
        let seg0 = sample_seg(
            r"C:\seg0.mp4",
            0.0,
            4.0,
            1.0,
            EditorTransitionMode::Fade(0.60),
        );
        let mut seg1 = sample_seg(
            r"C:\seg1.mp4",
            0.0,
            5.0,
            1.0,
            EditorTransitionMode::Crossfade(1.50),
        );
        seg1.transition_out = EditorTransitionOutMode::Fade(0.85);

        let total_dur = compute_timeline_duration(&[seg0.clone(), seg1.clone()]);
        // 4.0 + 5.0 - 1.5 = 7.5s
        assert!((total_dur - 7.5).abs() < 0.001);

        let layers = vec![PreparedEditorAudioLayer {
            file_path: r"C:\song.mp3".to_string(),
            timeline_offset_sec: 0.0,
            trim_start_sec: 0.0,
            active_dur: 10.0,
            volume: 100.0,
            muted: false,
        }];

        let args = build_editor_export_args(
            &[seg0, seg1],
            &layers,
            Path::new(r"C:\out_dyn_trans.mp4"),
            EditorVerticalMode::None,
            false,
            None,
            "libx264",
            true,
        );
        let fc = args
            .windows(2)
            .find(|w| w[0] == "-filter_complex")
            .map(|w| w[1].clone())
            .expect("filter_complex");

        // Dynamic 1.50s crossfade at offset = 4.0 - 1.5 = 2.500
        assert!(fc.contains("[v0][v1]xfade=transition=fade:duration=1.500:offset=2.500[vm1]"));
        assert!(fc.contains("[a0][a1]acrossfade=d=1.500[am1]"));
        // Video Fade In 0.60s + Fade Out 0.85s at st = 7.500 - 0.850 = 6.650
        assert!(fc.contains("[vm1]fade=t=in:st=0:d=0.600,fade=t=out:st=6.650:d=0.850[vout]"));
        // Audio Fade In/Out applied on clip audio before amix with Track 2 music
        assert!(fc.contains(
            "[am1]afade=t=in:st=0:d=0.600,afade=t=out:st=6.650:d=0.850[avideo_faded]"
        ));
        assert!(fc.contains(
            "[avideo_faded][amusic0]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[aout]"
        ));
    }
}
