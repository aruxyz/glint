use std::collections::HashMap;

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use uuid::Uuid;

use super::{now_iso, ClipHardlinkSource, Db};
use crate::db::smart_rules::build_smart_rules_clause;
use crate::error::{AppError, AppResult};
use crate::models::{CollectionKind, CollectionSummary, SmartRules};

type CollectionRow = (
    String,
    String,
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    i32,
    String,
    String,
);

impl Db {
    pub fn list_collections(&self) -> AppResult<Vec<CollectionSummary>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, kind, icon, color, smart_rules_json, sort_order, created_at, updated_at
             FROM collections
             ORDER BY sort_order ASC, created_at ASC",
        )?;
        let base_rows = stmt
            .query_map([], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, Option<String>>(3)?,
                    r.get::<_, Option<String>>(4)?,
                    r.get::<_, Option<String>>(5)?,
                    r.get::<_, i32>(6)?,
                    r.get::<_, String>(7)?,
                    r.get::<_, String>(8)?,
                ))
            })?
            .collect::<Result<Vec<CollectionRow>, _>>()?;
        drop(stmt);

        let manual_stats = load_all_manual_collection_stats(&conn)?;

        let mut out = Vec::with_capacity(base_rows.len());
        for (id, name, kind_raw, icon, color, smart_json, sort_order, created_at, updated_at) in
            base_rows
        {
            let kind = CollectionKind::from_str_lossy(&kind_raw);
            let smart_rules = match &smart_json {
                Some(raw) => Some(serde_json::from_str::<SmartRules>(raw)?),
                None => None,
            };
            let (clip_count, total_size_bytes) = match kind {
                CollectionKind::Manual => manual_stats.get(&id).copied().unwrap_or((0, 0)),
                CollectionKind::Smart => compute_smart_collection_stats(&conn, smart_rules.as_ref())?,
            };

            out.push(CollectionSummary {
                id,
                name,
                kind,
                icon,
                color,
                smart_rules,
                clip_count,
                total_size_bytes,
                sort_order,
                created_at,
                updated_at,
            });
        }
        Ok(out)
    }

    pub fn get_collection(&self, id: &str) -> AppResult<CollectionSummary> {
        let conn = self.lock()?;
        get_collection_inner(&conn, id)
    }

    pub fn create_collection(
        &self,
        name: &str,
        kind: CollectionKind,
        icon: Option<String>,
        color: Option<String>,
        smart_rules: Option<SmartRules>,
    ) -> AppResult<CollectionSummary> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(AppError::InvalidInput(
                "Collection name cannot be empty".to_string(),
            ));
        }

        let smart_json = match kind {
            CollectionKind::Smart => {
                let rules = smart_rules.ok_or_else(|| {
                    AppError::InvalidInput("Smart collection requires smartRules".to_string())
                })?;
                let _ = build_smart_rules_clause(&rules, 1)?;
                Some(serde_json::to_string(&rules)?)
            }
            CollectionKind::Manual => None,
        };

        let conn = self.lock()?;
        let next_order: i32 = conn.query_row(
            "SELECT COALESCE(MAX(sort_order), -1) + 1 FROM collections",
            [],
            |r| r.get(0),
        )?;
        let id = Uuid::new_v4().to_string();
        let now = now_iso();

        conn.execute(
            "INSERT INTO collections (
                id, name, kind, icon, color, smart_rules_json, sort_order, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                id,
                trimmed,
                kind.as_str(),
                icon,
                color,
                smart_json,
                next_order,
                now,
                now,
            ],
        )?;

        get_collection_inner(&conn, &id)
    }

    pub fn update_collection(
        &self,
        id: &str,
        name: Option<String>,
        icon: Option<String>,
        color: Option<String>,
        smart_rules: Option<SmartRules>,
    ) -> AppResult<CollectionSummary> {
        let conn = self.lock()?;
        let existing = get_collection_inner(&conn, id)?;

        let new_name = match name {
            Some(n) => {
                let t = n.trim();
                if t.is_empty() {
                    return Err(AppError::InvalidInput(
                        "Collection name cannot be empty".to_string(),
                    ));
                }
                t.to_string()
            }
            None => existing.name,
        };

        let new_icon = icon.or(existing.icon);
        let new_color = color.or(existing.color);
        let new_smart_json = match (existing.kind, smart_rules) {
            (CollectionKind::Smart, Some(rules)) => {
                let _ = build_smart_rules_clause(&rules, 1)?;
                Some(serde_json::to_string(&rules)?)
            }
            (CollectionKind::Smart, None) => existing
                .smart_rules
                .as_ref()
                .map(serde_json::to_string)
                .transpose()?,
            (CollectionKind::Manual, _) => None,
        };

        conn.execute(
            "UPDATE collections
             SET name = ?1, icon = ?2, color = ?3, smart_rules_json = ?4, updated_at = ?5
             WHERE id = ?6",
            params![new_name, new_icon, new_color, new_smart_json, now_iso(), id],
        )?;

        get_collection_inner(&conn, id)
    }

    pub fn delete_collection(&self, id: &str) -> AppResult<bool> {
        let conn = self.lock()?;
        let affected = conn.execute("DELETE FROM collections WHERE id = ?1", [id])?;
        Ok(affected > 0)
    }

    pub fn modify_collection_clips(
        &self,
        collection_id: &str,
        add_clip_ids: Option<Vec<String>>,
        remove_clip_ids: Option<Vec<String>>,
    ) -> AppResult<i64> {
        let mut conn = self.lock()?;
        let kind: Option<String> = conn
            .query_row(
                "SELECT kind FROM collections WHERE id = ?1",
                [collection_id],
                |r| r.get(0),
            )
            .optional()?;

        match kind.as_deref() {
            None => {
                return Err(AppError::NotFound(format!(
                    "Collection '{collection_id}' not found"
                )));
            }
            Some("smart") => {
                return Err(AppError::InvalidInput(
                    "Cannot manually add or remove clips in a smart collection".to_string(),
                ));
            }
            _ => {}
        }

        let tx = conn.transaction()?;
        let now = now_iso();

        if let Some(adds) = add_clip_ids {
            let mut next_pos: i64 = tx.query_row(
                "SELECT COALESCE(MAX(position), -1) + 1 FROM collection_clips WHERE collection_id = ?1",
                [collection_id],
                |r| r.get(0),
            )?;
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO collection_clips (collection_id, clip_id, added_at, position)
                 VALUES (?1, ?2, ?3, ?4)",
            )?;
            for clip_id in adds {
                let inserted = stmt.execute(params![collection_id, clip_id, now, next_pos])?;
                if inserted > 0 {
                    next_pos += 1;
                }
            }
        }

        if let Some(removes) = remove_clip_ids {
            let mut stmt = tx.prepare(
                "DELETE FROM collection_clips WHERE collection_id = ?1 AND clip_id = ?2",
            )?;
            for clip_id in removes {
                stmt.execute(params![collection_id, clip_id])?;
            }
        }

        tx.execute(
            "UPDATE collections SET updated_at = ?1 WHERE id = ?2",
            params![now, collection_id],
        )?;

        let count: i64 = tx.query_row(
            "SELECT COUNT(*) FROM collection_clips cc
             JOIN clips c ON c.id = cc.clip_id
             WHERE cc.collection_id = ?1 AND c.is_missing = 0",
            [collection_id],
            |r| r.get(0),
        )?;

        tx.commit()?;
        Ok(count)
    }

    pub fn list_collection_clip_files(
        &self,
        collection_id: &str,
    ) -> AppResult<(String, Vec<ClipHardlinkSource>)> {
        let conn = self.lock()?;
        let col = get_collection_inner(&conn, collection_id)?;

        let clips = match col.kind {
            CollectionKind::Manual => {
                let mut stmt = conn.prepare(
                    "SELECT c.id, c.file_path, c.file_name
                     FROM collection_clips cc
                     JOIN clips c ON c.id = cc.clip_id
                     WHERE cc.collection_id = ?1 AND c.is_missing = 0
                     ORDER BY cc.position ASC, c.recorded_at DESC",
                )?;
                let rows = stmt
                    .query_map([collection_id], |r| {
                        Ok(ClipHardlinkSource {
                            id: r.get(0)?,
                            file_path: r.get(1)?,
                            file_name: r.get(2)?,
                        })
                    })?
                    .collect::<Result<Vec<_>, _>>()?;
                rows
            }
            CollectionKind::Smart => {
                if let Some(rules) = &col.smart_rules {
                    let (clause, params) = build_smart_rules_clause(rules, 1)?;
                    let sql = format!(
                        "SELECT c.id, c.file_path, c.file_name
                         FROM clips c
                         LEFT JOIN games g ON g.id = c.game_id
                         WHERE c.is_missing = 0 AND {clause}
                         ORDER BY c.recorded_at DESC"
                    );
                    let mut stmt = conn.prepare(&sql)?;
                    let rows = stmt
                        .query_map(params_from_iter(params.iter()), |r| {
                            Ok(ClipHardlinkSource {
                                id: r.get(0)?,
                                file_path: r.get(1)?,
                                file_name: r.get(2)?,
                            })
                        })?
                        .collect::<Result<Vec<_>, _>>()?;
                    rows
                } else {
                    Vec::new()
                }
            }
        };

        Ok((col.name, clips))
    }
}

