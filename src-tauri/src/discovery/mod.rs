use std::collections::{HashMap, HashSet};
use std::path::{Component, Path, PathBuf};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, UNIX_EPOCH};

use chrono::{DateTime, Local, NaiveDate, NaiveDateTime, NaiveTime, SecondsFormat, TimeZone, Utc};
use notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use regex::Regex;
use tauri::{AppHandle, Emitter};
use tokio::sync::Semaphore;

pub mod steam;

use crate::db::{Db, FolderClipState, ScannedClipInsert};
use crate::discovery::steam::PreparedSteamClip;
use crate::error::AppResult;
use crate::media::{generate_thumbnail, probe_clip};
use crate::models::{ClipIdEvent, ScanProgressEvent, SourceType, WatchFolder};
use crate::paths::{normalize_windows_path, AppPaths};
use crate::win::game_mode::is_fullscreen_game_active;

const VIDEO_EXTENSIONS: &[&str] = &["mp4", "mkv", "mov", "webm"];

pub fn is_supported_video_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|ext| {
            VIDEO_EXTENSIONS
                .iter()
                .any(|allowed| ext.eq_ignore_ascii_case(allowed))
        })
}

pub fn normalize_game_name(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

pub fn parse_shadowplay_naive(file_name: &str) -> Option<NaiveDateTime> {
    static RE_DOT: OnceLock<Regex> = OnceLock::new();
    static RE_DASH: OnceLock<Regex> = OnceLock::new();

    // ShadowPlay (`2024.12.26 - 14.12.05`) and AMD ReLive (`2024.12.26-14.12.05`).
    let re_dot = RE_DOT.get_or_init(|| {
        Regex::new(r"(\d{4})\.(\d{2})\.(\d{2})\s*-\s*(\d{2})\.(\d{2})\.(\d{2})")
            .expect("valid dot timestamp regex")
    });
    if let Some(ndt) = capture_ymdhms(re_dot, file_name) {
        return Some(ndt);
    }

    // OBS, Medal.tv, Xbox (`2026-11-26 07-15-30` or `2026-11-26_07-15-30`).
    let re_dash = RE_DASH.get_or_init(|| {
        Regex::new(r"(\d{4})-(\d{2})-(\d{2})[ _](\d{2})-(\d{2})-(\d{2})")
            .expect("valid dash timestamp regex")
    });
    capture_ymdhms(re_dash, file_name)
}

fn capture_ymdhms(re: &Regex, input: &str) -> Option<NaiveDateTime> {
    let caps = re.captures(input)?;
    let year: i32 = caps[1].parse().ok()?;
    let month: u32 = caps[2].parse().ok()?;
    let day: u32 = caps[3].parse().ok()?;
    let hour: u32 = caps[4].parse().ok()?;
    let min: u32 = caps[5].parse().ok()?;
    let sec: u32 = caps[6].parse().ok()?;

    let date = NaiveDate::from_ymd_opt(year, month, day)?;
    let time = NaiveTime::from_hms_opt(hour, min, sec)?;
    Some(NaiveDateTime::new(date, time))
}

pub fn parse_shadowplay_timestamp(file_name: &str) -> Option<String> {
    let ndt = parse_shadowplay_naive(file_name)?;
    let local_dt = Local
        .from_local_datetime(&ndt)
        .single()
        .or_else(|| Local.from_local_datetime(&ndt).earliest())?;
    Some(local_dt.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Secs, true))
}

pub fn resolve_recorded_at(
    file_name: &str,
    probe_creation_time: Option<&str>,
    file_mtime_secs: i64,
) -> String {
    if let Some(ts) = parse_shadowplay_timestamp(file_name) {
        return ts;
    }
    if let Some(raw) = probe_creation_time {
        if let Ok(parsed) = DateTime::parse_from_rfc3339(raw) {
            return parsed
                .with_timezone(&Utc)
                .to_rfc3339_opts(SecondsFormat::Secs, true);
        }
    }
    DateTime::<Utc>::from_timestamp(file_mtime_secs, 0)
        .unwrap_or_else(Utc::now)
        .to_rfc3339_opts(SecondsFormat::Secs, true)
}

