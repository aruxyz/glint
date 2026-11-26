use std::collections::{HashMap, HashSet};

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use uuid::Uuid;

use super::{
    enrich_clip_summaries, map_clip_summary_row, normalize_dir_prefix, now_iso,
    numbered_placeholders, ClipDeleteTarget, ClipFileInfo, Db, FolderClipState, ScannedClipInsert,
    SQLITE_CHUNK_SIZE,
};
use crate::db::repo::search::sync_clip_fts_tx;
use crate::error::{AppError, AppResult};
use crate::models::{AudioTrack, ClipDetail, LibraryStats, StorageCleanupPreview};

impl Db {
    pub fn get_clip_mtime_by_path(&self, file_path: &str) -> AppResult<Option<(String, i64, bool)>> {
        let conn = self.lock()?;
        conn.query_row(
            "SELECT id, file_mtime, is_missing FROM clips WHERE LOWER(file_path) = LOWER(?1)",
            [file_path],
            |r| {
                let missing_i: i64 = r.get(2)?;
                Ok((r.get(0)?, r.get(1)?, missing_i != 0))
            },
        )
        .optional()
        .map_err(Into::into)
    }

    /// Fetch existing clip states for a watch folder in a single query to avoid O(N) per-file lookups.
    pub fn list_folder_clip_states(
        &self,
        folder_path: &str,
    ) -> AppResult<HashMap<String, FolderClipState>> {
        let prefix = normalize_dir_prefix(folder_path);
        let conn = self.lock()?;
        let mut stmt =
            conn.prepare("SELECT id, file_path, file_mtime, is_missing, duration_sec FROM clips")?;
        let rows = stmt.query_map([], |r| {
            let missing_i: i64 = r.get(3)?;
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, i64>(2)?,
                missing_i != 0,
                r.get::<_, f64>(4)?,
            ))
        })?;

        let mut map = HashMap::new();
        for row in rows {
            let (id, file_path, file_mtime, is_missing, duration_sec) = row?;
            let lower = file_path.to_ascii_lowercase();
            if lower.starts_with(&prefix) {
                map.insert(
                    lower,
                    FolderClipState {
                        id,
                        file_mtime,
                        is_missing,
                        duration_sec,
                    },
                );
            }
        }
        Ok(map)
    }

    pub fn upsert_scanned_clip(&self, input: ScannedClipInsert) -> AppResult<(String, bool)> {
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let res = upsert_scanned_clip_tx(&tx, &input)?;
        tx.commit()?;
        Ok(res)
    }

    pub fn upsert_scanned_clips_batch(
        &self,
        inputs: &[ScannedClipInsert],
    ) -> AppResult<Vec<(String, bool)>> {
        if inputs.is_empty() {
            return Ok(Vec::new());
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let mut results = Vec::with_capacity(inputs.len());
        for input in inputs {
            results.push(upsert_scanned_clip_tx(&tx, input)?);
        }
        tx.commit()?;
        Ok(results)
    }

    pub fn update_clip_thumb_path(&self, clip_id: &str, thumb_path: &str) -> AppResult<()> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE clips SET thumb_path = ?1 WHERE id = ?2",
            params![thumb_path, clip_id],
        )?;
        Ok(())
    }

    pub fn update_clip_thumb_paths_batch(&self, updates: &[(String, String)]) -> AppResult<()> {
        if updates.is_empty() {
            return Ok(());
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        {
            let mut stmt = tx.prepare("UPDATE clips SET thumb_path = ?1 WHERE id = ?2")?;
            for (clip_id, thumb_path) in updates {
                stmt.execute(params![thumb_path, clip_id])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn mark_clip_missing_by_path(&self, file_path: &str) -> AppResult<Option<String>> {
        let conn = self.lock()?;
        let row: Option<(String, i64)> = conn
            .query_row(
                "SELECT id, is_missing FROM clips WHERE LOWER(file_path) = LOWER(?1)",
                [file_path],
                |r| Ok((r.get(0)?, r.get(1)?)),
            )
            .optional()?;

        if let Some((clip_id, is_missing)) = row {
            if is_missing == 0 {
                conn.execute("UPDATE clips SET is_missing = 1 WHERE id = ?1", [&clip_id])?;
                return Ok(Some(clip_id));
            }
        }
        Ok(None)
    }

    pub fn mark_missing_clips_for_folder(
        &self,
        folder_path: &str,
        seen_paths_lower: &HashSet<String>,
    ) -> AppResult<Vec<String>> {
        let prefix = normalize_dir_prefix(folder_path);
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let rows = {
            let mut stmt = tx.prepare("SELECT id, file_path FROM clips WHERE is_missing = 0")?;
            let mapped = stmt
                .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
                .collect::<Result<Vec<_>, _>>()?;
            mapped
        };

        let newly_missing: Vec<String> = rows
            .into_iter()
            .filter_map(|(id, file_path)| {
                let lower = file_path.to_ascii_lowercase();
                if lower.starts_with(&prefix) && !seen_paths_lower.contains(&lower) {
                    Some(id)
                } else {
                    None
                }
            })
            .collect();

        for chunk in newly_missing.chunks(SQLITE_CHUNK_SIZE) {
            let placeholders = numbered_placeholders(1, chunk.len());
            let sql = format!("UPDATE clips SET is_missing = 1 WHERE id IN ({placeholders})");
            tx.execute(&sql, params_from_iter(chunk.iter()))?;
        }

        tx.commit()?;
        Ok(newly_missing)
    }

    pub fn get_clip_file_info(&self, clip_id: &str) -> AppResult<Option<ClipFileInfo>> {
        let conn = self.lock()?;
        conn.query_row(
            "SELECT id, file_path, duration_sec, width, height, is_missing
             FROM clips WHERE id = ?1",
            [clip_id],
            |r| {
                let missing_i: i64 = r.get(5)?;
                Ok(ClipFileInfo {
                    id: r.get(0)?,
                    file_path: r.get(1)?,
                    duration_sec: r.get(2)?,
                    width: r.get(3)?,
                    height: r.get(4)?,
                    is_missing: missing_i != 0,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn get_audio_track(
        &self,
        clip_id: &str,
        track_order: i32,
    ) -> AppResult<Option<AudioTrack>> {
        let conn = self.lock()?;
        conn.query_row(
            "SELECT id, clip_id, stream_index, track_order, label, codec, channels, sample_rate, bitrate
             FROM audio_tracks
             WHERE clip_id = ?1 AND track_order = ?2",
            params![clip_id, track_order],
            |r| {
                Ok(AudioTrack {
                    id: r.get(0)?,
                    clip_id: r.get(1)?,
                    stream_index: r.get(2)?,
                    track_order: r.get(3)?,
                    label: r.get(4)?,
                    codec: r.get(5)?,
                    channels: r.get(6)?,
                    sample_rate: r.get(7)?,
                    bitrate: r.get(8)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
    }

    pub fn get_clip_detail(
        &self,
        clip_id: &str,
        streamer_base_url: &str,
        token: &str,
    ) -> AppResult<ClipDetail> {
        let conn = self.lock()?;
        get_clip_detail_inner(&conn, clip_id, streamer_base_url, token)
    }

    #[allow(clippy::too_many_arguments)]
    pub fn update_clip_meta(
        &self,
        clip_id: &str,
        title: Option<String>,
        notes: Option<String>,
        is_favorite: Option<bool>,
        is_pinned: Option<bool>,
        tag_names: Option<Vec<String>>,
        streamer_base_url: &str,
        token: &str,
    ) -> AppResult<ClipDetail> {
        let mut conn = self.lock()?;
        let exists: bool = conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM clips WHERE id = ?1)",
            [clip_id],
            |r| r.get(0),
        )?;
        if !exists {
            return Err(AppError::NotFound(format!("Clip '{clip_id}' not found")));
        }

        let tx = conn.transaction()?;

        if let Some(t) = title {
            let cleaned = if t.trim().is_empty() {
                None
            } else {
                Some(t.trim().to_string())
            };
            tx.execute(
                "UPDATE clips SET title = ?1 WHERE id = ?2",
                params![cleaned, clip_id],
            )?;
        }

        if let Some(n) = notes {
            let cleaned = if n.trim().is_empty() { None } else { Some(n) };
            tx.execute(
                "UPDATE clips SET notes = ?1 WHERE id = ?2",
                params![cleaned, clip_id],
            )?;
        }

        if let Some(fav) = is_favorite {
            tx.execute(
                "UPDATE clips SET is_favorite = ?1 WHERE id = ?2",
                params![if fav { 1 } else { 0 }, clip_id],
            )?;
        }

        if let Some(pin) = is_pinned {
            tx.execute(
                "UPDATE clips SET is_pinned = ?1 WHERE id = ?2",
                params![if pin { 1 } else { 0 }, clip_id],
            )?;
        }

        if let Some(names) = tag_names {
            tx.execute("DELETE FROM clip_tags WHERE clip_id = ?1", [clip_id])?;
            let mut seen = HashSet::new();
            for raw_name in names {
                let name = raw_name.trim();
                if name.is_empty() || !seen.insert(name.to_ascii_lowercase()) {
                    continue;
                }
                let tag_id: Option<String> = tx
                    .query_row(
                        "SELECT id FROM tags WHERE name = ?1 COLLATE NOCASE",
                        [name],
                        |r| r.get(0),
                    )
                    .optional()?;
                let resolved_id = match tag_id {
                    Some(id) => id,
                    None => {
                        let new_id = Uuid::new_v4().to_string();
                        tx.execute(
                            "INSERT INTO tags (id, name) VALUES (?1, ?2)",
                            params![new_id, name],
                        )?;
                        new_id
                    }
                };
                tx.execute(
                    "INSERT OR IGNORE INTO clip_tags (clip_id, tag_id) VALUES (?1, ?2)",
                    params![clip_id, resolved_id],
                )?;
            }
        }

        sync_clip_fts_tx(&tx, clip_id)?;
        tx.commit()?;

        get_clip_detail_inner(&conn, clip_id, streamer_base_url, token)
    }

    pub fn get_clips_by_ids(&self, clip_ids: &[String]) -> AppResult<Vec<ClipDeleteTarget>> {
        self.fetch_delete_targets(clip_ids, false)
    }

    pub fn list_cleanup_eligible_clips(
        &self,
        clip_ids: &[String],
    ) -> AppResult<Vec<ClipDeleteTarget>> {
        self.fetch_delete_targets(clip_ids, true)
    }

    fn fetch_delete_targets(
        &self,
        clip_ids: &[String],
        only_unprotected: bool,
    ) -> AppResult<Vec<ClipDeleteTarget>> {
        if clip_ids.is_empty() {
            return Ok(Vec::new());
        }
        let conn = self.lock()?;
        let mut out = Vec::new();
        let extra = if only_unprotected {
            " AND is_favorite = 0 AND is_pinned = 0"
        } else {
            ""
        };
        for chunk in clip_ids.chunks(SQLITE_CHUNK_SIZE) {
            let placeholders = numbered_placeholders(1, chunk.len());
            let sql = format!(
                "SELECT id, file_path, file_size_bytes FROM clips WHERE id IN ({placeholders}){extra}"
            );
            let mut stmt = conn.prepare(&sql)?;
            let rows = stmt
                .query_map(params_from_iter(chunk.iter()), |r| {
                    Ok(ClipDeleteTarget {
                        id: r.get(0)?,
                        file_path: r.get(1)?,
                        file_size_bytes: r.get(2)?,
                    })
                })?
                .collect::<Result<Vec<_>, _>>()?;
            out.extend(rows);
        }
        Ok(out)
    }

    pub fn delete_clips_by_ids(&self, clip_ids: &[String]) -> AppResult<usize> {
        if clip_ids.is_empty() {
            return Ok(0);
        }
        let mut conn = self.lock()?;
        let tx = conn.transaction()?;
        let mut total_deleted = 0usize;
        for chunk in clip_ids.chunks(SQLITE_CHUNK_SIZE) {
            let placeholders = numbered_placeholders(1, chunk.len());
            let fts_sql = format!("DELETE FROM clips_fts WHERE clip_id IN ({placeholders})");
            tx.execute(&fts_sql, params_from_iter(chunk.iter()))?;
            let del_sql = format!("DELETE FROM clips WHERE id IN ({placeholders})");
            total_deleted += tx.execute(&del_sql, params_from_iter(chunk.iter()))?;
        }
        tx.commit()?;
        Ok(total_deleted)
    }

    pub fn get_library_stats(&self) -> AppResult<LibraryStats> {
        let conn = self.lock()?;
        let (total_clips, total_favorites, total_size_bytes): (i64, i64, i64) = conn.query_row(
            "SELECT COUNT(*),
                    COALESCE(SUM(CASE WHEN is_favorite = 1 THEN 1 ELSE 0 END), 0),
                    COALESCE(SUM(file_size_bytes), 0)
             FROM clips
             WHERE is_missing = 0",
            [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )?;
        let games_count: i64 = conn.query_row(
            "SELECT COUNT(DISTINCT game_id)
             FROM clips
             WHERE is_missing = 0 AND game_id IS NOT NULL",
            [],
            |r| r.get(0),
        )?;

        Ok(LibraryStats {
            total_clips,
            total_favorites,
            total_size_bytes,
            games_count,
        })
    }

    pub fn get_storage_cleanup_preview(
        &self,
        max_gb: f64,
        streamer_base_url: &str,
        token: &str,
    ) -> AppResult<StorageCleanupPreview> {
        let conn = self.lock()?;
        let total_size_bytes: i64 = conn.query_row(
            "SELECT COALESCE(SUM(file_size_bytes), 0) FROM clips WHERE is_missing = 0",
            [],
            |r| r.get(0),
        )?;
        let max_storage_bytes = (max_gb.max(0.0) * 1024.0 * 1024.0 * 1024.0).round() as i64;

        if total_size_bytes <= max_storage_bytes {
            return Ok(StorageCleanupPreview {
                total_size_bytes,
                max_storage_bytes,
                reclaimable_bytes: 0,
                candidates: Vec::new(),
            });
        }

        let bytes_to_free = total_size_bytes - max_storage_bytes;
        let mut stmt = conn.prepare(
            "SELECT c.id, c.file_path, c.file_name, c.file_size_bytes, c.source_type,
                    c.game_id, COALESCE(g.display_name, 'Uncategorized') AS game_name,
                    c.recorded_at, c.duration_sec, c.width, c.height, c.fps,
                    c.video_codec, c.audio_track_count, c.is_favorite, c.is_pinned,
                    c.title, c.is_missing
             FROM clips c
             LEFT JOIN games g ON g.id = c.game_id
             WHERE c.is_missing = 0 AND c.is_favorite = 0 AND c.is_pinned = 0
             ORDER BY c.recorded_at ASC, c.file_name ASC",
        )?;

        let all_eligible = stmt
            .query_map([], |row| map_clip_summary_row(row, streamer_base_url, token))?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);

        let mut selected = Vec::new();
        let mut reclaimable_bytes = 0i64;
        for clip in all_eligible {
            if reclaimable_bytes >= bytes_to_free {
                break;
            }
            reclaimable_bytes += clip.file_size_bytes;
            selected.push(clip);
        }

        let candidates = enrich_clip_summaries(&conn, selected)?;
        Ok(StorageCleanupPreview {
            total_size_bytes,
            max_storage_bytes,
            reclaimable_bytes,
            candidates,
        })
    }
}

fn upsert_scanned_clip_tx(
    tx: &Connection,
    input: &ScannedClipInsert,
) -> AppResult<(String, bool)> {
    let existing_id: Option<String> = tx
        .query_row(
            "SELECT id FROM clips WHERE LOWER(file_path) = LOWER(?1)",
            [&input.file_path],
            |r| r.get(0),
        )
        .optional()?;

    let is_new = existing_id.is_none();
    let clip_id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let indexed_at = now_iso();
    let track_count = input.audio_tracks.len() as i32;

    if is_new {
        tx.execute(
            "INSERT INTO clips (
                id, file_path, file_name, file_size_bytes, file_mtime, source_type,
                game_id, recorded_at, duration_sec, width, height, fps, video_codec,
                audio_track_count, thumb_path, is_missing, indexed_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, 0, ?16)",
            params![
                clip_id,
                input.file_path,
                input.file_name,
                input.file_size_bytes,
                input.file_mtime,
                input.source_type.as_str(),
                input.game_id,
                input.recorded_at,
                input.duration_sec,
                input.width,
                input.height,
                input.fps,
                input.video_codec,
                track_count,
                input.thumb_path,
                indexed_at,
            ],
        )?;
    } else {
        tx.execute(
            "UPDATE clips SET
                file_name = ?2,
                file_size_bytes = ?3,
                file_mtime = ?4,
                source_type = ?5,
                game_id = ?6,
                recorded_at = ?7,
                duration_sec = ?8,
                width = ?9,
                height = ?10,
                fps = ?11,
                video_codec = ?12,
                audio_track_count = ?13,
                thumb_path = COALESCE(?14, thumb_path),
                is_missing = 0,
                indexed_at = ?15
             WHERE id = ?1",
            params![
                clip_id,
                input.file_name,
                input.file_size_bytes,
                input.file_mtime,
                input.source_type.as_str(),
                input.game_id,
                input.recorded_at,
                input.duration_sec,
                input.width,
                input.height,
                input.fps,
                input.video_codec,
                track_count,
                input.thumb_path,
                indexed_at,
            ],
        )?;
    }

    tx.execute("DELETE FROM audio_tracks WHERE clip_id = ?1", [&clip_id])?;
    if !input.audio_tracks.is_empty() {
        let mut track_stmt = tx.prepare(
            "INSERT INTO audio_tracks (
                id, clip_id, stream_index, track_order, label, codec, channels, sample_rate, bitrate
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        )?;
        for track in &input.audio_tracks {
            track_stmt.execute(params![
                Uuid::new_v4().to_string(),
                clip_id,
                track.stream_index,
                track.track_order,
                track.label,
                track.codec,
                track.channels,
                track.sample_rate,
                track.bitrate,
            ])?;
        }
    }

    sync_clip_fts_tx(tx, &clip_id)?;
    Ok((clip_id, is_new))
}

fn get_clip_detail_inner(
    conn: &Connection,
    clip_id: &str,
    streamer_base_url: &str,
    token: &str,
) -> AppResult<ClipDetail> {
    let row = conn
        .query_row(
            "SELECT c.id, c.file_path, c.file_name, c.file_size_bytes, c.source_type,
                    c.game_id, COALESCE(g.display_name, 'Uncategorized') AS game_name,
                    c.recorded_at, c.duration_sec, c.width, c.height, c.fps,
                    c.video_codec, c.audio_track_count, c.is_favorite, c.is_pinned,
                    c.title, c.is_missing, c.notes
             FROM clips c
             LEFT JOIN games g ON g.id = c.game_id
             WHERE c.id = ?1",
            [clip_id],
            |row| Ok((map_clip_summary_row(row, streamer_base_url, token)?, row.get::<_, Option<String>>(18)?)),
        )
        .optional()?;

    let (summary, notes) =
        row.ok_or_else(|| AppError::NotFound(format!("Clip '{clip_id}' not found")))?;
    let mut enriched = enrich_clip_summaries(conn, vec![summary])?;
    let clip = enriched.remove(0);

    let mut track_stmt = conn.prepare(
        "SELECT id, clip_id, stream_index, track_order, label, codec, channels, sample_rate, bitrate
         FROM audio_tracks
         WHERE clip_id = ?1
         ORDER BY track_order ASC",
    )?;
    let audio_tracks = track_stmt
        .query_map([clip_id], |r| {
            Ok(AudioTrack {
                id: r.get(0)?,
                clip_id: r.get(1)?,
                stream_index: r.get(2)?,
                track_order: r.get(3)?,
                label: r.get(4)?,
                codec: r.get(5)?,
                channels: r.get(6)?,
                sample_rate: r.get(7)?,
                bitrate: r.get(8)?,
            })
        })?
        .collect::<Result<Vec<_>, _>>()?;

    let mut col_stmt = conn.prepare(
        "SELECT collection_id FROM collection_clips WHERE clip_id = ?1 ORDER BY added_at ASC",
    )?;
    let collection_ids = col_stmt
        .query_map([clip_id], |r| r.get(0))?
        .collect::<Result<Vec<String>, _>>()?;

    Ok(ClipDetail {
        clip,
        notes,
        audio_tracks,
        collection_ids,
    })
}
