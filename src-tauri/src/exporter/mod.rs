pub mod args;
pub mod editor;
pub mod merge;
pub mod runner;
pub mod sanitize;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::UNIX_EPOCH;

use chrono::{SecondsFormat, Utc};
use tauri::{AppHandle, Emitter};
use tokio::sync::{Notify, Semaphore};
use uuid::Uuid;

use crate::db::{Db, ScannedClipInsert};
use crate::error::{AppError, AppResult};
use crate::media::{generate_thumbnail, probe_clip};
use crate::models::{
    AspectMode, AudioTrackMix, ClipDetail, ClipIdEvent, CollectionKind, ExportCompletedEvent,
    ExportFailedEvent, ExportPreset, MergeClipsRequest, SaveTrimmedClipRequest, SourceType,
    StartEditorExportRequest, StartExportRequest,
};
use crate::paths::{normalize_windows_path, AppPaths};
use crate::win::clipboard::copy_file_to_clipboard;

pub use args::{
    build_hq_trim_args, build_save_trim_args, build_vertical_args, calculate_discord_bitrate,
    compute_stretch_16_9_dims, is_unmodified_audio_mix, validate_export_plan, BitratePlan,
};
use args::{build_encoded_args, build_lossless_args};
pub use merge::{build_merge_clips_args, execute_merge_pipeline, MergeClipInput};
use merge::register_merged_clip_in_library;
pub use runner::{ActiveJobControl, ExportRunError, ProgressCallback};
use runner::{
    run_discord_export_with_retry, run_ffmpeg_once, run_ffmpeg_with_progress,
    run_hw_with_x264_fallback, tauri_progress_callback,
};
pub use sanitize::{
    ensure_contained_in_dir, resolve_unique_output_path, sanitize_filename_stem,
    validate_export_range, validate_save_trim_range,
};
use sanitize::{build_editor_output_path, build_merge_output_path, build_output_path};
pub use editor::{
    build_editor_export_args, compute_timeline_duration, execute_editor_export_pipeline,
    prepare_editor_timeline, EditorFraming, EditorPresetMode, EditorTransitionMode,
    EditorTransitionOutMode, EditorVerticalMode, PreparedEditorAudioLayer, PreparedEditorSegment,
};

#[derive(Clone)]
pub struct ExportManager {
    active: Arc<Mutex<HashMap<String, ActiveJobControl>>>,
}