fn is_generic_clip_container(segment: &str) -> bool {
    segment.eq_ignore_ascii_case("clips") || segment.eq_ignore_ascii_case("captures")
}

pub fn extract_game_raw_name(watch_root: &Path, file_path: &Path) -> String {
    let rel_components = strip_prefix_ci(file_path, watch_root);
    if let Some(comps) = rel_components {
        if comps.len() >= 3 && is_generic_clip_container(comps[0].trim()) {
            let nested = comps[1].trim().to_string();
            if !nested.is_empty() {
                return nested;
            }
        }
        if comps.len() >= 2 {
            let candidate = comps[0].trim().to_string();
            if !candidate.is_empty() {
                return candidate;
            }
        }
    }
    watch_root
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Uncategorized".to_string())
}

fn strip_prefix_ci(path: &Path, root: &Path) -> Option<Vec<String>> {
    let p_comps: Vec<String> = path
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_string()),
            Component::Prefix(p) => Some(p.as_os_str().to_string_lossy().to_string()),
            _ => None,
        })
        .collect();
    let r_comps: Vec<String> = root
        .components()
        .filter_map(|c| match c {
            Component::Normal(s) => Some(s.to_string_lossy().to_string()),
            Component::Prefix(p) => Some(p.as_os_str().to_string_lossy().to_string()),
            _ => None,
        })
        .collect();

    if p_comps.len() <= r_comps.len() {
        return None;
    }
    for (a, b) in p_comps.iter().zip(r_comps.iter()) {
        if !a.eq_ignore_ascii_case(b) {
            return None;
        }
    }
    Some(p_comps[r_comps.len()..].to_vec())
}

pub fn collect_video_files(root: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            if ft.is_dir() {
                stack.push(path);
            } else if ft.is_file() && is_supported_video_file(&path) {
                results.push(normalize_windows_path(&path));
            }
        }
    }
    results.sort();
    results
}

enum PreparedScanItem {
    Unchanged {
        clip_id: String,
        media_path: PathBuf,
        duration_sec: f64,
    },
    Ready {
        media_path: PathBuf,
        insert: ScannedClipInsert,
    },
}

async fn prepare_regular_file(
    db: &Db,
    watch_folder: &WatchFolder,
    file_path: &Path,
    existing_states: Option<&HashMap<String, FolderClipState>>,
    game_cache: &mut HashMap<String, String>,
) -> AppResult<Option<PreparedScanItem>> {
    let norm = normalize_windows_path(file_path);
    let Ok(meta) = std::fs::metadata(&norm) else {
        return Ok(None);
    };
    if !meta.is_file() || !is_supported_video_file(&norm) {
        return Ok(None);
    }

    let file_size_bytes = meta.len() as i64;
    let file_mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let file_path_str = norm.to_string_lossy().to_string();
    let lower_key = file_path_str.to_ascii_lowercase();

    let cached_state = match existing_states {
        Some(map) => map.get(&lower_key).cloned(),
        None => db
            .get_clip_mtime_by_path(&file_path_str)?
            .map(|(id, mtime, is_missing)| FolderClipState {
                id,
                file_mtime: mtime,
                is_missing,
                duration_sec: 0.0,
            }),
    };

    if let Some(state) = cached_state {
        if !state.is_missing && state.file_mtime == file_mtime {
            let duration_sec = if state.duration_sec > 0.0 {
                state.duration_sec
            } else {
                db.get_clip_file_info(&state.id)?
                    .map(|info| info.duration_sec)
                    .unwrap_or(0.0)
            };
            return Ok(Some(PreparedScanItem::Unchanged {
                clip_id: state.id,
                media_path: norm,
                duration_sec,
            }));
        }
    }

    let probe = probe_clip(&norm).await?;
    let file_name = norm
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("clip.mp4")
        .to_string();

    let watch_root = normalize_windows_path(Path::new(&watch_folder.path));
    let raw_game = extract_game_raw_name(&watch_root, &norm);
    let display_game = normalize_game_name(&raw_game);
    let game_id = if let Some(id) = game_cache.get(&raw_game) {
        id.clone()
    } else {
        let id = db.upsert_game(&raw_game, &display_game)?;
        game_cache.insert(raw_game, id.clone());
        id
    };

    let recorded_at = resolve_recorded_at(&file_name, probe.creation_time.as_deref(), file_mtime);
    Ok(Some(PreparedScanItem::Ready {
        media_path: norm,
        insert: ScannedClipInsert {
            file_path: file_path_str,
            file_name,
            file_size_bytes,
            file_mtime,
            source_type: watch_folder.source_type,
            game_id: Some(game_id),
            recorded_at,
            duration_sec: probe.duration_sec,
            width: probe.width,
            height: probe.height,
            fps: probe.fps,
            video_codec: probe.video_codec,
            audio_tracks: probe.audio_tracks,
            thumb_path: None,
        },
    }))
}

