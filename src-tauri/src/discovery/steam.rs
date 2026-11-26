use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::UNIX_EPOCH;

use chrono::{DateTime, Local, NaiveDateTime, SecondsFormat, TimeZone, Utc};
use tokio::sync::Semaphore;

use crate::db::{Db, FolderClipState, ScannedClipInsert};
use crate::error::{AppError, AppResult};
use crate::media::{generate_thumbnail, probe_clip, tokio_command_bg};
use crate::models::{DetectNvidiaResult, DetectSource, SourceType, WatchFolder};
use crate::paths::{normalize_windows_path, sanitize_path_segment, AppPaths};

pub fn detect_steam_recordings_folder() -> DetectNvidiaResult {
    let mut candidates: Vec<(PathBuf, DetectSource)> = Vec::new();
    if let Some(reg_root) = read_steam_path_from_registry() {
        candidates.push((reg_root, DetectSource::Registry));
    }

    let fallback_root = PathBuf::from(r"C:\Program Files (x86)\Steam");
    candidates.push((fallback_root, DetectSource::Default));

    let mut fallback_dir: Option<(PathBuf, DetectSource)> = None;

    for (steam_root, source) in candidates {
        let userdata = steam_root.join("userdata");
        let Ok(entries) = std::fs::read_dir(&userdata) else {
            continue;
        };
        let mut user_dirs: Vec<PathBuf> = entries
            .flatten()
            .map(|e| e.path())
            .filter(|p| p.is_dir())
            .collect();
        user_dirs.sort();

        for user_dir in user_dirs {
            let rec_dir = normalize_windows_path(&user_dir.join("gamerecordings"));
            if !rec_dir.is_dir() {
                continue;
            }
            if rec_dir.join("clips").is_dir() || rec_dir.join("video").is_dir() {
                return DetectNvidiaResult {
                    found: true,
                    path: Some(rec_dir.to_string_lossy().to_string()),
                    source,
                };
            }
            if fallback_dir.is_none() {
                fallback_dir = Some((rec_dir, source));
            }
        }
    }

    if let Some((rec_dir, source)) = fallback_dir {
        return DetectNvidiaResult {
            found: true,
            path: Some(rec_dir.to_string_lossy().to_string()),
            source,
        };
    }

    DetectNvidiaResult {
        found: false,
        path: None,
        source: DetectSource::None,
    }
}

#[cfg(target_os = "windows")]
pub fn read_steam_path_from_registry() -> Option<PathBuf> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        REG_EXPAND_SZ, REG_SZ, REG_VALUE_TYPE,
    };

    let subkey: Vec<u16> = r"Software\Valve\Steam"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let value_name: Vec<u16> = "SteamPath"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut hkey = HKEY::default();
    let open_res = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            Some(0),
            KEY_READ,
            &mut hkey,
        )
    };
    if open_res.is_err() {
        return None;
    }

    let mut reg_type = REG_VALUE_TYPE::default();
    let mut size: u32 = 0;
    let query_size = unsafe {
        RegQueryValueExW(
            hkey,
            PCWSTR(value_name.as_ptr()),
            None,
            Some(&mut reg_type),
            None,
            Some(&mut size),
        )
    };
    if query_size.is_err() || size == 0 {
        unsafe {
            let _ = RegCloseKey(hkey);
        }
        return None;
    }

    let mut buf = vec![0u8; size as usize];
    let query_val = unsafe {
        RegQueryValueExW(
            hkey,
            PCWSTR(value_name.as_ptr()),
            None,
            Some(&mut reg_type),
            Some(buf.as_mut_ptr()),
            Some(&mut size),
        )
    };
    unsafe {
        let _ = RegCloseKey(hkey);
    }
    if query_val.is_err() {
        return None;
    }

    if reg_type != REG_SZ && reg_type != REG_EXPAND_SZ {
        return None;
    }

    let decoded = crate::win::registry::decode_utf16le_bytes(&buf[..size as usize])?;
    Some(normalize_windows_path(Path::new(&decoded)))
}

#[cfg(not(target_os = "windows"))]
pub fn read_steam_path_from_registry() -> Option<PathBuf> {
    None
}