impl Default for ExportManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ExportManager {
    pub fn new() -> Self {
        Self {
            active: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    pub fn cancel_job(&self, job_id: &str) -> bool {
        let guard = self.active.lock().expect("export active lock poisoned");
        if let Some(ctrl) = guard.get(job_id) {
            ctrl.cancelled.store(true, Ordering::SeqCst);
            ctrl.notify.notify_waiters();
            true
        } else {
            false
        }
    }

    pub fn start_export_job(
        &self,
        app: AppHandle,
        db: Db,
        request: StartExportRequest,
        export_output_dir: PathBuf,
        hw_encoders: Vec<&'static str>,
    ) -> AppResult<String> {
        let clip = db
            .get_clip_file_info(&request.clip_id)?
            .ok_or_else(|| AppError::NotFound(format!("Clip '{}' not found", request.clip_id)))?;
        if clip.is_missing {
            return Err(AppError::NotFound("Clip file is missing".to_string()));
        }

        let src_path = normalize_windows_path(Path::new(&clip.file_path));
        if !src_path.exists() {
            return Err(AppError::NotFound("Source video file not found".to_string()));
        }

        let detail = db.get_clip_detail(&request.clip_id, "", "")?;
        let (start_sec, end_sec, duration_sec) =
            validate_export_range(request.start_sec, request.end_sec, clip.duration_sec, 0.5)?;

        std::fs::create_dir_all(&export_output_dir)?;
        let job_id = Uuid::new_v4().to_string();
        let output_path = build_output_path(
            &export_output_dir,
            &detail.clip.file_name,
            request.preset,
            &job_id,
        )?;
        let output_str = output_path.to_string_lossy().to_string();

        db.insert_export_job(
            &job_id,
            &request.clip_id,
            request.preset.as_str(),
            start_sec,
            end_sec,
            &output_str,
        )?;

        let ctrl = ActiveJobControl {
            cancelled: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        };
        {
            let mut guard = self.active.lock().expect("export active lock poisoned");
            guard.insert(job_id.clone(), ctrl.clone());
        }

        let manager = self.clone();
        let job_id_spawn = job_id.clone();
        let track_count = detail.audio_tracks.len();

        tauri::async_runtime::spawn(async move {
            let progress_cb = tauri_progress_callback(&app);
            let result = execute_export_pipeline(
                Some(progress_cb),
                &job_id_spawn,
                &src_path,
                &output_path,
                start_sec,
                duration_sec,
                clip.height,
                track_count,
                &request,
                &hw_encoders,
                &ctrl,
            )
            .await;

            {
                let mut guard = manager.active.lock().expect("export active lock poisoned");
                guard.remove(&job_id_spawn);
            }

            match result {
                Ok((size_bytes, encoder_used)) => {
                    let copied = if request.copy_to_clipboard {
                        copy_file_to_clipboard(&output_path).is_ok()
                    } else {
                        false
                    };
                    let _ = db.update_export_job_done(&job_id_spawn, size_bytes, &encoder_used);
                    let _ = app.emit(
                        "export:completed",
                        ExportCompletedEvent {
                            job_id: job_id_spawn,
                            output_path: output_str,
                            output_size_bytes: size_bytes,
                            copied_to_clipboard: copied,
                            encoder_used,
                        },
                    );
                }
                Err(ExportRunError::Cancelled) => {
                    let _ = tokio::fs::remove_file(&output_path).await;
                    let _ = db.update_export_job_cancelled(&job_id_spawn);
                    let _ = app.emit(
                        "export:failed",
                        ExportFailedEvent {
                            job_id: job_id_spawn,
                            error: "Export cancelled".to_string(),
                        },
                    );
                }
                Err(ExportRunError::Failed(msg)) => {
                    let _ = tokio::fs::remove_file(&output_path).await;
                    let _ = db.update_export_job_failed(&job_id_spawn, &msg);
                    let _ = app.emit(
                        "export:failed",
                        ExportFailedEvent {
                            job_id: job_id_spawn,
                            error: msg,
                        },
                    );
                }
            }
        });

        Ok(job_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn start_merge_job(
        &self,
        app: AppHandle,
        db: Db,
        paths: AppPaths,
        thumb_sem: Arc<Semaphore>,
        request: MergeClipsRequest,
        export_output_dir: PathBuf,
        hw_encoders: Vec<&'static str>,
    ) -> AppResult<String> {
        if request.clip_ids.len() < 2 {
            return Err(AppError::InvalidInput(
                "At least 2 clips are required to merge".to_string(),
            ));
        }

        let mut merge_inputs = Vec::with_capacity(request.clip_ids.len());
        let mut details = Vec::with_capacity(request.clip_ids.len());
        let mut total_duration = 0.0f64;

        for cid in &request.clip_ids {
            let detail = db.get_clip_detail(cid, "", "")?;
            if detail.clip.is_missing {
                return Err(AppError::NotFound(format!("Clip '{cid}' is missing")));
            }
            let src_path = normalize_windows_path(Path::new(&detail.clip.file_path));
            if !src_path.exists() {
                return Err(AppError::NotFound(format!(
                    "Source video file not found for clip '{cid}'"
                )));
            }
            let dur = detail.clip.duration_sec.max(0.1);
            total_duration += dur;
            merge_inputs.push(MergeClipInput {
                file_path: src_path.to_string_lossy().to_string(),
                duration_sec: dur,
                has_audio: detail.clip.audio_track_count > 0 || !detail.audio_tracks.is_empty(),
            });
            details.push(detail);
        }

        let first_game_id = details[0].clip.game_id.clone();
        let inherited_game_id = if details.iter().all(|d| d.clip.game_id == first_game_id) {
            first_game_id
        } else {
            None
        };
        let inherited_source_type = if inherited_game_id.is_some() {
            details[0].clip.source_type
        } else {
            SourceType::Custom
        };

        std::fs::create_dir_all(&export_output_dir)?;
        let job_id = Uuid::new_v4().to_string();
        let output_path =
            build_merge_output_path(&export_output_dir, request.output_name.as_deref())?;
        let output_str = output_path.to_string_lossy().to_string();

        db.insert_export_job(
            &job_id,
            &details[0].clip.id,
            "merge_clips",
            0.0,
            total_duration,
            &output_str,
        )?;

        let ctrl = ActiveJobControl {
            cancelled: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        };
        {
            let mut guard = self.active.lock().expect("export active lock poisoned");
            guard.insert(job_id.clone(), ctrl.clone());
        }

        let manager = self.clone();
        let job_id_spawn = job_id.clone();

        tauri::async_runtime::spawn(async move {
            let progress_cb = tauri_progress_callback(&app);
            let result = execute_merge_pipeline(
                Some(progress_cb),
                &job_id_spawn,
                &merge_inputs,
                &output_path,
                total_duration,
                request.aspect_mode,
                request.normalize_audio,
                &hw_encoders,
                &ctrl,
            )
            .await;

            {
                let mut guard = manager.active.lock().expect("export active lock poisoned");
                guard.remove(&job_id_spawn);
            }

            match result {
                Ok((size_bytes, encoder_used)) => {
                    if request.add_to_library {
                        if let Ok(new_clip_id) = register_merged_clip_in_library(
                            &db,
                            &paths,
                            &thumb_sem,
                            &output_path,
                            inherited_game_id,
                            inherited_source_type,
                            request.output_name.as_deref(),
                        )
                        .await
                        {
                            let _ = app.emit(
                                "clip:added",
                                ClipIdEvent {
                                    clip_id: new_clip_id,
                                },
                            );
                        }
                    }

                    let copied = if request.copy_to_clipboard {
                        copy_file_to_clipboard(&output_path).is_ok()
                    } else {
                        false
                    };
                    let _ = db.update_export_job_done(&job_id_spawn, size_bytes, &encoder_used);
                    let _ = app.emit(
                        "export:completed",
                        ExportCompletedEvent {
                            job_id: job_id_spawn,
                            output_path: output_str,
                            output_size_bytes: size_bytes,
                            copied_to_clipboard: copied,
                            encoder_used,
                        },
                    );
                }
                Err(ExportRunError::Cancelled) => {
                    let _ = tokio::fs::remove_file(&output_path).await;
                    let _ = db.update_export_job_cancelled(&job_id_spawn);
                    let _ = app.emit(
                        "export:failed",
                        ExportFailedEvent {
                            job_id: job_id_spawn,
                            error: "Merge cancelled".to_string(),
                        },
                    );
                }
                Err(ExportRunError::Failed(msg)) => {
                    let _ = tokio::fs::remove_file(&output_path).await;
                    let _ = db.update_export_job_failed(&job_id_spawn, &msg);
                    let _ = app.emit(
                        "export:failed",
                        ExportFailedEvent {
                            job_id: job_id_spawn,
                            error: msg,
                        },
                    );
                }
            }
        });

        Ok(job_id)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn start_editor_export_job(
        &self,
        app: AppHandle,
        db: Db,
        paths: AppPaths,
        thumb_sem: Arc<Semaphore>,
        request: StartEditorExportRequest,
        export_output_dir: PathBuf,
        hw_encoders: Vec<&'static str>,
    ) -> AppResult<String> {
        let timeline = prepare_editor_timeline(&db, &request)?;
        std::fs::create_dir_all(&export_output_dir)?;
        let job_id = Uuid::new_v4().to_string();
        let output_path =
            build_editor_output_path(&export_output_dir, request.output_name.as_deref())?;
        let output_str = output_path.to_string_lossy().to_string();

        let preset_label = match timeline.preset_mode {
            EditorPresetMode::Original => "editor_original",
            EditorPresetMode::Discord(ExportPreset::Discord10mb) => "editor_discord_10mb",
            EditorPresetMode::Discord(ExportPreset::Discord25mb) => "editor_discord_25mb",
            EditorPresetMode::Discord(_) => "editor",
        };
        db.insert_export_job(
            &job_id,
            &timeline.segments[0].clip_id,
            preset_label,
            0.0,
            timeline.total_duration,
            &output_str,
        )?;

        let ctrl = ActiveJobControl {
            cancelled: Arc::new(AtomicBool::new(false)),
            notify: Arc::new(Notify::new()),
        };
        {
            let mut guard = self.active.lock().expect("export active lock poisoned");
            guard.insert(job_id.clone(), ctrl.clone());
        }

        let manager = self.clone();
        let job_id_spawn = job_id.clone();

        tauri::async_runtime::spawn(async move {
            let progress_cb = tauri_progress_callback(&app);
            let result = execute_editor_export_pipeline(
                Some(progress_cb),
                &job_id_spawn,
                &timeline.segments,
                &timeline.audio_layers,
                &output_path,
                timeline.total_duration,
                timeline.preset_mode,
                timeline.vertical_mode,
                request.normalize_audio,
                &hw_encoders,
                &ctrl,
            )
            .await;

            {
                let mut guard = manager.active.lock().expect("export active lock poisoned");
                guard.remove(&job_id_spawn);
            }

            match result {
                Ok((size_bytes, encoder_used)) => {
                    if request.add_to_library {
                        if let Ok(new_clip_id) = register_merged_clip_in_library(
                            &db,
                            &paths,
                            &thumb_sem,
                            &output_path,
                            timeline.inherited_game_id,
                            timeline.inherited_source_type,
                            request.output_name.as_deref(),
                        )
                        .await
                        {
                            let _ = app.emit(
                                "clip:added",
                                ClipIdEvent {
                                    clip_id: new_clip_id,
                                },
                            );
                        }
                    }

                    let copied = if request.copy_to_clipboard {
                        copy_file_to_clipboard(&output_path).is_ok()
                    } else {
                        false
                    };
                    let _ = db.update_export_job_done(&job_id_spawn, size_bytes, &encoder_used);
                    let _ = app.emit(
                        "export:completed",
                        ExportCompletedEvent {
                            job_id: job_id_spawn,
                            output_path: output_str,
                            output_size_bytes: size_bytes,
                            copied_to_clipboard: copied,
                            encoder_used,
                        },
                    );
                }
                Err(ExportRunError::Cancelled) => {
                    let _ = tokio::fs::remove_file(&output_path).await;
                    let _ = db.update_export_job_cancelled(&job_id_spawn);
                    let _ = app.emit(
                        "export:failed",
                        ExportFailedEvent {
                            job_id: job_id_spawn,
                            error: "Editor export cancelled".to_string(),
                        },
                    );
                }
                Err(ExportRunError::Failed(msg)) => {
                    let _ = tokio::fs::remove_file(&output_path).await;
                    let _ = db.update_export_job_failed(&job_id_spawn, &msg);
                    let _ = app.emit(
                        "export:failed",
                        ExportFailedEvent {
                            job_id: job_id_spawn,
                            error: msg,
                        },
                    );
                }
            }
        });

        Ok(job_id)
    }
}

#[allow(clippy::too_many_arguments)]
pub async fn execute_export_pipeline(
    on_progress: Option<ProgressCallback>,
    job_id: &str,
    src_path: &Path,
    out_path: &Path,
    start_sec: f64,
    duration_sec: f64,
    src_height: i32,
    track_count: usize,
    request: &StartExportRequest,
    hw_encoders: &[&str],
    ctrl: &ActiveJobControl,
) -> Result<(i64, String), ExportRunError> {
    let active_tracks: Vec<&AudioTrackMix> = request
        .audio_mix
        .iter()
        .filter(|m| !m.muted && m.volume > 0.001)
        .collect();
    let has_active_audio = if request.audio_mix.is_empty() {
        track_count > 0
    } else {
        !active_tracks.is_empty()
    };

    if request.preset == ExportPreset::LosslessTrim {
        if request.aspect_mode == AspectMode::Original {
            let unmodified =
                is_unmodified_audio_mix(&request.audio_mix, track_count) && !request.normalize_audio;
            let args = build_lossless_args(
                src_path,
                out_path,
                start_sec,
                duration_sec,
                unmodified,
                &request.audio_mix,
                track_count,
                request.normalize_audio,
            );
            run_ffmpeg_with_progress(on_progress, job_id, &args, duration_sec, ctrl).await?;
            let size = tokio::fs::metadata(out_path)
                .await
                .map(|m| m.len() as i64)
                .unwrap_or(0);
            let enc = if unmodified { "copy" } else { "copy+aac" };
            return Ok((size, enc.to_string()));
        }

        // AspectMode::Stretch169 alters pixel geometry, so stream copy is invalid and we re-encode HQ.
        return run_hw_with_x264_fallback(
            on_progress,
            job_id,
            out_path,
            duration_sec,
            None,
            hw_encoders,
            ctrl,
            |encoder| {
                build_hq_trim_args(
                    src_path,
                    out_path,
                    start_sec,
                    duration_sec,
                    src_height,
                    request.aspect_mode,
                    encoder,
                    18,
                    &request.audio_mix,
                    track_count,
                    request.normalize_audio,
                    true,
                )
            },
        )
        .await;
    }

    if matches!(
        request.preset,
        ExportPreset::VerticalBlur916 | ExportPreset::VerticalCrop916
    ) {
        return run_hw_with_x264_fallback(
            on_progress,
            job_id,
            out_path,
            duration_sec,
            None,
            hw_encoders,
            ctrl,
            |encoder| {
                build_vertical_args(
                    src_path,
                    out_path,
                    start_sec,
                    duration_sec,
                    request.preset,
                    request.aspect_mode,
                    encoder,
                    &request.audio_mix,
                    track_count,
                    request.normalize_audio,
                    true,
                )
            },
        )
        .await;
    }

    let plan = calculate_discord_bitrate(request.preset, duration_sec, src_height, has_active_audio)
        .expect("non-lossless preset returns bitrate plan");

    if let Err(msg) = validate_export_plan(request.preset, &plan) {
        // Yield briefly so invoke("start_export") resolves with jobId before export:failed emits.
        tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        return Err(ExportRunError::Failed(msg));
    }

    run_discord_export_with_retry(
        on_progress,
        job_id,
        out_path,
        duration_sec,
        src_height,
        request.preset,
        plan,
        hw_encoders,
        ctrl,
        |active_plan, encoder| {
            build_encoded_args(
                src_path,
                out_path,
                start_sec,
                duration_sec,
                src_height,
                request.aspect_mode,
                active_plan,
                encoder,
                &request.audio_mix,
                track_count,
                request.normalize_audio,
            )
        },
    )
    .await
}

pub async fn save_trimmed_clip_to_library(
    db: &Db,
    paths: &AppPaths,
    thumb_sem: &Semaphore,
    hw_encoders: &[&str],
    streamer_base_url: &str,
    streamer_token: &str,
    request: SaveTrimmedClipRequest,
) -> AppResult<ClipDetail> {
    let detail = db.get_clip_detail(&request.clip_id, streamer_base_url, streamer_token)?;
    if detail.clip.is_missing {
        return Err(AppError::NotFound("Source clip file is missing".to_string()));
    }

    let duration_sec =
        validate_save_trim_range(request.start_sec, request.end_sec, detail.clip.duration_sec)?;

    let src_path = normalize_windows_path(Path::new(&detail.clip.file_path));
    if !src_path.exists() {
        return Err(AppError::NotFound(
            "Source video file not found on disk".to_string(),
        ));
    }

    let sanitized_game = sanitize_filename_stem(&detail.clip.game_name, "Uncategorized");
    let raw_stem = Path::new(&detail.clip.file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("clip");
    let clean_stem = sanitize_filename_stem(raw_stem, "clip");
    let stamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let short_id: String = Uuid::new_v4()
        .to_string()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(6)
        .collect();

    let game_dir = paths.saved_clips_dir.join(&sanitized_game);
    ensure_contained_in_dir(&paths.saved_clips_dir, &game_dir)?;
    tokio::fs::create_dir_all(&game_dir).await?;
    let out_path =
        resolve_unique_output_path(&game_dir, &format!("{clean_stem}_clip_{stamp}_{short_id}"), "mp4")?;

    let track_count = detail.audio_tracks.len();
    let mut encoded_ok = false;

    for &encoder in hw_encoders {
        let hw_args = build_save_trim_args(
            &src_path,
            &out_path,
            request.start_sec,
            duration_sec,
            detail.clip.height,
            request.aspect_mode,
            encoder,
            &request.audio_mix,
            track_count,
            request.normalize_audio,
        );
        if run_ffmpeg_once(&hw_args).await.is_ok() {
            encoded_ok = true;
            break;
        }
        let _ = tokio::fs::remove_file(&out_path).await;
    }

    if !encoded_ok {
        let x264_args = build_save_trim_args(
            &src_path,
            &out_path,
            request.start_sec,
            duration_sec,
            detail.clip.height,
            request.aspect_mode,
            "libx264",
            &request.audio_mix,
            track_count,
            request.normalize_audio,
        );
        if let Err(err) = run_ffmpeg_once(&x264_args).await {
            let _ = tokio::fs::remove_file(&out_path).await;
            return Err(err);
        }
    }

    let meta = tokio::fs::metadata(&out_path).await?;
    let file_size_bytes = meta.len() as i64;
    let file_mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);

    let probe = probe_clip(&out_path).await?;
    let file_name = out_path
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("clip.mp4")
        .to_string();
    let recorded_at = Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true);

    let (new_clip_id, _) = db.upsert_scanned_clip(ScannedClipInsert {
        file_path: out_path.to_string_lossy().to_string(),
        file_name,
        file_size_bytes,
        file_mtime,
        source_type: detail.clip.source_type,
        game_id: detail.clip.game_id.clone(),
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
    if generate_thumbnail(&out_path, probe.duration_sec, &thumb_path, thumb_sem)
        .await
        .is_ok()
    {
        let _ = db.update_clip_thumb_path(&new_clip_id, &thumb_path.to_string_lossy());
    }

    if let Some(raw_title) = request.title {
        let trimmed = raw_title.trim();
        if !trimmed.is_empty() {
            db.update_clip_meta(
                &new_clip_id,
                Some(trimmed.to_string()),
                None,
                None,
                None,
                None,
                streamer_base_url,
                streamer_token,
            )?;
        }
    }

    if let Some(col_ids) = request.collection_ids {
        for cid in col_ids {
            if let Ok(col) = db.get_collection(&cid) {
                if col.kind == CollectionKind::Manual {
                    db.modify_collection_clips(&cid, Some(vec![new_clip_id.clone()]), None)?;
                }
            }
        }
    }

    db.get_clip_detail(&new_clip_id, streamer_base_url, streamer_token)
}