pub async fn index_single_file(
    db: &Db,
    paths: &AppPaths,
    thumb_sem: &Semaphore,
    watch_folder: &WatchFolder,
    file_path: &Path,
) -> AppResult<Option<(String, bool)>> {
    let mut game_cache = HashMap::new();
    let Some(prepared) =
        prepare_regular_file(db, watch_folder, file_path, None, &mut game_cache).await?
    else {
        return Ok(None);
    };

    match prepared {
        PreparedScanItem::Unchanged {
            clip_id,
            media_path,
            duration_sec,
        } => {
            let thumb = paths.thumb_path(&clip_id);
            if !thumb.exists() {
                let _ = generate_thumbnail(&media_path, duration_sec, &thumb, thumb_sem).await;
            }
            Ok(Some((clip_id, false)))
        }
        PreparedScanItem::Ready { media_path, insert } => {
            let duration_sec = insert.duration_sec;
            let (clip_id, is_new) = db.upsert_scanned_clip(insert)?;
            let thumb_path = paths.thumb_path(&clip_id);
            if generate_thumbnail(&media_path, duration_sec, &thumb_path, thumb_sem)
                .await
                .is_ok()
            {
                let _ = db.update_clip_thumb_path(&clip_id, &thumb_path.to_string_lossy());
            }
            Ok(Some((clip_id, is_new)))
        }
    }
}

fn collect_pending_entries_for_folder(folder: &WatchFolder) -> Vec<PathBuf> {
    let root = normalize_windows_path(Path::new(&folder.path));
    if !root.exists() || !root.is_dir() {
        return Vec::new();
    }
    if folder.source_type == SourceType::Steam {
        return steam::collect_steam_sessions(&root);
    }

    let mut files = collect_video_files(&root);
    if root.join("clips").is_dir() || root.join("video").is_dir() {
        let mut sessions = steam::collect_steam_sessions(&root);
        if !sessions.is_empty() {
            files.append(&mut sessions);
            files.sort();
            files.dedup();
        }
    }
    files
}

async fn index_single_path(
    db: &Db,
    paths: &AppPaths,
    thumb_sem: &Semaphore,
    watch_folder: &WatchFolder,
    path: &Path,
) -> AppResult<Option<(String, bool)>> {
    if steam::is_steam_session_manifest(path) {
        steam::index_single_steam_session(db, paths, thumb_sem, watch_folder, path).await
    } else {
        index_single_file(db, paths, thumb_sem, watch_folder, path).await
    }
}

pub fn count_pending_files(folders: &[WatchFolder]) -> i64 {
    folders
        .iter()
        .filter(|f| f.enabled)
        .map(|f| collect_pending_entries_for_folder(f).len() as i64)
        .sum()
}

