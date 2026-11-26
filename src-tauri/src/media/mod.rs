use std::collections::HashMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use tokio::sync::Semaphore;

use crate::db::{Db, ScannedAudioTrackInput};
use crate::error::{AppError, AppResult};
use crate::exporter::compute_stretch_16_9_dims;
use crate::models::{
    AspectMode, ProbedAudioFile, SetThumbnailResult, SnapshotResult, WaveformResponse,
};
use crate::paths::{
    normalize_windows_path, resolve_unique_output_path, sanitize_filename_stem, AppPaths,
};
use crate::win::clipboard::copy_image_dib_to_clipboard;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
#[cfg(target_os = "windows")]
const BELOW_NORMAL_PRIORITY_CLASS: u32 = 0x0000_4000;
#[cfg(target_os = "windows")]
pub const BACKGROUND_PROCESS_FLAGS: u32 = BELOW_NORMAL_PRIORITY_CLASS | CREATE_NO_WINDOW;

#[derive(Debug, Clone)]
pub struct ProbeMetadata {
    pub duration_sec: f64,
    pub width: i32,
    pub height: i32,
    pub fps: f64,
    pub video_codec: String,
    pub creation_time: Option<String>,
    pub audio_tracks: Vec<ScannedAudioTrackInput>,
}

#[derive(Debug, Deserialize)]
struct FfprobeOutput {
    #[serde(default)]
    streams: Vec<FfprobeStream>,
    format: Option<FfprobeFormat>,
}

#[derive(Debug, Deserialize)]
struct FfprobeFormat {
    duration: Option<String>,
    #[serde(default)]
    tags: HashMap<String, String>,
}

#[derive(Debug, Deserialize)]
struct FfprobeStream {
    index: i32,
    codec_type: Option<String>,
    codec_name: Option<String>,
    width: Option<i32>,
    height: Option<i32>,
    r_frame_rate: Option<String>,
    avg_frame_rate: Option<String>,
    duration: Option<String>,
    channels: Option<i32>,
    sample_rate: Option<String>,
    bit_rate: Option<String>,
    #[serde(default)]
    tags: HashMap<String, String>,
}

pub fn resolve_media_binary(program: &str) -> OsString {
    let exe_path = std::env::current_exe().ok();
    let exe_dir = exe_path.as_deref().and_then(Path::parent);
    resolve_media_binary_from_exe(program, exe_dir)
}

fn resolve_media_binary_from_exe(program: &str, exe_dir: Option<&Path>) -> OsString {
    if program != "ffmpeg" && program != "ffprobe" {
        return OsString::from(program);
    }

    if let Some(dir) = exe_dir {
        let plain_name = format!("{program}.exe");
        let target_triple_name = format!("{program}-x86_64-pc-windows-msvc.exe");
        let mut candidates: Vec<PathBuf> = vec![
            dir.join(&plain_name),
            dir.join(&target_triple_name),
        ];
        if let Some(grandparent) = dir.parent().and_then(Path::parent) {
            candidates.push(grandparent.join("binaries").join(&target_triple_name));
        }

        for candidate in candidates {
            if candidate.is_file() {
                return candidate.into_os_string();
            }
        }
    }

    OsString::from(program)
}

pub fn std_command(program: &str) -> std::process::Command {
    let mut cmd = std::process::Command::new(resolve_media_binary(program));
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

pub fn tokio_command(program: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(resolve_media_binary(program));
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    cmd
}

/// Spawn background media tools at BELOW_NORMAL priority with no console window
/// so scanning, probing, thumbnails, and DASH remuxing do not stutter active games.
pub fn tokio_command_bg(program: &str) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(resolve_media_binary(program));
    #[cfg(target_os = "windows")]
    {
        cmd.creation_flags(BACKGROUND_PROCESS_FLAGS);
    }
    cmd
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct FfmpegCapabilities {
    pub available: bool,
    pub has_nvenc: bool,
    pub has_amf: bool,
    pub has_qsv: bool,
}

impl FfmpegCapabilities {
    pub fn hardware_encoders(&self) -> Vec<&'static str> {
        let mut encoders = Vec::new();
        if self.has_nvenc {
            encoders.push("h264_nvenc");
        }
        if self.has_amf {
            encoders.push("h264_amf");
        }
        if self.has_qsv {
            encoders.push("h264_qsv");
        }
        encoders
    }

    pub fn preferred_hardware_encoder(&self) -> Option<&'static str> {
        self.hardware_encoders().into_iter().next()
    }
}

