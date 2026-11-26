use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use tauri::{AppHandle, Emitter, State};
use tokio::sync::Semaphore;

use crate::db::Db;
use crate::discovery::{count_pending_files, run_scan_task, ClipWatcher};
use crate::error::{AppError, AppResult};
use crate::exporter::ExportManager;
use crate::media::FfmpegCapabilities;
use crate::models::{
    AppSettings, AspectMode, BootstrapState, ClipDetail, ClipIdEvent, CollectionKind,
    CollectionSummary, DeleteClipsResult, DetectNvidiaResult, DetectedRecorder,
    EditorProjectSummary, GameSummary, HardlinkExportResult, ListClipsQuery, ListClipsResult,
    LoadEditorProjectResult, MergeClipsRequest, ModifyCollectionClipsResult, OkResult,
    ProbedAudioFile, QueuedCountResult, SaveEditorProjectRequest, SaveTrimmedClipRequest,
    SetThumbnailResult, SmartRules, SnapshotResult, SourceType, StartEditorExportRequest,
    StartExportRequest, StartExportResult, StorageCleanupPreview, StorageCleanupResult, TagItem,
    WatchFolder,
};
use crate::paths::{normalize_windows_path, AppPaths};
use crate::win;

pub struct AppState {
    pub db: Db,
    pub paths: AppPaths,
    pub streamer_base_url: String,
    pub streamer_token: String,
    pub capabilities: FfmpegCapabilities,
    pub thumb_sem: Arc<Semaphore>,
    pub watcher: Arc<ClipWatcher>,
    pub exporter: ExportManager,
    pub quitting: Arc<AtomicBool>,
}

#[tauri::command]
pub fn get_bootstrap_state(state: State<'_, AppState>) -> AppResult<BootstrapState> {
    let watch_folders = state.db.list_watch_folders()?;
    let stats = state.db.get_library_stats()?;
    let settings = state.db.get_settings(&state.paths.default_settings())?;
    Ok(BootstrapState {
        streamer_base_url: state.streamer_base_url.clone(),
        streamer_token: state.streamer_token.clone(),
        watch_folders,
        has_nvenc: state.capabilities.has_nvenc,
        has_amf: state.capabilities.has_amf,
        has_qsv: state.capabilities.has_qsv,
        hardware_encoder: state
            .capabilities
            .preferred_hardware_encoder()
            .map(str::to_string),
        ffmpeg_available: state.capabilities.available,
        stats,
        settings,
    })
}

#[tauri::command]
pub fn detect_nvidia_folder() -> DetectNvidiaResult {
    win::registry::detect_nvidia_folder()
}

#[tauri::command]
pub fn detect_obs_folder() -> DetectNvidiaResult {
    win::registry::detect_obs_folder()
}

#[tauri::command]
pub fn detect_all_recorders() -> Vec<DetectedRecorder> {
    win::recorders::detect_all_recorders()
}

#[tauri::command]
pub fn add_watch_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
    source_type: SourceType,
) -> AppResult<WatchFolder> {
    let norm = normalize_windows_path(Path::new(path.trim()));
    if !norm.exists() || !norm.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "Folder does not exist: {}",
            norm.display()
        )));
    }
    let folder = state
        .db
        .add_watch_folder(&norm.to_string_lossy(), source_type)?;
    let folders = state.db.list_watch_folders()?;
    let _ = state.watcher.reload(app, folders);
    Ok(folder)
}

#[tauri::command]
pub fn remove_watch_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_id: String,
) -> AppResult<OkResult> {
    let ok = state.db.remove_watch_folder(&folder_id)?;
    let folders = state.db.list_watch_folders()?;
    let _ = state.watcher.reload(app, folders);
    Ok(OkResult { ok })
}

#[tauri::command]
pub fn toggle_watch_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_id: String,
    enabled: bool,
) -> AppResult<WatchFolder> {
    let folder = state.db.toggle_watch_folder(&folder_id, enabled)?;
    let folders = state.db.list_watch_folders()?;
    let _ = state.watcher.reload(app, folders);
    Ok(folder)
}

#[tauri::command]
pub fn scan_watch_folders(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_id: Option<String>,
) -> AppResult<QueuedCountResult> {
    let all_folders = state.db.list_watch_folders()?;
    let target_folders: Vec<WatchFolder> = match folder_id {
        Some(id) if !id.trim().is_empty() => {
            all_folders.into_iter().filter(|f| f.id == id).collect()
        }
        _ => all_folders.into_iter().filter(|f| f.enabled).collect(),
    };

    let queued_count = count_pending_files(&target_folders);
    let db = state.db.clone();
    let paths = state.paths.clone();
    let thumb_sem = state.thumb_sem.clone();

    tauri::async_runtime::spawn(async move {
        run_scan_task(app, db, paths, thumb_sem, target_folders).await;
    });

    Ok(QueuedCountResult { queued_count })
}