pub async fn run_scan_task(
    app: AppHandle,
    db: Db,
    paths: AppPaths,
    thumb_sem: Arc<Semaphore>,
    folders: Vec<WatchFolder>,
) {
    let mut folder_files: Vec<(WatchFolder, Vec<PathBuf>)> = Vec::new();
    let mut total: i64 = 0;

    for folder in folders.into_iter().filter(|f| f.enabled) {
        let files = collect_pending_entries_for_folder(&folder);
        if !files.is_empty() || Path::new(&folder.path).is_dir() {
            total += files.len() as i64;
            folder_files.push((folder, files));
        }
    }

    let mut scanned: i64 = 0;
    let _ = app.emit(
        "scan:progress",
        ScanProgressEvent {
            scanned: 0,
            total,
            current_file: String::new(),
            done: false,
        },
    );

    const SCAN_BATCH_SIZE: usize = 25;

    for (folder, files) in folder_files {
        let mut seen_lower = HashSet::with_capacity(files.len());
        let existing_states = db
            .list_folder_clip_states(&folder.path)
            .unwrap_or_default();
        let mut game_cache = db.load_game_id_map().unwrap_or_default();
        let watch_root = normalize_windows_path(Path::new(&folder.path));
        let has_steam = folder.source_type == SourceType::Steam
            || files.iter().any(|f| steam::is_steam_session_manifest(f));
        let steam_roots = if has_steam {
            steam::collect_steam_library_roots(&watch_root)
        } else {
            Vec::new()
        };

        let mut pending_batch: Vec<(PathBuf, ScannedClipInsert)> =
            Vec::with_capacity(SCAN_BATCH_SIZE);

        for file in files {
            if steam::is_steam_session_manifest(&file) {
                let remux = normalize_windows_path(&steam::steam_remux_output_path(&paths, &file));
                seen_lower.insert(remux.to_string_lossy().to_ascii_lowercase());
            } else {
                seen_lower.insert(file.to_string_lossy().to_ascii_lowercase());
            }

            let name = file
                .parent()
                .filter(|_| steam::is_steam_session_manifest(&file))
                .and_then(|p| p.file_name())
                .or_else(|| file.file_name())
                .and_then(|n| n.to_str())
                .unwrap_or("")
                .to_string();

            let prepared = if steam::is_steam_session_manifest(&file) {
                match steam::prepare_steam_session(
                    &db,
                    &paths,
                    &folder,
                    &file,
                    Some(&existing_states),
                    &mut game_cache,
                    &steam_roots,
                )
                .await
                {
                    Ok(Some(PreparedSteamClip::Unchanged {
                        clip_id,
                        media_path,
                        duration_sec,
                    })) => Ok(Some(PreparedScanItem::Unchanged {
                        clip_id,
                        media_path,
                        duration_sec,
                    })),
                    Ok(Some(PreparedSteamClip::Ready { media_path, insert })) => {
                        Ok(Some(PreparedScanItem::Ready { media_path, insert }))
                    }
                    Ok(None) => Ok(None),
                    Err(e) => Err(e),
                }
            } else {
                prepare_regular_file(
                    &db,
                    &folder,
                    &file,
                    Some(&existing_states),
                    &mut game_cache,
                )
                .await
            };

            if let Ok(Some(item)) = prepared {
                match item {
                    PreparedScanItem::Unchanged {
                        clip_id,
                        media_path,
                        duration_sec,
                    } => {
                        let thumb = paths.thumb_path(&clip_id);
                        if !thumb.exists() {
                            let _ = generate_thumbnail(&media_path, duration_sec, &thumb, &thumb_sem)
                                .await;
                        }
                    }
                    PreparedScanItem::Ready { media_path, insert } => {
                        pending_batch.push((media_path, insert));
                        if pending_batch.len() >= SCAN_BATCH_SIZE {
                            flush_scan_batch(&app, &db, &paths, &thumb_sem, &mut pending_batch)
                                .await;
                        }
                    }
                }
            }

            scanned += 1;
            let _ = app.emit(
                "scan:progress",
                ScanProgressEvent {
                    scanned,
                    total,
                    current_file: name,
                    done: false,
                },
            );
        }

        if !pending_batch.is_empty() {
            flush_scan_batch(&app, &db, &paths, &thumb_sem, &mut pending_batch).await;
        }

        if let Ok(newly_missing) = db.mark_missing_clips_for_folder(&folder.path, &seen_lower) {
            for clip_id in newly_missing {
                let _ = app.emit("clip:removed", ClipIdEvent { clip_id });
            }
        }
        let _ = db.touch_watch_folder_scanned(&folder.id);
    }

    let _ = app.emit(
        "scan:progress",
        ScanProgressEvent {
            scanned,
            total,
            current_file: String::new(),
            done: true,
        },
    );
}