fn probe_single_hw_encoder(encoder: &str) -> bool {
    std_command("ffmpeg")
        .args([
            "-hide_banner",
            "-v",
            "error",
            "-f",
            "lavfi",
            "-i",
            "color=c=black:s=256x256:d=0.04",
            "-frames:v",
            "1",
            "-c:v",
            encoder,
            "-f",
            "null",
            "-",
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

pub fn detect_ffmpeg_capabilities() -> FfmpegCapabilities {
    let Ok(output) = std_command("ffmpeg")
        .args(["-hide_banner", "-encoders"])
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
    else {
        return FfmpegCapabilities::default();
    };

    if !output.status.success() {
        return FfmpegCapabilities::default();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let has_nvenc = stdout.contains("h264_nvenc") && probe_single_hw_encoder("h264_nvenc");
    let has_amf = stdout.contains("h264_amf") && probe_single_hw_encoder("h264_amf");
    let has_qsv = stdout.contains("h264_qsv") && probe_single_hw_encoder("h264_qsv");

    FfmpegCapabilities {
        available: true,
        has_nvenc,
        has_amf,
        has_qsv,
    }
}

pub async fn probe_clip(path: &Path) -> AppResult<ProbeMetadata> {
    let path_str = path.to_string_lossy().to_string();
    let output = tokio_command_bg("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            &path_str,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Process(format!("Failed to launch ffprobe: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Process(format!(
            "ffprobe failed for {path_str}: {stderr}"
        )));
    }

    let parsed: FfprobeOutput = serde_json::from_slice(&output.stdout)?;
    let mut duration_sec = parsed
        .format
        .as_ref()
        .and_then(|f| f.duration.as_deref())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);

    let creation_time = parsed
        .format
        .as_ref()
        .and_then(|f| find_tag_ci(&f.tags, "creation_time"));

    let mut width = 0;
    let mut height = 0;
    let mut fps = 60.0;
    let mut video_codec = "h264".to_string();
    let mut found_video = false;
    let mut audio_tracks = Vec::new();

    for stream in &parsed.streams {
        match stream.codec_type.as_deref() {
            Some("video") if !found_video => {
                found_video = true;
                width = stream.width.unwrap_or(1920);
                height = stream.height.unwrap_or(1080);
                video_codec = stream
                    .codec_name
                    .clone()
                    .unwrap_or_else(|| "h264".to_string());
                fps = stream
                    .avg_frame_rate
                    .as_deref()
                    .and_then(parse_fraction)
                    .or_else(|| stream.r_frame_rate.as_deref().and_then(parse_fraction))
                    .unwrap_or(60.0);
                if duration_sec <= 0.0 {
                    if let Some(d) = stream.duration.as_deref().and_then(|s| s.parse::<f64>().ok()) {
                        duration_sec = d;
                    }
                }
            }
            Some("audio") => {
                let track_order = audio_tracks.len() as i32;
                let label = find_tag_ci(&stream.tags, "name")
                    .or_else(|| find_tag_ci(&stream.tags, "title"))
                    .unwrap_or_else(|| format!("Audio Track {}", track_order + 1));
                let codec = stream
                    .codec_name
                    .clone()
                    .unwrap_or_else(|| "aac".to_string());
                let channels = stream.channels.unwrap_or(2);
                let sample_rate = stream
                    .sample_rate
                    .as_deref()
                    .and_then(|s| s.parse::<i32>().ok())
                    .unwrap_or(48_000);
                let bitrate = stream
                    .bit_rate
                    .as_deref()
                    .and_then(|s| s.parse::<i64>().ok());

                audio_tracks.push(ScannedAudioTrackInput {
                    stream_index: stream.index,
                    track_order,
                    label,
                    codec,
                    channels,
                    sample_rate,
                    bitrate,
                });
            }
            _ => {}
        }
    }

    if !found_video {
        return Err(AppError::Process(format!(
            "No video stream found in {path_str}"
        )));
    }

    Ok(ProbeMetadata {
        duration_sec: duration_sec.max(0.0),
        width,
        height,
        fps,
        video_codec,
        creation_time,
        audio_tracks,
    })
}

pub const SUPPORTED_AUDIO_EXTENSIONS: &[&str] = &["mp3", "wav", "aac", "m4a", "flac"];

pub fn audio_mime_for_path(path: &Path) -> Option<&'static str> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())?;
    match ext.as_str() {
        "mp3" => Some("audio/mpeg"),
        "wav" => Some("audio/wav"),
        "aac" => Some("audio/aac"),
        "m4a" => Some("audio/mp4"),
        "flac" => Some("audio/flac"),
        _ => None,
    }
}

pub async fn probe_audio_file(path: &Path) -> AppResult<ProbedAudioFile> {
    let normalized = normalize_windows_path(path);
    if !normalized.exists() || !normalized.is_file() {
        return Err(AppError::NotFound(format!(
            "Audio file not found: {}",
            normalized.to_string_lossy()
        )));
    }
    if audio_mime_for_path(&normalized).is_none() {
        return Err(AppError::InvalidInput(
            "Unsupported audio format (allowed: mp3, wav, aac, m4a, flac)".to_string(),
        ));
    }

    let path_str = normalized.to_string_lossy().to_string();
    let output = tokio_command_bg("ffprobe")
        .args([
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            "-select_streams",
            "a:0",
            &path_str,
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Process(format!("Failed to launch ffprobe: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Process(format!(
            "ffprobe failed for {path_str}: {stderr}"
        )));
    }

    let parsed: FfprobeOutput = serde_json::from_slice(&output.stdout)?;
    let audio_stream = parsed
        .streams
        .iter()
        .find(|s| s.codec_type.as_deref() == Some("audio"))
        .ok_or_else(|| {
            AppError::InvalidInput(format!("No audio stream found in {path_str}"))
        })?;

    let mut duration_sec = parsed
        .format
        .as_ref()
        .and_then(|f| f.duration.as_deref())
        .and_then(|s| s.parse::<f64>().ok())
        .unwrap_or(0.0);
    if duration_sec <= 0.0 {
        if let Some(d) = audio_stream
            .duration
            .as_deref()
            .and_then(|s| s.parse::<f64>().ok())
        {
            duration_sec = d;
        }
    }
    if !duration_sec.is_finite() || duration_sec <= 0.25 {
        return Err(AppError::InvalidInput(
            "Audio file duration must be greater than 0.25 seconds".to_string(),
        ));
    }

    let tag_title = parsed
        .format
        .as_ref()
        .and_then(|f| find_tag_ci(&f.tags, "title"))
        .or_else(|| find_tag_ci(&audio_stream.tags, "title"))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    let title = tag_title.unwrap_or_else(|| {
        normalized
            .file_stem()
            .and_then(|s| s.to_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("Audio Track")
            .to_string()
    });

    let codec = audio_stream
        .codec_name
        .clone()
        .unwrap_or_else(|| "aac".to_string());
    let sample_rate = audio_stream
        .sample_rate
        .as_deref()
        .and_then(|s| s.parse::<i32>().ok())
        .unwrap_or(48_000);
    let channels = audio_stream.channels.unwrap_or(2);

    Ok(ProbedAudioFile {
        file_path: path_str,
        title,
        duration_sec,
        codec,
        sample_rate,
        channels,
    })
}

pub async fn generate_thumbnail(
    video_path: &Path,
    duration_sec: f64,
    out_path: &Path,
    semaphore: &Semaphore,
) -> AppResult<()> {
    if out_path.exists() {
        return Ok(());
    }
    let _permit = semaphore
        .acquire()
        .await
        .map_err(|_| AppError::Internal("Thumbnail semaphore closed".to_string()))?;

    if out_path.exists() {
        return Ok(());
    }

    let seek_sec = if duration_sec > 1.0 {
        (duration_sec * 0.20).min(duration_sec - 0.1)
    } else {
        0.0
    };
    render_thumbnail_frame(video_path, seek_sec, 4, out_path).await
}

pub async fn overwrite_thumbnail_at(
    video_path: &Path,
    time_sec: f64,
    duration_sec: f64,
    out_path: &Path,
    semaphore: &Semaphore,
) -> AppResult<()> {
    let _permit = semaphore
        .acquire()
        .await
        .map_err(|_| AppError::Internal("Thumbnail semaphore closed".to_string()))?;
    let clamped = if duration_sec > 0.0 {
        time_sec.clamp(0.0, duration_sec)
    } else {
        time_sec.max(0.0)
    };
    render_thumbnail_frame(video_path, clamped, 3, out_path).await
}

async fn render_thumbnail_frame(
    video_path: &Path,
    seek_sec: f64,
    quality: u8,
    out_path: &Path,
) -> AppResult<()> {
    if let Some(parent) = out_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let tmp_path = out_path.with_extension("tmp.jpg");
    let seek_str = format!("{seek_sec:.3}");
    let quality_str = quality.to_string();
    let video_str = video_path.to_string_lossy().to_string();
    let tmp_str = tmp_path.to_string_lossy().to_string();

    let output = tokio_command_bg("ffmpeg")
        .args([
            "-y",
            "-v",
            "error",
            "-ss",
            &seek_str,
            "-i",
            &video_str,
            "-frames:v",
            "1",
            "-vf",
            "scale=480:-2",
            "-q:v",
            &quality_str,
            "-f",
            "image2",
            &tmp_str,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Process(format!("Failed to launch ffmpeg for thumb: {e}")))?;

    if !output.status.success() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Process(format!(
            "ffmpeg thumbnail failed: {stderr}"
        )));
    }

    tokio::fs::rename(&tmp_path, out_path).await?;
    Ok(())
}

pub async fn set_clip_thumbnail_core(
    db: &Db,
    paths: &AppPaths,
    thumb_sem: &Semaphore,
    streamer_base_url: &str,
    streamer_token: &str,
    clip_id: &str,
    time_sec: f64,
) -> AppResult<SetThumbnailResult> {
    if !time_sec.is_finite() {
        return Err(AppError::InvalidInput(
            "Thumbnail timestamp must be finite".to_string(),
        ));
    }
    let clip = db
        .get_clip_file_info(clip_id)?
        .ok_or_else(|| AppError::NotFound(format!("Clip '{clip_id}' not found")))?;
    if clip.is_missing {
        return Err(AppError::NotFound("Clip file is missing".to_string()));
    }
    let src_path = normalize_windows_path(Path::new(&clip.file_path));
    if !src_path.exists() {
        return Err(AppError::NotFound(
            "Source video file not found on disk".to_string(),
        ));
    }

    let thumb_path = paths.thumb_path(clip_id);
    overwrite_thumbnail_at(&src_path, time_sec, clip.duration_sec, &thumb_path, thumb_sem).await?;
    db.update_clip_thumb_path(clip_id, &thumb_path.to_string_lossy())?;

    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let thumb_url = format!("{streamer_base_url}/thumb/{clip_id}?token={streamer_token}&v={ms}");

    Ok(SetThumbnailResult {
        clip_id: clip_id.to_string(),
        thumb_url,
    })
}

pub async fn capture_frame_snapshot_core(
    db: &Db,
    export_output_dir: &Path,
    clip_id: &str,
    time_sec: f64,
    aspect_mode: Option<AspectMode>,
    copy_to_clipboard: bool,
) -> AppResult<SnapshotResult> {
    if !time_sec.is_finite() {
        return Err(AppError::InvalidInput(
            "Snapshot timestamp must be finite".to_string(),
        ));
    }
    let detail = db.get_clip_detail(clip_id, "", "")?;
    if detail.clip.is_missing {
        return Err(AppError::NotFound("Clip file is missing".to_string()));
    }
    let src_path = normalize_windows_path(Path::new(&detail.clip.file_path));
    if !src_path.exists() {
        return Err(AppError::NotFound(
            "Source video file not found on disk".to_string(),
        ));
    }

    tokio::fs::create_dir_all(export_output_dir).await?;
    let raw_stem = Path::new(&detail.clip.file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("clip");
    let clean_stem = sanitize_filename_stem(raw_stem, "clip");
    let ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let out_path = resolve_unique_output_path(export_output_dir, &format!("{clean_stem}_frame_{ms}"), "png")?;
    let file_name = out_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("snapshot.png")
        .to_string();

    let clamped = if detail.clip.duration_sec > 0.0 {
        time_sec.clamp(0.0, detail.clip.duration_sec)
    } else {
        time_sec.max(0.0)
    };
    let seek_str = format!("{clamped:.3}");
    let src_str = src_path.to_string_lossy().to_string();
    let out_str = out_path.to_string_lossy().to_string();

    let mut args = vec![
        "-y".to_string(),
        "-v".to_string(),
        "error".to_string(),
        "-ss".to_string(),
        seek_str,
        "-i".to_string(),
        src_str,
    ];
    if aspect_mode == Some(AspectMode::Stretch169) {
        let (w, h) = compute_stretch_16_9_dims(detail.clip.height, false);
        args.extend(["-vf".to_string(), format!("scale={w}:{h},setsar=1")]);
    }
    args.extend([
        "-frames:v".to_string(),
        "1".to_string(),
        "-f".to_string(),
        "image2".to_string(),
        out_str.clone(),
    ]);

    let png_out = tokio_command("ffmpeg")
        .args(&args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Process(format!("Failed to launch ffmpeg for snapshot: {e}")))?;

    if !png_out.status.success() {
        let _ = tokio::fs::remove_file(&out_path).await;
        let stderr = String::from_utf8_lossy(&png_out.stderr);
        return Err(AppError::Process(format!(
            "ffmpeg snapshot failed: {stderr}"
        )));
    }

    let copied = if copy_to_clipboard {
        let bmp_out = tokio_command("ffmpeg")
            .args([
                "-v",
                "error",
                "-i",
                &out_str,
                "-frames:v",
                "1",
                "-f",
                "image2pipe",
                "-vcodec",
                "bmp",
                "pipe:1",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .output()
            .await;

        match bmp_out {
            Ok(out) if out.status.success() => copy_image_dib_to_clipboard(&out.stdout).is_ok(),
            _ => false,
        }
    } else {
        false
    };

    Ok(SnapshotResult {
        output_path: out_str,
        file_name,
        copied_to_clipboard: copied,
    })
}

pub async fn extract_audio_track(
    video_path: &Path,
    stream_index: i32,
    out_path: &Path,
) -> AppResult<()> {
    if out_path.exists() {
        return Ok(());
    }
    if let Some(parent) = out_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let tmp_path = out_path.with_extension("tmp.m4a");
    let video_str = video_path.to_string_lossy().to_string();
    let map_arg = format!("0:{stream_index}");
    let tmp_str = tmp_path.to_string_lossy().to_string();

    let output = tokio_command_bg("ffmpeg")
        .args([
            "-y",
            "-v",
            "error",
            "-i",
            &video_str,
            "-map",
            &map_arg,
            "-vn",
            "-c:a",
            "aac",
            "-b:a",
            "192k",
            "-movflags",
            "+faststart",
            "-f",
            "mp4",
            &tmp_str,
        ])
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Process(format!("Failed to launch ffmpeg for audio: {e}")))?;

    if !output.status.success() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Process(format!(
            "ffmpeg audio extract failed: {stderr}"
        )));
    }

    tokio::fs::rename(&tmp_path, out_path).await?;
    Ok(())
}

pub async fn extract_waveform(
    video_path: &Path,
    stream_index: i32,
    cache_path: &Path,
    bins: usize,
) -> AppResult<Vec<f32>> {
    if cache_path.exists() {
        if let Ok(bytes) = tokio::fs::read(cache_path).await {
            if let Ok(cached) = serde_json::from_slice::<WaveformResponse>(&bytes) {
                return Ok(cached.peaks);
            }
        }
    }

    if let Some(parent) = cache_path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let video_str = video_path.to_string_lossy().to_string();
    let map_arg = format!("0:{stream_index}");
    let output = tokio_command_bg("ffmpeg")
        .args([
            "-v",
            "error",
            "-i",
            &video_str,
            "-map",
            &map_arg,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "8000",
            "-f",
            "s16le",
            "pipe:1",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Process(format!("Failed to launch ffmpeg for waveform: {e}")))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Process(format!(
            "ffmpeg waveform failed: {stderr}"
        )));
    }

    let peaks = compute_peaks_from_s16le(&output.stdout, bins);
    let payload = serde_json::to_vec(&WaveformResponse {
        peaks: peaks.clone(),
    })?;
    let _ = tokio::fs::write(cache_path, payload).await;
    Ok(peaks)
}