#[tauri::command]
pub fn list_games(state: State<'_, AppState>) -> AppResult<Vec<GameSummary>> {
    state.db.list_games()
}

#[tauri::command]
pub fn list_tags(state: State<'_, AppState>) -> AppResult<Vec<TagItem>> {
    state.db.list_tags()
}

#[tauri::command]
pub fn list_clips(
    state: State<'_, AppState>,
    query: ListClipsQuery,
) -> AppResult<ListClipsResult> {
    state
        .db
        .list_clips(&query, &state.streamer_base_url, &state.streamer_token)
}

#[tauri::command]
pub fn get_clip_detail(state: State<'_, AppState>, clip_id: String) -> AppResult<ClipDetail> {
    state
        .db
        .get_clip_detail(&clip_id, &state.streamer_base_url, &state.streamer_token)
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub fn update_clip_meta(
    state: State<'_, AppState>,
    clip_id: String,
    title: Option<String>,
    notes: Option<String>,
    is_favorite: Option<bool>,
    is_pinned: Option<bool>,
    tag_names: Option<Vec<String>>,
) -> AppResult<ClipDetail> {
    state.db.update_clip_meta(
        &clip_id,
        title,
        notes,
        is_favorite,
        is_pinned,
        tag_names,
        &state.streamer_base_url,
        &state.streamer_token,
    )
}

#[tauri::command]
pub fn delete_clips(
    app: AppHandle,
    state: State<'_, AppState>,
    clip_ids: Vec<String>,
) -> AppResult<DeleteClipsResult> {
    let targets = state.db.get_clips_by_ids(&clip_ids)?;
    let mut trashed_ids = Vec::new();
    let mut freed_bytes = 0i64;

    for target in targets {
        win::move_file_to_recycle_bin(Path::new(&target.file_path))?;
        freed_bytes += target.file_size_bytes;
        trashed_ids.push(target.id);
    }

    let removed_count = state.db.delete_clips_by_ids(&trashed_ids)? as i64;
    for clip_id in trashed_ids {
        let _ = app.emit("clip:removed", ClipIdEvent { clip_id });
    }

    Ok(DeleteClipsResult {
        removed_count,
        freed_bytes,
    })
}

#[tauri::command]
pub fn list_collections(state: State<'_, AppState>) -> AppResult<Vec<CollectionSummary>> {
    state.db.list_collections()
}

#[tauri::command]
pub fn create_collection(
    state: State<'_, AppState>,
    name: String,
    kind: CollectionKind,
    icon: Option<String>,
    color: Option<String>,
    smart_rules: Option<SmartRules>,
) -> AppResult<CollectionSummary> {
    state
        .db
        .create_collection(&name, kind, icon, color, smart_rules)
}

#[tauri::command]
pub fn update_collection(
    state: State<'_, AppState>,
    id: String,
    name: Option<String>,
    icon: Option<String>,
    color: Option<String>,
    smart_rules: Option<SmartRules>,
) -> AppResult<CollectionSummary> {
    state
        .db
        .update_collection(&id, name, icon, color, smart_rules)
}

#[tauri::command]
pub fn delete_collection(state: State<'_, AppState>, id: String) -> AppResult<OkResult> {
    let ok = state.db.delete_collection(&id)?;
    Ok(OkResult { ok })
}

#[tauri::command]
pub fn modify_collection_clips(
    state: State<'_, AppState>,
    collection_id: String,
    add_clip_ids: Option<Vec<String>>,
    remove_clip_ids: Option<Vec<String>>,
) -> AppResult<ModifyCollectionClipsResult> {
    let count = state
        .db
        .modify_collection_clips(&collection_id, add_clip_ids, remove_clip_ids)?;
    Ok(ModifyCollectionClipsResult { count })
}

#[tauri::command]
pub fn export_collection_hardlinks(
    state: State<'_, AppState>,
    collection_id: String,
    target_dir: Option<String>,
) -> AppResult<HardlinkExportResult> {
    let settings = state.db.get_settings(&state.paths.default_settings())?;
    let base_dir = normalize_windows_path(Path::new(&settings.hardlink_base_dir));
    let (collection_name, clips) = state.db.list_collection_clip_files(&collection_id)?;
    let result = win::hardlink::export_collection_hardlinks(
        &collection_name,
        &clips,
        target_dir.as_deref(),
        &base_dir,
    )?;
    let _ = win::open_in_explorer(Path::new(&result.folder_path));
    Ok(result)
}

fn resolve_export_output_dir(raw: &str, default_dir: &Path) -> std::path::PathBuf {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        normalize_windows_path(default_dir)
    } else {
        normalize_windows_path(Path::new(trimmed))
    }
}