pub fn parse_steam_recording_folder_name(folder_name: &str) -> Option<(String, Option<String>)> {
    let trimmed = folder_name.trim();
    let rest = trimmed
        .strip_prefix("clip_")
        .or_else(|| trimmed.strip_prefix("bg_"))?;
    let mut parts = rest.split('_');
    let appid = parts.next()?.trim();
    if appid.is_empty() || !appid.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }

    let recorded_at = match (parts.next(), parts.next()) {
        (Some(date_part), Some(time_part))
            if date_part.len() == 8
                && time_part.len() >= 6
                && date_part.chars().all(|c| c.is_ascii_digit())
                && time_part[..6].chars().all(|c| c.is_ascii_digit()) =>
        {
            let stamp = format!("{}_{}", date_part, &time_part[..6]);
            NaiveDateTime::parse_from_str(&stamp, "%Y%m%d_%H%M%S")
                .ok()
                .and_then(|naive| Local.from_local_datetime(&naive).single())
                .map(|dt| dt.with_timezone(&Utc).to_rfc3339_opts(SecondsFormat::Secs, true))
        }
        _ => None,
    };

    Some((appid.to_string(), recorded_at))
}

pub fn parse_appmanifest_name(acf_content: &str) -> Option<String> {
    for raw_line in acf_content.lines() {
        let tokens = extract_vdf_quoted_tokens(raw_line);
        if tokens.len() >= 2 && tokens[0].eq_ignore_ascii_case("name") {
            let name = tokens[1].trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

pub fn parse_libraryfolders_paths(vdf_content: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    for raw_line in vdf_content.lines() {
        let tokens = extract_vdf_quoted_tokens(raw_line);
        if tokens.len() >= 2 && tokens[0].eq_ignore_ascii_case("path") {
            let unescaped = tokens[1].trim().replace("\\\\", "\\");
            if !unescaped.is_empty() {
                paths.push(normalize_windows_path(Path::new(&unescaped)));
            }
        }
    }
    paths
}

fn extract_vdf_quoted_tokens(line: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '"' {
            let mut val = String::new();
            while let Some(inner) = chars.next() {
                if inner == '\\' {
                    if let Some(next_ch) = chars.next() {
                        val.push(next_ch);
                    }
                } else if inner == '"' {
                    break;
                } else {
                    val.push(inner);
                }
            }
            tokens.push(val);
        } else if c == '/' && chars.peek() == Some(&'/') {
            break;
        }
    }
    tokens
}

fn push_unique_root(roots: &mut Vec<PathBuf>, seen: &mut HashSet<String>, candidate: PathBuf) {
    let norm = normalize_windows_path(&candidate);
    let key = norm.to_string_lossy().to_ascii_lowercase();
    if seen.insert(key) {
        roots.push(norm);
    }
}

pub fn collect_steam_library_roots(watch_root: &Path) -> Vec<PathBuf> {
    let mut roots: Vec<PathBuf> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();

    if let Some(reg_root) = read_steam_path_from_registry() {
        push_unique_root(&mut roots, &mut seen, reg_root);
    }

    // Walk up from .../userdata/<id>/gamerecordings to infer the Steam root if different.
    for ancestor in watch_root.ancestors() {
        if ancestor
            .file_name()
            .and_then(|n| n.to_str())
            .map(|n| n.eq_ignore_ascii_case("userdata"))
            .unwrap_or(false)
        {
            if let Some(steam_root) = ancestor.parent() {
                push_unique_root(&mut roots, &mut seen, steam_root.to_path_buf());
            }
            break;
        }
        if ancestor.join("steamapps").is_dir() {
            push_unique_root(&mut roots, &mut seen, ancestor.to_path_buf());
        }
    }

    let default_root = PathBuf::from(r"C:\Program Files (x86)\Steam");
    if default_root.is_dir() {
        push_unique_root(&mut roots, &mut seen, default_root);
    }

    let mut extra_roots = Vec::new();
    for root in &roots {
        let lib_vdf = root.join("steamapps").join("libraryfolders.vdf");
        if let Ok(content) = std::fs::read_to_string(&lib_vdf) {
            extra_roots.extend(parse_libraryfolders_paths(&content));
        }
    }
    for extra in extra_roots {
        push_unique_root(&mut roots, &mut seen, extra);
    }

    roots
}

pub fn resolve_steam_game_name(steam_roots: &[PathBuf], appid: &str) -> String {
    let manifest_name = format!("appmanifest_{appid}.acf");
    for root in steam_roots {
        let manifest_path = root.join("steamapps").join(&manifest_name);
        if let Ok(content) = std::fs::read_to_string(&manifest_path) {
            if let Some(name) = parse_appmanifest_name(&content) {
                return name;
            }
        }
    }
    format!("Steam {appid}")
}

pub fn is_steam_session_manifest(path: &Path) -> bool {
    path.file_name()
        .and_then(|n| n.to_str())
        .map(|n| n.eq_ignore_ascii_case("session.mpd"))
        .unwrap_or(false)
}

pub fn collect_steam_sessions(root: &Path) -> Vec<PathBuf> {
    let mut results = Vec::new();
    let mut stack = Vec::new();

    let clips_dir = root.join("clips");
    let video_dir = root.join("video");
    if clips_dir.is_dir() {
        stack.push(clips_dir);
    }
    if video_dir.is_dir() {
        stack.push(video_dir);
    }
    if stack.is_empty() && root.is_dir() {
        stack.push(root.to_path_buf());
    }

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
            } else if ft.is_file() && is_steam_session_manifest(&path) {
                results.push(normalize_windows_path(&path));
            }
        }
    }
    results.sort();
    results
}