async fn flush_scan_batch(
    app: &AppHandle,
    db: &Db,
    paths: &AppPaths,
    thumb_sem: &Semaphore,
    pending_batch: &mut Vec<(PathBuf, ScannedClipInsert)>,
) {
    let items = std::mem::take(pending_batch);
    let inserts: Vec<ScannedClipInsert> = items.iter().map(|(_, ins)| ins.clone()).collect();
    let Ok(results) = db.upsert_scanned_clips_batch(&inserts) else {
        return;
    };

    let mut thumb_updates = Vec::new();
    for ((media_path, insert), (clip_id, is_new)) in items.into_iter().zip(results) {
        let thumb_path = paths.thumb_path(&clip_id);
        if generate_thumbnail(&media_path, insert.duration_sec, &thumb_path, thumb_sem)
            .await
            .is_ok()
        {
            thumb_updates.push((clip_id.clone(), thumb_path.to_string_lossy().to_string()));
        }
        if is_new {
            let _ = app.emit("clip:added", ClipIdEvent { clip_id });
        }
    }

    if !thumb_updates.is_empty() {
        let _ = db.update_clip_thumb_paths_batch(&thumb_updates);
    }
}

pub struct ClipWatcher {
    inner: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    db: Db,
    paths: AppPaths,
    thumb_sem: Arc<Semaphore>,
    pending_while_gaming: Arc<Mutex<Vec<(String, PathBuf)>>>,
    folders_snapshot: Arc<Mutex<Vec<WatchFolder>>>,
}

impl ClipWatcher {
    pub fn new(db: Db, paths: AppPaths, thumb_sem: Arc<Semaphore>) -> Self {
        Self {
            inner: Mutex::new(None),
            db,
            paths,
            thumb_sem,
            pending_while_gaming: Arc::new(Mutex::new(Vec::new())),
            folders_snapshot: Arc::new(Mutex::new(Vec::new())),
        }
    }

    pub fn reload(&self, app: AppHandle, folders: Vec<WatchFolder>) -> AppResult<()> {
        let enabled_folders: Vec<WatchFolder> = folders.into_iter().filter(|f| f.enabled).collect();
        if let Ok(mut snap) = self.folders_snapshot.lock() {
            *snap = enabled_folders.clone();
        }

        let db = self.db.clone();
        let paths = self.paths.clone();
        let thumb_sem = self.thumb_sem.clone();
        let folders_for_cb = enabled_folders.clone();
        let pending_queue = self.pending_while_gaming.clone();

        let mut debouncer = new_debouncer(
            Duration::from_millis(1500),
            move |res: DebounceEventResult| {
                let Ok(events) = res else {
                    return;
                };
                let mut touched_paths = HashSet::new();
                for ev in events {
                    if is_supported_video_file(&ev.path)
                        || steam::is_steam_session_manifest(&ev.path)
                    {
                        touched_paths.insert(normalize_windows_path(&ev.path));
                    }
                }
                if touched_paths.is_empty() {
                    return;
                }

                // Defer heavy ffprobe/ffmpeg/remux work while the user is in a fullscreen game.
                if is_fullscreen_game_active() {
                    if let Ok(mut queue) = pending_queue.lock() {
                        for path in touched_paths {
                            if let Some(folder) = find_owning_folder(&folders_for_cb, &path) {
                                let already_queued = queue
                                    .iter()
                                    .any(|(fid, p)| fid == &folder.id && p == &path);
                                if !already_queued {
                                    queue.push((folder.id, path));
                                }
                            }
                        }
                    }
                    return;
                }

                let db = db.clone();
                let paths = paths.clone();
                let thumb_sem = thumb_sem.clone();
                let app = app.clone();
                let folders_snapshot = folders_for_cb.clone();

                tauri::async_runtime::spawn(async move {
                    for path in touched_paths {
                        let owner = find_owning_folder(&folders_snapshot, &path);
                        process_watcher_path(&app, &db, &paths, &thumb_sem, owner.as_ref(), &path)
                            .await;
                    }
                });
            },
        )
        .map_err(|e| crate::error::AppError::Internal(format!("Watcher init failed: {e}")))?;

        for folder in &enabled_folders {
            let root = normalize_windows_path(Path::new(&folder.path));
            if root.exists() && root.is_dir() {
                let _ = debouncer.watcher().watch(&root, RecursiveMode::Recursive);
            }
        }

        let mut guard = self
            .inner
            .lock()
            .map_err(|_| crate::error::AppError::Internal("Watcher lock poisoned".to_string()))?;
        *guard = Some(debouncer);
        Ok(())
    }

