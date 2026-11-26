use std::collections::HashMap;

use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use super::{now_iso, Db};
use crate::error::{AppError, AppResult};
use crate::models::{GameSummary, SourceType, TagItem, WatchFolder};

impl Db {
    pub fn list_watch_folders(&self) -> AppResult<Vec<WatchFolder>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, path, source_type, enabled, last_scanned_at
             FROM watch_folders
             ORDER BY path ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            let source_raw: String = row.get(2)?;
            let enabled_i: i64 = row.get(3)?;
            Ok(WatchFolder {
                id: row.get(0)?,
                path: row.get(1)?,
                source_type: SourceType::from_str_lossy(&source_raw),
                enabled: enabled_i != 0,
                last_scanned_at: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn add_watch_folder(&self, path: &str, source_type: SourceType) -> AppResult<WatchFolder> {
        let trimmed = path.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput("Watch folder path is empty".to_string()));
        }
        let conn = self.lock()?;
        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO watch_folders (id, path, source_type, enabled)
             VALUES (?1, ?2, ?3, 1)
             ON CONFLICT(path) DO UPDATE SET
                source_type = excluded.source_type,
                enabled = 1",
            params![id, trimmed, source_type.as_str()],
        )?;

        conn.query_row(
            "SELECT id, path, source_type, enabled, last_scanned_at
             FROM watch_folders WHERE path = ?1",
            [trimmed],
            |row| {
                let source_raw: String = row.get(2)?;
                let enabled_i: i64 = row.get(3)?;
                Ok(WatchFolder {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    source_type: SourceType::from_str_lossy(&source_raw),
                    enabled: enabled_i != 0,
                    last_scanned_at: row.get(4)?,
                })
            },
        )
        .map_err(Into::into)
    }

    pub fn remove_watch_folder(&self, folder_id: &str) -> AppResult<bool> {
        let conn = self.lock()?;
        let affected = conn.execute("DELETE FROM watch_folders WHERE id = ?1", [folder_id])?;
        Ok(affected > 0)
    }

    pub fn toggle_watch_folder(&self, folder_id: &str, enabled: bool) -> AppResult<WatchFolder> {
        let conn = self.lock()?;
        let affected = conn.execute(
            "UPDATE watch_folders SET enabled = ?1 WHERE id = ?2",
            params![if enabled { 1 } else { 0 }, folder_id],
        )?;
        if affected == 0 {
            return Err(AppError::NotFound(format!(
                "Watch folder '{folder_id}' not found"
            )));
        }
        conn.query_row(
            "SELECT id, path, source_type, enabled, last_scanned_at
             FROM watch_folders WHERE id = ?1",
            [folder_id],
            |row| {
                let source_raw: String = row.get(2)?;
                let enabled_i: i64 = row.get(3)?;
                Ok(WatchFolder {
                    id: row.get(0)?,
                    path: row.get(1)?,
                    source_type: SourceType::from_str_lossy(&source_raw),
                    enabled: enabled_i != 0,
                    last_scanned_at: row.get(4)?,
                })
            },
        )
        .map_err(Into::into)
    }

    pub fn touch_watch_folder_scanned(&self, folder_id: &str) -> AppResult<()> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE watch_folders SET last_scanned_at = ?1 WHERE id = ?2",
            params![now_iso(), folder_id],
        )?;
        Ok(())
    }

    pub fn upsert_game(&self, raw_name: &str, display_name: &str) -> AppResult<String> {
        let conn = self.lock()?;
        upsert_game_inner(&conn, raw_name, display_name)
    }

    pub fn load_game_id_map(&self) -> AppResult<HashMap<String, String>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare("SELECT raw_name, id FROM games")?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut map = HashMap::new();
        for row in rows {
            let (raw, id) = row?;
            map.insert(raw, id);
        }
        Ok(map)
    }

    pub fn list_games(&self) -> AppResult<Vec<GameSummary>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT g.id, g.raw_name, g.display_name,
                    COUNT(c.id) AS clip_count,
                    COALESCE(SUM(c.file_size_bytes), 0) AS total_size_bytes
             FROM games g
             JOIN clips c ON c.game_id = g.id AND c.is_missing = 0
             GROUP BY g.id, g.raw_name, g.display_name
             ORDER BY clip_count DESC, g.display_name ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(GameSummary {
                id: row.get(0)?,
                raw_name: row.get(1)?,
                display_name: row.get(2)?,
                clip_count: row.get(3)?,
                total_size_bytes: row.get(4)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }

    pub fn list_tags(&self) -> AppResult<Vec<TagItem>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT t.id, t.name, t.color, COUNT(c.id) AS clip_count
             FROM tags t
             LEFT JOIN clip_tags ct ON ct.tag_id = t.id
             LEFT JOIN clips c ON c.id = ct.clip_id AND c.is_missing = 0
             GROUP BY t.id, t.name, t.color
             HAVING clip_count > 0
             ORDER BY clip_count DESC, t.name ASC",
        )?;
        let rows = stmt.query_map([], |row| {
            Ok(TagItem {
                id: row.get(0)?,
                name: row.get(1)?,
                color: row.get(2)?,
                clip_count: row.get(3)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>().map_err(Into::into)
    }
}

pub(crate) fn upsert_game_inner(
    conn: &rusqlite::Connection,
    raw_name: &str,
    display_name: &str,
) -> AppResult<String> {
    if let Some(existing_id) = conn
        .query_row(
            "SELECT id FROM games WHERE raw_name = ?1",
            [raw_name],
            |r| r.get::<_, String>(0),
        )
        .optional()?
    {
        return Ok(existing_id);
    }

    let id = Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO games (id, raw_name, display_name)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(raw_name) DO NOTHING",
        params![id, raw_name, display_name],
    )?;
    let existing_id: String = conn.query_row(
        "SELECT id FROM games WHERE raw_name = ?1",
        [raw_name],
        |r| r.get(0),
    )?;
    Ok(existing_id)
}
