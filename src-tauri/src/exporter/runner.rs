use std::path::Path;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::sync::Notify;

use crate::error::{AppError, AppResult};
use crate::exporter::args::{discord_limit_bytes, scale_bitrate_plan_for_overshoot, BitratePlan};
use crate::media::tokio_command;
use crate::models::{ExportPreset, ExportProgressEvent};

const MAX_OVERSHOOT_RETRIES: usize = 2;

#[derive(Clone, Default)]
pub struct ActiveJobControl {
    pub(crate) cancelled: Arc<AtomicBool>,
    pub(crate) notify: Arc<Notify>,
}

#[derive(Debug)]
pub enum ExportRunError {
    Cancelled,
    Failed(String),
}

pub type ProgressCallback = Arc<dyn Fn(ExportProgressEvent) + Send + Sync>;

pub(crate) fn tauri_progress_callback(app: &AppHandle) -> ProgressCallback {
    let handle = app.clone();
    Arc::new(move |ev: ExportProgressEvent| {
        let _ = handle.emit("export:progress", ev);
    })
}

async fn read_output_size(out_path: &Path) -> i64 {
    tokio::fs::metadata(out_path)
        .await
        .map(|m| m.len() as i64)
        .unwrap_or(0)
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_hw_with_x264_fallback<F>(
    on_progress: Option<ProgressCallback>,
    job_id: &str,
    out_path: &Path,
    duration_sec: f64,
    _size_check_preset: Option<ExportPreset>,
    hw_encoders: &[&str],
    ctrl: &ActiveJobControl,
    build_args: F,
) -> Result<(i64, String), ExportRunError>
where
    F: Fn(&str) -> Vec<String>,
{
    for &encoder in hw_encoders {
        let hw_args = build_args(encoder);
        match run_ffmpeg_with_progress(on_progress.clone(), job_id, &hw_args, duration_sec, ctrl)
            .await
        {
            Ok(()) => {
                let size = read_output_size(out_path).await;
                return Ok((size, encoder.to_string()));
            }
            Err(ExportRunError::Cancelled) => return Err(ExportRunError::Cancelled),
            Err(ExportRunError::Failed(_)) => {
                let _ = tokio::fs::remove_file(out_path).await;
            }
        }
    }

    let x264_args = build_args("libx264");
    run_ffmpeg_with_progress(on_progress, job_id, &x264_args, duration_sec, ctrl).await?;
    let size = read_output_size(out_path).await;
    Ok((size, "libx264".to_string()))
}

#[allow(clippy::too_many_arguments)]
pub(crate) async fn run_discord_export_with_retry<F>(
    on_progress: Option<ProgressCallback>,
    job_id: &str,
    out_path: &Path,
    duration_sec: f64,
    src_height: i32,
    preset: ExportPreset,
    initial_plan: BitratePlan,
    hw_encoders: &[&str],
    ctrl: &ActiveJobControl,
    build_args: F,
) -> Result<(i64, String), ExportRunError>
where
    F: Fn(&BitratePlan, &str) -> Vec<String>,
{
    let mut current_plan = initial_plan;
    let limit_bytes = discord_limit_bytes(preset);

    for attempt in 0..=MAX_OVERSHOOT_RETRIES {
        let (actual_size, encoder_used) = run_hw_with_x264_fallback(
            on_progress.clone(),
            job_id,
            out_path,
            duration_sec,
            None,
            hw_encoders,
            ctrl,
            |encoder| build_args(&current_plan, encoder),
        )
        .await?;

        let Some(limit) = limit_bytes else {
            return Ok((actual_size, encoder_used));
        };
        if actual_size <= limit {
            return Ok((actual_size, encoder_used));
        }

        let _ = tokio::fs::remove_file(out_path).await;
        if attempt < MAX_OVERSHOOT_RETRIES {
            if let Some(next_plan) =
                scale_bitrate_plan_for_overshoot(&current_plan, limit, actual_size, src_height)
            {
                current_plan = next_plan;
                continue;
            }
        }

        return Err(ExportRunError::Failed(discord_overshoot_error_message(preset)));
    }

    Err(ExportRunError::Failed(discord_overshoot_error_message(preset)))
}

pub(crate) fn discord_overshoot_error_message(preset: ExportPreset) -> String {
    match preset {
        ExportPreset::Discord25mb => {
            "Exported clip exceeded 25 MB Discord limit even after bitrate scaling (too long or complex). Trim shorter.".to_string()
        }
        _ => {
            "Exported clip exceeded 10 MB Discord limit (too long or complex). Trim shorter or use the 25 MB preset.".to_string()
        }
    }
}

pub(crate) async fn run_ffmpeg_with_progress(
    on_progress: Option<ProgressCallback>,
    job_id: &str,
    args: &[String],
    duration_sec: f64,
    ctrl: &ActiveJobControl,
) -> Result<(), ExportRunError> {
    if ctrl.cancelled.load(Ordering::SeqCst) {
        return Err(ExportRunError::Cancelled);
    }

    let mut child = tokio_command("ffmpeg")
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| ExportRunError::Failed(format!("Failed to launch ffmpeg: {e}")))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| ExportRunError::Failed("Missing ffmpeg stdout".to_string()))?;
    let stderr = child.stderr.take();

    let stderr_task = tokio::spawn(async move {
        if let Some(mut err) = stderr {
            let mut buf = Vec::new();
            let _ = tokio::io::AsyncReadExt::read_to_end(&mut err, &mut buf).await;
            String::from_utf8_lossy(&buf).to_string()
        } else {
            String::new()
        }
    });

    let progress_clone = on_progress.clone();
    let job_clone = job_id.to_string();
    let started = Instant::now();
    let reader_task = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        let mut current_speed: Option<String> = None;
        while let Ok(Some(line)) = lines.next_line().await {
            if let Some(val) = line.strip_prefix("speed=") {
                let s = val.trim().to_string();
                if !s.is_empty() && s != "N/A" {
                    current_speed = Some(s);
                }
            } else if let Some(val) = line.strip_prefix("out_time_us=") {
                if let Ok(us) = val.trim().parse::<f64>() {
                    let out_sec = (us / 1_000_000.0).max(0.0);
                    let pct = ((out_sec / duration_sec.max(0.1)) * 100.0).clamp(0.0, 99.9);
                    let elapsed = started.elapsed().as_secs_f64();
                    let eta_sec = if pct > 1.0 {
                        Some(((elapsed * (100.0 - pct)) / pct).max(0.0))
                    } else {
                        None
                    };
                    if let Some(cb) = &progress_clone {
                        cb(ExportProgressEvent {
                            job_id: job_clone.clone(),
                            percent: pct,
                            eta_sec,
                            speed: current_speed.clone(),
                        });
                    }
                }
            }
        }
    });

    let status = tokio::select! {
        wait_res = child.wait() => {
            wait_res.map_err(|e| ExportRunError::Failed(format!("ffmpeg wait error: {e}")))?
        }
        _ = ctrl.notify.notified() => {
            let _ = child.kill().await;
            let _ = child.wait().await;
            reader_task.abort();
            stderr_task.abort();
            return Err(ExportRunError::Cancelled);
        }
    };

    let _ = reader_task.await;
    let err_text = stderr_task.await.unwrap_or_default();

    if ctrl.cancelled.load(Ordering::SeqCst) {
        return Err(ExportRunError::Cancelled);
    }

    if !status.success() {
        let tail: String = err_text
            .lines()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(ExportRunError::Failed(format!(
            "ffmpeg exited with status {status}: {tail}"
        )));
    }

    if let Some(cb) = on_progress {
        cb(ExportProgressEvent {
            job_id: job_id.to_string(),
            percent: 100.0,
            eta_sec: Some(0.0),
            speed: None,
        });
    }

    Ok(())
}

pub(crate) async fn run_ffmpeg_once(args: &[String]) -> AppResult<()> {
    let output = tokio_command("ffmpeg")
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .output()
        .await
        .map_err(|e| AppError::Process(format!("Failed to launch ffmpeg: {e}")))?;

    if !output.status.success() {
        let err_text = String::from_utf8_lossy(&output.stderr);
        let tail: String = err_text
            .lines()
            .rev()
            .take(4)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect::<Vec<_>>()
            .join(" | ");
        return Err(AppError::Process(format!(
            "ffmpeg exited with status {}: {tail}",
            output.status
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn formats_discord_overshoot_error_messages() {
        let msg10 = discord_overshoot_error_message(ExportPreset::Discord10mb);
        assert!(msg10.contains("10 MB"));
        assert!(msg10.contains("25 MB"));

        let msg25 = discord_overshoot_error_message(ExportPreset::Discord25mb);
        assert!(msg25.contains("25 MB"));
    }
}