    pub async fn flush_pending(&self, app: AppHandle) -> usize {
        let queued = match self.pending_while_gaming.lock() {
            Ok(mut guard) => {
                if guard.is_empty() {
                    return 0;
                }
                std::mem::take(&mut *guard)
            }
            Err(_) => return 0,
        };

        let folders = self
            .folders_snapshot
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default();

        let count = queued.len();
        for (folder_id, path) in queued {
            let owner = folders
                .iter()
                .find(|f| f.id == folder_id)
                .cloned()
                .or_else(|| find_owning_folder(&folders, &path));
            process_watcher_path(
                &app,
                &self.db,
                &self.paths,
                &self.thumb_sem,
                owner.as_ref(),
                &path,
            )
            .await;
        }
        count
    }
}

async fn process_watcher_path(
    app: &AppHandle,
    db: &Db,
    paths: &AppPaths,
    thumb_sem: &Semaphore,
    folder: Option<&WatchFolder>,
    path: &Path,
) {
    if path.exists() {
        if let Some(folder) = folder {
            if let Ok(Some((clip_id, is_new))) =
                index_single_path(db, paths, thumb_sem, folder, path).await
            {
                if is_new {
                    let _ = app.emit("clip:added", ClipIdEvent { clip_id });
                }
            }
        }
    } else {
        let target_path = if steam::is_steam_session_manifest(path) {
            normalize_windows_path(&steam::steam_remux_output_path(paths, path))
        } else {
            path.to_path_buf()
        };
        let path_str = target_path.to_string_lossy().to_string();
        if let Ok(Some(clip_id)) = db.mark_clip_missing_by_path(&path_str) {
            let _ = app.emit("clip:removed", ClipIdEvent { clip_id });
        }
    }
}