fn load_all_manual_collection_stats(conn: &Connection) -> AppResult<HashMap<String, (i64, i64)>> {
    let mut stmt = conn.prepare(
        "SELECT cc.collection_id, COUNT(c.id), COALESCE(SUM(c.file_size_bytes), 0)
         FROM collection_clips cc
         JOIN clips c ON c.id = cc.clip_id
         WHERE c.is_missing = 0
         GROUP BY cc.collection_id",
    )?;
    let rows = stmt.query_map([], |r| {
        Ok((
            r.get::<_, String>(0)?,
            (r.get::<_, i64>(1)?, r.get::<_, i64>(2)?),
        ))
    })?;
    let mut stats = HashMap::new();
    for row in rows {
        let (col_id, counts) = row?;
        stats.insert(col_id, counts);
    }
    Ok(stats)
}

fn get_collection_inner(conn: &Connection, id: &str) -> AppResult<CollectionSummary> {
    let row: Option<CollectionRow> = conn
        .query_row(
            "SELECT id, name, kind, icon, color, smart_rules_json, sort_order, created_at, updated_at
             FROM collections WHERE id = ?1",
            [id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                    r.get(6)?,
                    r.get(7)?,
                    r.get(8)?,
                ))
            },
        )
        .optional()?;

    let (id, name, kind_raw, icon, color, smart_json, sort_order, created_at, updated_at) =
        row.ok_or_else(|| AppError::NotFound(format!("Collection '{id}' not found")))?;

    let kind = CollectionKind::from_str_lossy(&kind_raw);
    let smart_rules = match &smart_json {
        Some(raw) => Some(serde_json::from_str::<SmartRules>(raw)?),
        None => None,
    };
    let (clip_count, total_size_bytes) = match kind {
        CollectionKind::Manual => conn.query_row(
            "SELECT COUNT(c.id), COALESCE(SUM(c.file_size_bytes), 0)
             FROM collection_clips cc
             JOIN clips c ON c.id = cc.clip_id
             WHERE cc.collection_id = ?1 AND c.is_missing = 0",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?,
        CollectionKind::Smart => compute_smart_collection_stats(conn, smart_rules.as_ref())?,
    };

    Ok(CollectionSummary {
        id,
        name,
        kind,
        icon,
        color,
        smart_rules,
        clip_count,
        total_size_bytes,
        sort_order,
        created_at,
        updated_at,
    })
}

fn compute_smart_collection_stats(
    conn: &Connection,
    smart_rules: Option<&SmartRules>,
) -> AppResult<(i64, i64)> {
    match smart_rules {
        Some(rules) => {
            let (clause, params) = build_smart_rules_clause(rules, 1)?;
            let sql = format!(
                "SELECT COUNT(c.id), COALESCE(SUM(c.file_size_bytes), 0)
                 FROM clips c
                 LEFT JOIN games g ON g.id = c.game_id
                 WHERE c.is_missing = 0 AND {clause}"
            );
            conn.query_row(&sql, params_from_iter(params.iter()), |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .map_err(Into::into)
        }
        None => Ok((0, 0)),
    }
}