pub fn steam_remux_output_path(paths: &AppPaths, mpd_path: &Path) -> PathBuf {
    let folder_name = mpd_path
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("steam_session");
    let clean = sanitize_path_segment(folder_name, "steam_session");
    paths.steam_remux_dir.join(format!("{clean}.mp4"))
}

pub async fn remux_steam_mpd_to_mp4(mpd_path: &Path, out_mp4: &Path) -> AppResult<()> {
    if let Ok(meta) = tokio::fs::metadata(out_mp4).await {
        if meta.is_file() && meta.len() > 0 {
            return Ok(());
        }
    }

    if let Some(parent) = out_mp4.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let tmp_path = out_mp4.with_extension("tmp.mp4");
    let _ = tokio::fs::remove_file(&tmp_path).await;

    let mpd_str = mpd_path.to_string_lossy().to_string();
    let tmp_str = tmp_path.to_string_lossy().to_string();

    let output = tokio_command_bg("ffmpeg")
        .args([
            "-y",
            "-v",
            "error",
            "-i",
            &mpd_str,
            "-c",
            "copy",
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
        .map_err(|e| AppError::Process(format!("Failed to launch ffmpeg for Steam remux: {e}")))?;

    if !output.status.success() {
        let _ = tokio::fs::remove_file(&tmp_path).await;
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(AppError::Process(format!(
            "ffmpeg Steam DASH remux failed for {mpd_str}: {stderr}"
        )));
    }

    tokio::fs::rename(&tmp_path, out_mp4).await?;
    Ok(())
}

pub enum PreparedSteamClip {
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

pub async fn prepare_steam_session(
    db: &Db,
    paths: &AppPaths,
    watch_folder: &WatchFolder,
    mpd_path: &Path,
    existing_states: Option<&HashMap<String, FolderClipState>>,
    game_cache: &mut HashMap<String, String>,
    steam_roots: &[PathBuf],
) -> AppResult<Option<PreparedSteamClip>> {
    let norm_mpd = normalize_windows_path(mpd_path);
    if !norm_mpd.is_file() || !is_steam_session_manifest(&norm_mpd) {
        return Ok(None);
    }

    let out_mp4 = normalize_windows_path(&steam_remux_output_path(paths, &norm_mpd));
    remux_steam_mpd_to_mp4(&norm_mpd, &out_mp4).await?;

    let Ok(meta) = std::fs::metadata(&out_mp4) else {
        return Ok(None);
    };
    if !meta.is_file() || meta.len() == 0 {
        return Ok(None);
    }

    let file_size_bytes = meta.len() as i64;
    let file_mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let file_path_str = out_mp4.to_string_lossy().to_string();
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
            return Ok(Some(PreparedSteamClip::Unchanged {
                clip_id: state.id,
                media_path: out_mp4,
                duration_sec,
            }));
        }
    }

    let probe = probe_clip(&out_mp4).await?;
    let folder_name = norm_mpd
        .parent()
        .and_then(|p| p.file_name())
        .and_then(|n| n.to_str())
        .unwrap_or("steam_clip");

    let _ = watch_folder;
    let (raw_game, display_game, folder_recorded_at) =
        if let Some((appid, ts)) = parse_steam_recording_folder_name(folder_name) {
            let display = resolve_steam_game_name(steam_roots, &appid);
            (format!("steam_{appid}"), display, ts)
        } else {
            ("steam_unknown".to_string(), "Steam Recording".to_string(), None)
        };

    let game_id = if let Some(id) = game_cache.get(&raw_game) {
        id.clone()
    } else {
        let id = db.upsert_game(&raw_game, &display_game)?;
        game_cache.insert(raw_game, id.clone());
        id
    };

    let recorded_at = folder_recorded_at.unwrap_or_else(|| {
        DateTime::<Utc>::from_timestamp(file_mtime, 0)
            .unwrap_or_else(Utc::now)
            .to_rfc3339_opts(SecondsFormat::Secs, true)
    });

    let file_name = out_mp4
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("steam_clip.mp4")
        .to_string();

    Ok(Some(PreparedSteamClip::Ready {
        media_path: out_mp4,
        insert: ScannedClipInsert {
            file_path: file_path_str,
            file_name,
            file_size_bytes,
            file_mtime,
            source_type: SourceType::Steam,
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

pub async fn index_single_steam_session(
    db: &Db,
    paths: &AppPaths,
    thumb_sem: &Semaphore,
    watch_folder: &WatchFolder,
    mpd_path: &Path,
) -> AppResult<Option<(String, bool)>> {
    let watch_root = normalize_windows_path(Path::new(&watch_folder.path));
    let steam_roots = collect_steam_library_roots(&watch_root);
    let mut game_cache = HashMap::new();
    let Some(prepared) = prepare_steam_session(
        db,
        paths,
        watch_folder,
        mpd_path,
        None,
        &mut game_cache,
        &steam_roots,
    )
    .await?
    else {
        return Ok(None);
    };

    match prepared {
        PreparedSteamClip::Unchanged {
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
        PreparedSteamClip::Ready { media_path, insert } => {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_steam_appmanifest_name() {
        let sample = r#"
"AppState"
{
	"appid"		"730"
	"Universe"		"1"
	"name"		"Counter-Strike 2"
	"StateFlags"		"4"
	"installdir"		"Counter-Strike Global Offensive"
}
"#;
        assert_eq!(
            parse_appmanifest_name(sample),
            Some("Counter-Strike 2".to_string())
        );
        assert_eq!(parse_appmanifest_name("\"AppState\" { \"appid\" \"730\" }"), None);
    }

    #[test]
    fn parses_steam_clip_and_bg_folder_names() {
        let (appid, recorded_at) =
            parse_steam_recording_folder_name("clip_730_20261125_213045")
                .expect("valid clip folder");
        assert_eq!(appid, "730");
        let ts_str = recorded_at.expect("timestamp extracted");
        let parsed = DateTime::parse_from_rfc3339(&ts_str).expect("valid RFC3339");
        let expected_local = Local
            .with_ymd_and_hms(2026, 11, 25, 21, 30, 45)
            .single()
            .expect("local datetime");
        assert_eq!(parsed.timestamp(), expected_local.timestamp());

        let (bg_appid, bg_ts) =
            parse_steam_recording_folder_name("bg_1091500_20260102_030405")
                .expect("valid bg folder");
        assert_eq!(bg_appid, "1091500");
        assert!(bg_ts.is_some());

        assert!(parse_steam_recording_folder_name("not_a_clip").is_none());
        assert!(parse_steam_recording_folder_name("clip_abc_20260101_000000").is_none());
    }

    #[test]
    fn parses_libraryfolders_vdf_paths() {
        let vdf = r#"
"libraryfolders"
{
	"0"
	{
		"path"		"C:\\Program Files (x86)\\Steam"
	}
	"1"
	{
		"path"		"D:\\SteamLibrary"
	}
}
"#;
        let paths = parse_libraryfolders_paths(vdf);
        assert_eq!(paths.len(), 2);
        assert_eq!(paths[0], PathBuf::from(r"C:\Program Files (x86)\Steam"));
        assert_eq!(paths[1], PathBuf::from(r"D:\SteamLibrary"));
    }
}