pub fn compute_peaks_from_s16le(pcm_bytes: &[u8], bins: usize) -> Vec<f32> {
    let target_bins = bins.max(1);
    let total_samples = pcm_bytes.len() / 2;
    if total_samples == 0 {
        return vec![0.0; target_bins];
    }

    let mut peaks = vec![0.0f32; target_bins];
    for (idx, chunk) in pcm_bytes.chunks_exact(2).enumerate() {
        let sample = i16::from_le_bytes([chunk[0], chunk[1]]);
        let amp = (sample as i32).unsigned_abs() as f32 / 32768.0;
        let bucket = (idx * target_bins) / total_samples;
        let clamped_bucket = bucket.min(target_bins - 1);
        if amp > peaks[clamped_bucket] {
            peaks[clamped_bucket] = amp.min(1.0);
        }
    }
    peaks
}

fn find_tag_ci(tags: &HashMap<String, String>, key: &str) -> Option<String> {
    tags.iter()
        .find(|(k, _)| k.eq_ignore_ascii_case(key))
        .map(|(_, v)| v.trim().to_string())
        .filter(|v| !v.is_empty())
}

pub fn parse_fraction(raw: &str) -> Option<f64> {
    let trimmed = raw.trim();
    if let Some((num_s, den_s)) = trimmed.split_once('/') {
        let num = num_s.parse::<f64>().ok()?;
        let den = den_s.parse::<f64>().ok()?;
        if den > 0.0 && num > 0.0 {
            return Some(num / den);
        }
        return None;
    }
    trimmed.parse::<f64>().ok().filter(|&v| v > 0.0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn make_temp_dir(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let dir = std::env::temp_dir().join(format!("glint_media_test_{label}_{nanos}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn resolves_non_media_program_without_lookup() {
        let root = make_temp_dir("non_media");
        let resolved = resolve_media_binary_from_exe("explorer.exe", Some(&root));
        assert_eq!(resolved, OsString::from("explorer.exe"));
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn resolves_plain_then_triple_then_binaries_then_fallback() {
        let root = make_temp_dir("priority");
        let exe_dir = root.join("target").join("debug");
        let binaries_dir = root.join("binaries");
        fs::create_dir_all(&exe_dir).expect("create exe_dir");
        fs::create_dir_all(&binaries_dir).expect("create binaries_dir");

        // Fallback to PATH name when no sidecar file exists.
        assert_eq!(
            resolve_media_binary_from_exe("ffmpeg", Some(&exe_dir)),
            OsString::from("ffmpeg")
        );

        // 3rd priority: <exe_dir>/../../binaries/ffmpeg-x86_64-pc-windows-msvc.exe
        let dev_bin = binaries_dir.join("ffmpeg-x86_64-pc-windows-msvc.exe");
        fs::write(&dev_bin, b"stub").expect("write dev_bin");
        assert_eq!(
            resolve_media_binary_from_exe("ffmpeg", Some(&exe_dir)),
            dev_bin.as_os_str()
        );

        // 2nd priority: <exe_dir>/ffmpeg-x86_64-pc-windows-msvc.exe
        let triple_bin = exe_dir.join("ffmpeg-x86_64-pc-windows-msvc.exe");
        fs::write(&triple_bin, b"stub").expect("write triple_bin");
        assert_eq!(
            resolve_media_binary_from_exe("ffmpeg", Some(&exe_dir)),
            triple_bin.as_os_str()
        );

        // 1st priority: <exe_dir>/ffmpeg.exe
        let plain_bin = exe_dir.join("ffmpeg.exe");
        fs::write(&plain_bin, b"stub").expect("write plain_bin");
        assert_eq!(
            resolve_media_binary_from_exe("ffmpeg", Some(&exe_dir)),
            plain_bin.as_os_str()
        );

        // Verify ffprobe also resolves via binaries_dir.
        let probe_bin = binaries_dir.join("ffprobe-x86_64-pc-windows-msvc.exe");
        fs::write(&probe_bin, b"stub").expect("write probe_bin");
        assert_eq!(
            resolve_media_binary_from_exe("ffprobe", Some(&exe_dir)),
            probe_bin.as_os_str()
        );

        let _ = fs::remove_dir_all(&root);
    }
}