fn find_owning_folder(folders: &[WatchFolder], file_path: &Path) -> Option<WatchFolder> {
    let lower_file = file_path.to_string_lossy().to_ascii_lowercase();
    folders
        .iter()
        .filter(|f| {
            let mut prefix = f.path.trim().replace('/', "\\").to_ascii_lowercase();
            if !prefix.ends_with('\\') {
                prefix.push('\\');
            }
            lower_file.starts_with(&prefix)
        })
        .max_by_key(|f| f.path.len())
        .cloned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Datelike, Timelike};

    #[test]
    fn normalizes_double_and_extra_whitespace_in_game_names() {
        assert_eq!(
            normalize_game_name("  Wang Pai Dui Jue   Lost Saga  "),
            "Wang Pai Dui Jue Lost Saga"
        );
        assert_eq!(normalize_game_name("Valorant"), "Valorant");
        assert_eq!(
            normalize_game_name("Counter-strike   2"),
            "Counter-strike 2"
        );
    }

    #[test]
    fn parses_shadowplay_and_dvr_filename_timestamps() {
        let dt1 = parse_shadowplay_naive("Desktop 2024.12.26 - 14.12.05.01.mp4")
            .expect("parse standard shadowplay");
        assert_eq!(dt1.year(), 2024);
        assert_eq!(dt1.month(), 12);
        assert_eq!(dt1.day(), 26);
        assert_eq!(dt1.hour(), 14);
        assert_eq!(dt1.minute(), 12);
        assert_eq!(dt1.second(), 5);

        let dt2 = parse_shadowplay_naive("Valorant 2026.11.24 - 21.15.30.05.DVR.mp4")
            .expect("parse DVR shadowplay");
        assert_eq!(dt2.year(), 2026);
        assert_eq!(dt2.month(), 11);
        assert_eq!(dt2.day(), 24);
        assert_eq!(dt2.hour(), 21);
        assert_eq!(dt2.minute(), 15);
        assert_eq!(dt2.second(), 30);

        assert!(parse_shadowplay_naive("random_clip.mp4").is_none());

        let amd = parse_shadowplay_naive("Valorant_Replay_2026.05.14-19.08.55.mp4")
            .expect("parse AMD ReLive");
        assert_eq!(amd.year(), 2026);
        assert_eq!(amd.month(), 5);
        assert_eq!(amd.day(), 14);
        assert_eq!(amd.hour(), 19);
        assert_eq!(amd.minute(), 8);
        assert_eq!(amd.second(), 55);

        let obs = parse_shadowplay_naive("2026-11-26 07-15-30.mkv").expect("parse OBS");
        assert_eq!(obs.year(), 2026);
        assert_eq!(obs.month(), 11);
        assert_eq!(obs.day(), 26);
        assert_eq!(obs.hour(), 7);
        assert_eq!(obs.minute(), 15);
        assert_eq!(obs.second(), 30);

        let medal = parse_shadowplay_naive("MedalTVValorant2026-03-09_22-44-11.mp4")
            .expect("parse Medal/Xbox underscore");
        assert_eq!(medal.year(), 2026);
        assert_eq!(medal.month(), 3);
        assert_eq!(medal.day(), 9);
        assert_eq!(medal.hour(), 22);
        assert_eq!(medal.minute(), 44);
        assert_eq!(medal.second(), 11);
    }

    #[test]
    fn extracts_game_name_for_nested_and_flat_watch_folders() {
        assert_eq!(
            extract_game_raw_name(
                Path::new(r"C:\Users\bebas\Videos\NVIDIA"),
                Path::new(r"C:\Users\bebas\Videos\NVIDIA\Valorant\clip.mp4"),
            ),
            "Valorant"
        );
        assert_eq!(
            extract_game_raw_name(
                Path::new(r"C:\Medal"),
                Path::new(r"C:\Medal\Clips\Valorant\clip.mp4"),
            ),
            "Valorant"
        );
        assert_eq!(
            extract_game_raw_name(
                Path::new(r"C:\Users\bebas\Videos\Overwolf\Outplayed"),
                Path::new(r"C:\Users\bebas\Videos\Overwolf\Outplayed\Captures\Apex Legends\clip.mp4"),
            ),
            "Apex Legends"
        );
        assert_eq!(
            extract_game_raw_name(
                Path::new(r"D:\Clips"),
                Path::new(r"d:\clips\Counter-strike   2\sub\clip.mp4"),
            ),
            "Counter-strike   2"
        );
        assert_eq!(
            extract_game_raw_name(
                Path::new(r"C:\Users\bebas\Videos\Captures"),
                Path::new(r"C:\Users\bebas\Videos\Captures\clip.mp4"),
            ),
            "Captures"
        );
        assert_eq!(
            extract_game_raw_name(
                Path::new(r"D:\OBS Recordings"),
                Path::new(r"d:\obs recordings\2026-11-26.mkv"),
            ),
            "OBS Recordings"
        );
    }
}
