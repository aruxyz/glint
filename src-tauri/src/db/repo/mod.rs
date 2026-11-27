pub mod clips;
pub mod collections;
pub mod editor_projects;
pub mod folders;
pub mod markers;
pub mod presets;
pub mod search;
pub mod settings;

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};

use chrono::{SecondsFormat, Utc};
use rusqlite::types::Value;
use rusqlite::{params_from_iter, Connection, Row};

use crate::db::schema::run_migrations;
use crate::error::{AppError, AppResult};
use crate::models::{ClipSummary, SourceType};

pub(crate) const SQLITE_CHUNK_SIZE: usize = 450;

#[derive(Clone)]
pub struct Db {
    pub(crate) conn: Arc<Mutex<Connection>>,
}

#[derive(Debug, Clone)]
pub struct ScannedAudioTrackInput {
    pub stream_index: i32,
    pub track_order: i32,
    pub label: String,
    pub codec: String,
    pub channels: i32,
    pub sample_rate: i32,
    pub bitrate: Option<i64>,
}

#[derive(Debug, Clone)]
pub struct ScannedClipInsert {
    pub file_path: String,
    pub file_name: String,
    pub file_size_bytes: i64,
    pub file_mtime: i64,
    pub source_type: SourceType,
    pub game_id: Option<String>,
    pub recorded_at: String,
    pub duration_sec: f64,
    pub width: i32,
    pub height: i32,
    pub fps: f64,
    pub video_codec: String,
    pub audio_tracks: Vec<ScannedAudioTrackInput>,
    pub thumb_path: Option<String>,
}

#[derive(Debug, Clone)]
pub struct ClipFileInfo {
    pub id: String,
    pub file_path: String,
    pub duration_sec: f64,
    pub width: i32,
    pub height: i32,
    pub is_missing: bool,
}

#[derive(Debug, Clone)]
pub struct FolderClipState {
    pub id: String,
    pub file_mtime: i64,
    pub is_missing: bool,
    pub duration_sec: f64,
}

#[derive(Debug, Clone)]
pub struct ClipDeleteTarget {
    pub id: String,
    pub file_path: String,
    pub file_size_bytes: i64,
}

#[derive(Debug, Clone)]
pub struct ClipHardlinkSource {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
}

impl Db {
    pub fn open(path: &Path) -> AppResult<Self> {
        let conn = Connection::open(path)?;
        run_migrations(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub fn open_in_memory() -> AppResult<Self> {
        let conn = Connection::open_in_memory()?;
        run_migrations(&conn)?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
        })
    }

    pub(crate) fn lock(&self) -> AppResult<std::sync::MutexGuard<'_, Connection>> {
        self.conn
            .lock()
            .map_err(|_| AppError::Internal("Database lock poisoned".to_string()))
    }
}

pub(crate) fn map_clip_summary_row(
    row: &Row<'_>,
    streamer_base_url: &str,
    token: &str,
) -> rusqlite::Result<ClipSummary> {
    let id: String = row.get(0)?;
    let source_raw: String = row.get(4)?;
    let fav_i: i64 = row.get(14)?;
    let pin_i: i64 = row.get(15)?;
    let miss_i: i64 = row.get(17)?;
    Ok(ClipSummary {
        thumb_url: build_thumb_url(streamer_base_url, &id, token),
        id,
        file_path: row.get(1)?,
        file_name: row.get(2)?,
        file_size_bytes: row.get(3)?,
        source_type: SourceType::from_str_lossy(&source_raw),
        game_id: row.get(5)?,
        game_name: row.get(6)?,
        recorded_at: row.get(7)?,
        duration_sec: row.get(8)?,
        width: row.get(9)?,
        height: row.get(10)?,
        fps: row.get(11)?,
        video_codec: row.get(12)?,
        audio_track_count: row.get(13)?,
        is_favorite: fav_i != 0,
        is_pinned: pin_i != 0,
        title: row.get(16)?,
        collection_count: 0,
        tags: Vec::new(),
        is_missing: miss_i != 0,
    })
}

pub(crate) fn enrich_clip_summaries(
    conn: &Connection,
    mut clips: Vec<ClipSummary>,
) -> AppResult<Vec<ClipSummary>> {
    if clips.is_empty() {
        return Ok(clips);
    }

    let ids: Vec<String> = clips.iter().map(|c| c.id.clone()).collect();
    let mut col_counts: HashMap<String, i64> = HashMap::new();
    let mut tag_map: HashMap<String, Vec<String>> = HashMap::new();

    for chunk in ids.chunks(SQLITE_CHUNK_SIZE) {
        let placeholders = numbered_placeholders(1, chunk.len());

        let col_sql = format!(
            "SELECT clip_id, COUNT(*) FROM collection_clips WHERE clip_id IN ({placeholders}) GROUP BY clip_id"
        );
        let mut col_stmt = conn.prepare(&col_sql)?;
        let col_rows = col_stmt.query_map(params_from_iter(chunk.iter()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?))
        })?;
        for row in col_rows {
            let (cid, cnt) = row?;
            col_counts.insert(cid, cnt);
        }

        let tag_sql = format!(
            "SELECT ct.clip_id, t.name
             FROM clip_tags ct
             JOIN tags t ON t.id = ct.tag_id
             WHERE ct.clip_id IN ({placeholders})
             ORDER BY t.name ASC"
        );
        let mut tag_stmt = conn.prepare(&tag_sql)?;
        let tag_rows = tag_stmt.query_map(params_from_iter(chunk.iter()), |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        for row in tag_rows {
            let (cid, tname) = row?;
            tag_map.entry(cid).or_default().push(tname);
        }
    }

    for clip in &mut clips {
        clip.collection_count = *col_counts.get(&clip.id).unwrap_or(&0);
        clip.tags = tag_map.remove(&clip.id).unwrap_or_default();
    }

    Ok(clips)
}

pub(crate) fn build_thumb_url(base_url: &str, clip_id: &str, token: &str) -> String {
    if base_url.is_empty() {
        String::new()
    } else {
        format!("{base_url}/thumb/{clip_id}?token={token}")
    }
}

pub(crate) fn push_val(next_idx: &mut usize, params: &mut Vec<Value>, val: Value) -> String {
    let idx = *next_idx;
    *next_idx += 1;
    params.push(val);
    format!("?{idx}")
}

pub(crate) fn numbered_placeholders(start: usize, count: usize) -> String {
    (start..start + count)
        .map(|i| format!("?{i}"))
        .collect::<Vec<_>>()
        .join(", ")
}

pub(crate) fn normalize_dir_prefix(folder_path: &str) -> String {
    let mut lower = folder_path.trim().replace('/', "\\").to_ascii_lowercase();
    if !lower.ends_with('\\') {
        lower.push('\\');
    }
    lower
}

pub(crate) fn now_iso() -> String {
    Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true)
}