#[tauri::command]
pub fn start_export(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartExportRequest,
) -> AppResult<StartExportResult> {
    if !state.capabilities.available {
        return Err(AppError::Process(
            "ffmpeg is not installed or unavailable on PATH".to_string(),
        ));
    }
    let settings = state.db.get_settings(&state.paths.default_settings())?;
    let export_dir =
        resolve_export_output_dir(&settings.export_output_dir, &state.paths.default_export_dir);
    let hw_encoders = state.capabilities.hardware_encoders();
    let job_id = state.exporter.start_export_job(
        app,
        state.db.clone(),
        request,
        export_dir,
        hw_encoders,
    )?;
    Ok(StartExportResult { job_id })
}

#[tauri::command]
pub fn cancel_export(state: State<'_, AppState>, job_id: String) -> AppResult<OkResult> {
    let ok = state.exporter.cancel_job(&job_id);
    Ok(OkResult { ok })
}

#[tauri::command]
pub async fn save_trimmed_clip(
    app: AppHandle,
    state: State<'_, AppState>,
    request: SaveTrimmedClipRequest,
) -> AppResult<ClipDetail> {
    if !state.capabilities.available {
        return Err(AppError::Process(
            "ffmpeg is not installed or unavailable on PATH".to_string(),
        ));
    }
    let hw_encoders = state.capabilities.hardware_encoders();
    let detail = crate::exporter::save_trimmed_clip_to_library(
        &state.db,
        &state.paths,
        &state.thumb_sem,
        &hw_encoders,
        &state.streamer_base_url,
        &state.streamer_token,
        request,
    )
    .await?;
    let _ = app.emit(
        "clip:added",
        ClipIdEvent {
            clip_id: detail.clip.id.clone(),
        },
    );
    Ok(detail)
}

#[tauri::command]
pub async fn set_clip_thumbnail(
    state: State<'_, AppState>,
    clip_id: String,
    time_sec: f64,
) -> AppResult<SetThumbnailResult> {
    if !state.capabilities.available {
        return Err(AppError::Process(
            "ffmpeg is not installed or unavailable on PATH".to_string(),
        ));
    }
    crate::media::set_clip_thumbnail_core(
        &state.db,
        &state.paths,
        &state.thumb_sem,
        &state.streamer_base_url,
        &state.streamer_token,
        &clip_id,
        time_sec,
    )
    .await
}

#[tauri::command]
pub async fn capture_frame_snapshot(
    state: State<'_, AppState>,
    clip_id: String,
    time_sec: f64,
    aspect_mode: Option<AspectMode>,
    copy_to_clipboard: bool,
) -> AppResult<SnapshotResult> {
    if !state.capabilities.available {
        return Err(AppError::Process(
            "ffmpeg is not installed or unavailable on PATH".to_string(),
        ));
    }
    let settings = state.db.get_settings(&state.paths.default_settings())?;
    let export_dir =
        resolve_export_output_dir(&settings.export_output_dir, &state.paths.default_export_dir);
    crate::media::capture_frame_snapshot_core(
        &state.db,
        &export_dir,
        &clip_id,
        time_sec,
        aspect_mode,
        copy_to_clipboard,
    )
    .await
}

#[tauri::command]
pub fn merge_clips(
    app: AppHandle,
    state: State<'_, AppState>,
    request: MergeClipsRequest,
) -> AppResult<StartExportResult> {
    if !state.capabilities.available {
        return Err(AppError::Process(
            "ffmpeg is not installed or unavailable on PATH".to_string(),
        ));
    }
    let settings = state.db.get_settings(&state.paths.default_settings())?;
    let export_dir =
        resolve_export_output_dir(&settings.export_output_dir, &state.paths.default_export_dir);
    let hw_encoders = state.capabilities.hardware_encoders();
    let job_id = state.exporter.start_merge_job(
        app,
        state.db.clone(),
        state.paths.clone(),
        state.thumb_sem.clone(),
        request,
        export_dir,
        hw_encoders,
    )?;
    Ok(StartExportResult { job_id })
}

#[tauri::command]
pub fn start_editor_export(
    app: AppHandle,
    state: State<'_, AppState>,
    request: StartEditorExportRequest,
) -> AppResult<StartExportResult> {
    if !state.capabilities.available {
        return Err(AppError::Process(
            "ffmpeg is not installed or unavailable on PATH".to_string(),
        ));
    }
    let settings = state.db.get_settings(&state.paths.default_settings())?;
    let export_dir =
        resolve_export_output_dir(&settings.export_output_dir, &state.paths.default_export_dir);
    let hw_encoders = state.capabilities.hardware_encoders();
    let job_id = state.exporter.start_editor_export_job(
        app,
        state.db.clone(),
        state.paths.clone(),
        state.thumb_sem.clone(),
        request,
        export_dir,
        hw_encoders,
    )?;
    Ok(StartExportResult { job_id })
}

#[tauri::command]
pub fn copy_file_to_clipboard(file_path: String) -> AppResult<OkResult> {
    win::clipboard::copy_file_to_clipboard(Path::new(&file_path))?;
    Ok(OkResult { ok: true })
}

#[tauri::command]
pub fn open_in_explorer(file_path: String) -> AppResult<OkResult> {
    win::open_in_explorer(Path::new(&file_path))?;
    Ok(OkResult { ok: true })
}

#[tauri::command]
pub fn get_storage_cleanup_preview(
    state: State<'_, AppState>,
    max_gb: f64,
) -> AppResult<StorageCleanupPreview> {
    state.db.get_storage_cleanup_preview(
        max_gb,
        &state.streamer_base_url,
        &state.streamer_token,
    )
}

#[tauri::command]
pub fn run_storage_cleanup(
    app: AppHandle,
    state: State<'_, AppState>,
    clip_ids: Vec<String>,
) -> AppResult<StorageCleanupResult> {
    let eligible = state.db.list_cleanup_eligible_clips(&clip_ids)?;
    let mut trashed_ids = Vec::new();
    let mut freed_bytes = 0i64;

    for target in eligible {
        win::move_file_to_recycle_bin(Path::new(&target.file_path))?;
        freed_bytes += target.file_size_bytes;
        trashed_ids.push(target.id);
    }

    let removed_count = state.db.delete_clips_by_ids(&trashed_ids)? as i64;
    for clip_id in trashed_ids {
        let _ = app.emit("clip:removed", ClipIdEvent { clip_id });
    }

    Ok(StorageCleanupResult {
        removed_count,
        freed_bytes,
    })
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> AppResult<AppSettings> {
    state.db.get_settings(&state.paths.default_settings())
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    settings: AppSettings,
) -> AppResult<AppSettings> {
    state.db.update_settings(&settings)
}

#[tauri::command]
pub fn detect_steam_recordings_folder() -> DetectNvidiaResult {
    crate::discovery::steam::detect_steam_recordings_folder()
}

#[tauri::command]
pub async fn flush_pending_clips(
    app: AppHandle,
    state: State<'_, AppState>,
) -> AppResult<QueuedCountResult> {
    let flushed = state.watcher.flush_pending(app).await;
    Ok(QueuedCountResult {
        queued_count: flushed as i64,
    })
}

#[tauri::command]
pub fn list_editor_projects(state: State<'_, AppState>) -> AppResult<Vec<EditorProjectSummary>> {
    state.db.list_editor_projects()
}

#[tauri::command]
pub fn save_editor_project(
    state: State<'_, AppState>,
    request: SaveEditorProjectRequest,
) -> AppResult<EditorProjectSummary> {
    state.db.save_editor_project(&request)
}

#[tauri::command]
pub fn load_editor_project(
    state: State<'_, AppState>,
    project_id: String,
) -> AppResult<LoadEditorProjectResult> {
    state.db.load_editor_project(
        &project_id,
        &state.streamer_base_url,
        &state.streamer_token,
    )
}

#[tauri::command]
pub fn delete_editor_project(state: State<'_, AppState>, project_id: String) -> AppResult<()> {
    state.db.delete_editor_project(&project_id)
}

#[tauri::command]
pub async fn pick_audio_file(app: AppHandle) -> AppResult<Option<String>> {
    use tauri_plugin_dialog::DialogExt;

    let picked = tokio::task::spawn_blocking(move || {
        app.dialog()
            .file()
            .add_filter("Audio Files", crate::media::SUPPORTED_AUDIO_EXTENSIONS)
            .blocking_pick_file()
    })
    .await
    .map_err(|e| AppError::Internal(format!("Audio file dialog task failed: {e}")))?;

    Ok(picked
        .and_then(|fp| fp.into_path().ok())
        .map(|p| normalize_windows_path(&p).to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn probe_audio_file(file_path: String) -> AppResult<ProbedAudioFile> {
    crate::media::probe_audio_file(Path::new(&file_path)).await
}
