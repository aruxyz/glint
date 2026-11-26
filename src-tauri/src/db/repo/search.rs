use rusqlite::types::Value;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

use super::{enrich_clip_summaries, map_clip_summary_row, push_val, Db};
use crate::db::smart_rules::build_smart_rules_clause;
use crate::error::AppResult;
use crate::models::{ClipSortBy, ListClipsQuery, ListClipsResult, SmartRules};

impl Db {
    pub fn list_clips(
        &self,
        query: &ListClipsQuery,
        streamer_base_url: &str,
        token: &str,
    ) -> AppResult<ListClipsResult> {
        let conn = self.lock()?;
        let mut where_parts = vec!["c.is_missing = 0".to_string()];
        let mut params: Vec<Value> = Vec::new();
        let mut next_idx = 1usize;

        if let Some(game_id) = &query.game_id {
            if !game_id.trim().is_empty() {
                let p = push_val(&mut next_idx, &mut params, Value::Text(game_id.clone()));
                where_parts.push(format!("c.game_id = {p}"));
            }
        }

        if let Some(collection_id) = &query.collection_id {
            let row: Option<(String, Option<String>)> = conn
                .query_row(
                    "SELECT kind, smart_rules_json FROM collections WHERE id = ?1",
                    [collection_id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?;

            match row {
                Some((kind, smart_json)) if kind == "smart" => {
                    if let Some(raw_json) = smart_json {
                        let rules: SmartRules = serde_json::from_str(&raw_json)?;
                        let (smart_sql, smart_params) =
                            build_smart_rules_clause(&rules, next_idx)?;
                        next_idx += smart_params.len();
                        params.extend(smart_params);
                        where_parts.push(smart_sql);
                    } else {
                        where_parts.push("1 = 0".to_string());
                    }
                }
                Some(_) => {
                    let p = push_val(
                        &mut next_idx,
                        &mut params,
                        Value::Text(collection_id.clone()),
                    );
                    where_parts.push(format!(
                        "EXISTS (SELECT 1 FROM collection_clips cc WHERE cc.collection_id = {p} AND cc.clip_id = c.id)"
                    ));
                }
                None => {
                    return Ok(ListClipsResult {
                        items: Vec::new(),
                        total: 0,
                        total_size_bytes: 0,
                    });
                }
            }
        }

        if let Some(tag_names) = &query.tag_names {
            for tag_name in tag_names {
                let trimmed = tag_name.trim();
                if !trimmed.is_empty() {
                    let p = push_val(
                        &mut next_idx,
                        &mut params,
                        Value::Text(trimmed.to_string()),
                    );
                    where_parts.push(format!(
                        "EXISTS (SELECT 1 FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = c.id AND LOWER(t.name) = LOWER({p}))"
                    ));
                }
            }
        }

        if let Some(search) = &query.search {
            if let Some(fts_query) = sanitize_fts_query(search) {
                let p = push_val(&mut next_idx, &mut params, Value::Text(fts_query));
                where_parts.push(format!(
                    "c.id IN (SELECT clip_id FROM clips_fts WHERE clips_fts MATCH {p})"
                ));
            }
        }

        if query.favorites_only.unwrap_or(false) {
            where_parts.push("c.is_favorite = 1".to_string());
        }

        if let Some(min_dur) = query.min_duration_sec {
            let p = push_val(&mut next_idx, &mut params, Value::Real(min_dur));
            where_parts.push(format!("c.duration_sec >= {p}"));
        }

        if let Some(max_dur) = query.max_duration_sec {
            let p = push_val(&mut next_idx, &mut params, Value::Real(max_dur));
            where_parts.push(format!("c.duration_sec <= {p}"));
        }

        let where_sql = where_parts.join(" AND ");

        let count_sql = format!(
            "SELECT COUNT(*), COALESCE(SUM(c.file_size_bytes), 0)
             FROM clips c
             LEFT JOIN games g ON g.id = c.game_id
             WHERE {where_sql}"
        );
        let (total, total_size_bytes): (i64, i64) =
            conn.query_row(&count_sql, params_from_iter(params.iter()), |r| {
                Ok((r.get(0)?, r.get(1)?))
            })?;

        let order_sql = match query.sort_by.unwrap_or(ClipSortBy::RecordedDesc) {
            ClipSortBy::RecordedDesc => "c.recorded_at DESC, c.file_name DESC",
            ClipSortBy::RecordedAsc => "c.recorded_at ASC, c.file_name ASC",
            ClipSortBy::SizeDesc => "c.file_size_bytes DESC, c.recorded_at DESC",
            ClipSortBy::DurationDesc => "c.duration_sec DESC, c.recorded_at DESC",
        };

        let limit = query.limit.unwrap_or(200).clamp(1, 2000);
        let offset = query.offset.unwrap_or(0).max(0);
        let limit_p = push_val(&mut next_idx, &mut params, Value::Integer(limit));
        let offset_p = push_val(&mut next_idx, &mut params, Value::Integer(offset));

        let select_sql = format!(
            "SELECT c.id, c.file_path, c.file_name, c.file_size_bytes, c.source_type,
                    c.game_id, COALESCE(g.display_name, 'Uncategorized') AS game_name,
                    c.recorded_at, c.duration_sec, c.width, c.height, c.fps,
                    c.video_codec, c.audio_track_count, c.is_favorite, c.is_pinned,
                    c.title, c.is_missing
             FROM clips c
             LEFT JOIN games g ON g.id = c.game_id
             WHERE {where_sql}
             ORDER BY {order_sql}
             LIMIT {limit_p} OFFSET {offset_p}"
        );

        let mut stmt = conn.prepare(&select_sql)?;
        let raw_clips = stmt
            .query_map(params_from_iter(params.iter()), |row| {
                map_clip_summary_row(row, streamer_base_url, token)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        drop(stmt);

        let items = enrich_clip_summaries(&conn, raw_clips)?;
        Ok(ListClipsResult {
            items,
            total,
            total_size_bytes,
        })
    }
}

pub(crate) fn sync_clip_fts_tx(conn: &Connection, clip_id: &str) -> AppResult<()> {
    conn.execute("DELETE FROM clips_fts WHERE clip_id = ?1", [clip_id])?;

    let row: Option<(String, String, String, String)> = conn
        .query_row(
            "SELECT COALESCE(c.title, ''), c.file_name, COALESCE(c.notes, ''),
                    COALESCE(g.display_name, '')
             FROM clips c
             LEFT JOIN games g ON g.id = c.game_id
             WHERE c.id = ?1",
            [clip_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;

    if let Some((title, file_name, notes, game_name)) = row {
        let mut stmt = conn.prepare(
            "SELECT t.name FROM clip_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.clip_id = ?1",
        )?;
        let tags = stmt
            .query_map([clip_id], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?
            .join(" ");

        conn.execute(
            "INSERT INTO clips_fts (clip_id, title, file_name, notes, game_name, tags_text)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![clip_id, title, file_name, notes, game_name, tags],
        )?;
    }

    Ok(())
}

/// Quote each searchable token with doubled-quote escaping so FTS5 operators and
/// special characters (`-`, `.`, `"`, `*`, `(`, `)`, `:`, `^`, `NOT`) never fail.
pub fn sanitize_fts_query(raw: &str) -> Option<String> {
    let tokens: Vec<String> = raw
        .split_whitespace()
        .filter_map(|part| {
            let cleaned: String = part.chars().filter(|ch| !ch.is_control()).collect();
            if !cleaned.chars().any(|ch| ch.is_alphanumeric() || ch == '_') {
                return None;
            }
            let escaped = cleaned.replace('"', "\"\"");
            Some(format!("\"{escaped}\"*"))
        })
        .collect();

    if tokens.is_empty() {
        None
    } else {
        Some(tokens.join(" AND "))
    }
}

#[cfg(test)]
mod tests {
    use chrono::{SecondsFormat, Utc};

    use super::*;
    use crate::db::repo::{ScannedAudioTrackInput, ScannedClipInsert};
    use crate::models::{
        CollectionKind, SmartField, SmartMatch, SmartOp, SmartRuleCondition, SourceType,
    };

    fn sample_clip(path: &str, name: &str, game_id: Option<String>, dur: f64) -> ScannedClipInsert {
        ScannedClipInsert {
            file_path: path.to_string(),
            file_name: name.to_string(),
            file_size_bytes: 5_000_000,
            file_mtime: 1_700_000_000,
            source_type: SourceType::Nvidia,
            game_id,
            recorded_at: Utc::now().to_rfc3339_opts(SecondsFormat::Secs, true),
            duration_sec: dur,
            width: 1920,
            height: 1080,
            fps: 60.0,
            video_codec: "h264".to_string(),
            audio_tracks: vec![ScannedAudioTrackInput {
                stream_index: 1,
                track_order: 0,
                label: "System sounds".to_string(),
                codec: "aac".to_string(),
                channels: 2,
                sample_rate: 48000,
                bitrate: Some(192000),
            }],
            thumb_path: None,
        }
    }

    #[test]
    fn migrations_start_with_empty_collections_and_support_manual_and_smart_rules() {
        let db = Db::open_in_memory().expect("open in-memory db");
        let initial_collections = db.list_collections().expect("list initial collections");
        assert!(
            initial_collections.is_empty(),
            "collections must start empty on fresh install"
        );

        let game_val = db.upsert_game("Valorant", "Valorant").expect("upsert game");
        let (clip1, _) = db
            .upsert_scanned_clip(sample_clip(
                r"C:\Clips\Valorant\ace.mp4",
                "ace.mp4",
                Some(game_val.clone()),
                28.5,
            ))
            .expect("insert clip1");
        let (clip2, _) = db
            .upsert_scanned_clip(sample_clip(
                r"C:\Clips\Valorant\long.mp4",
                "long.mp4",
                Some(game_val),
                90.0,
            ))
            .expect("insert clip2");

        db.update_clip_meta(
            &clip1,
            Some("Ascent 4K".to_string()),
            None,
            Some(true),
            None,
            Some(vec!["clutch".to_string()]),
            "http://127.0.0.1:9999",
            "tok",
        )
        .expect("update clip1 meta");

        let manual = db
            .create_collection("Saved Highlights", CollectionKind::Manual, None, None, None)
            .expect("create manual collection");
        let cnt = db
            .modify_collection_clips(&manual.id, Some(vec![clip1.clone(), clip2.clone()]), None)
            .expect("add clips");
        assert_eq!(cnt, 2);

        let smart = db
            .create_collection(
                "Short Valorant Clutches",
                CollectionKind::Smart,
                None,
                None,
                Some(SmartRules {
                    match_mode: SmartMatch::All,
                    conditions: vec![
                        SmartRuleCondition {
                            field: SmartField::Game,
                            op: SmartOp::Equals,
                            value: serde_json::json!("Valorant"),
                        },
                        SmartRuleCondition {
                            field: SmartField::Tag,
                            op: SmartOp::Includes,
                            value: serde_json::json!("clutch"),
                        },
                        SmartRuleCondition {
                            field: SmartField::DurationSec,
                            op: SmartOp::Lte,
                            value: serde_json::json!(45.0),
                        },
                        SmartRuleCondition {
                            field: SmartField::IsFavorite,
                            op: SmartOp::Equals,
                            value: serde_json::json!(true),
                        },
                    ],
                }),
            )
            .expect("create smart collection");
        assert_eq!(smart.clip_count, 1);

        let res = db
            .list_clips(
                &ListClipsQuery {
                    collection_id: Some(smart.id.clone()),
                    ..Default::default()
                },
                "http://127.0.0.1:9999",
                "tok",
            )
            .expect("list smart clips");
        assert_eq!(res.total, 1);
        assert_eq!(res.items[0].id, clip1);

        let fts_res = db
            .list_clips(
                &ListClipsQuery {
                    search: Some("Ascent".to_string()),
                    ..Default::default()
                },
                "http://127.0.0.1:9999",
                "tok",
            )
            .expect("fts search");
        assert_eq!(fts_res.total, 1);
        assert_eq!(fts_res.items[0].id, clip1);
    }

    #[test]
    fn fts5_search_sanitizes_dashes_dots_quotes_and_operators() {
        let db = Db::open_in_memory().expect("open in-memory db");
        let game_id = db.upsert_game("Counter-Strike 2", "Counter-Strike 2").expect("game");
        let (clip_id, _) = db
            .upsert_scanned_clip(sample_clip(
                r"C:\Clips\CS2\Valorant-2026.11.26_clip.mp4",
                "Valorant-2026.11.26_clip.mp4",
                Some(game_id),
                12.0,
            ))
            .expect("insert clip");
        db.update_clip_meta(
            &clip_id,
            Some(r#"NOT "clutch"(1):ace^2*win"#.to_string()),
            None,
            None,
            None,
            None,
            "",
            "",
        )
        .expect("set title");

        for q in [
            "Valorant-2026",
            "-2026",
            "2026.11",
            "clip.mp4",
            "NOT",
            "\"clutch\"(1):ace^2*win",
            "---",
            "...",
            "*():^\"",
        ] {
            let res = db
                .list_clips(
                    &ListClipsQuery {
                        search: Some(q.to_string()),
                        ..Default::default()
                    },
                    "",
                    "",
                )
                .unwrap_or_else(|e| panic!("query '{q}' must not error: {e}"));
            assert_eq!(res.total, 1, "query '{q}' expected 1 match");
        }
    }

    #[test]
    fn cleanup_protects_favorite_and_pinned_clips() {
        let db = Db::open_in_memory().expect("open in-memory db");
        let game_id = db.upsert_game("Desktop", "Desktop").expect("game");
        let (fav_id, _) = db
            .upsert_scanned_clip(sample_clip(r"C:\a.mp4", "a.mp4", Some(game_id.clone()), 10.0))
            .expect("c1");
        let (pin_id, _) = db
            .upsert_scanned_clip(sample_clip(r"C:\b.mp4", "b.mp4", Some(game_id.clone()), 10.0))
            .expect("c2");
        let (normal_id, _) = db
            .upsert_scanned_clip(sample_clip(r"C:\c.mp4", "c.mp4", Some(game_id), 10.0))
            .expect("c3");

        db.update_clip_meta(&fav_id, None, None, Some(true), None, None, "", "")
            .expect("fav");
        db.update_clip_meta(&pin_id, None, None, None, Some(true), None, "", "")
            .expect("pin");

        let eligible = db
            .list_cleanup_eligible_clips(&[fav_id.clone(), pin_id.clone(), normal_id.clone()])
            .expect("eligible");
        assert_eq!(eligible.len(), 1);
        assert_eq!(eligible[0].id, normal_id);
    }

    #[test]
    fn smart_rules_parameterize_untrusted_input_and_support_recent_days() {
        let db = Db::open_in_memory().expect("open in-memory db");
        let game_id = db.upsert_game("Overwatch 2", "Overwatch 2").expect("game");
        let _ = db
            .upsert_scanned_clip(sample_clip(
                r"C:\Clips\Overwatch 2\potg.mp4",
                "potg.mp4",
                Some(game_id),
                15.0,
            ))
            .expect("insert");

        let injection = db
            .create_collection(
                "Safe Parameter Check",
                CollectionKind::Smart,
                None,
                None,
                Some(SmartRules {
                    match_mode: SmartMatch::All,
                    conditions: vec![SmartRuleCondition {
                        field: SmartField::Game,
                        op: SmartOp::Equals,
                        value: serde_json::json!("' OR 1=1 --"),
                    }],
                }),
            )
            .expect("create smart");
        assert_eq!(injection.clip_count, 0);

        let recent = db
            .create_collection(
                "Recent Or Named",
                CollectionKind::Smart,
                None,
                None,
                Some(SmartRules {
                    match_mode: SmartMatch::Any,
                    conditions: vec![
                        SmartRuleCondition {
                            field: SmartField::RecordedWithinDays,
                            op: SmartOp::Lte,
                            value: serde_json::json!(7),
                        },
                        SmartRuleCondition {
                            field: SmartField::TitleOrFilename,
                            op: SmartOp::Contains,
                            value: serde_json::json!("missing"),
                        },
                    ],
                }),
            )
            .expect("create recent smart");
        assert_eq!(recent.clip_count, 1);
    }

    #[test]
    fn update_clip_meta_clears_title_on_empty_string_and_updates_fts() {
        let db = Db::open_in_memory().expect("open in-memory db");
        let game_id = db.upsert_game("Valorant", "Valorant").expect("game");
        let (clip_id, _) = db
            .upsert_scanned_clip(sample_clip(
                r"C:\Clips\Valorant\clutch.mp4",
                "clutch.mp4",
                Some(game_id),
                20.0,
            ))
            .expect("insert");

        let set_detail = db
            .update_clip_meta(
                &clip_id,
                Some("Ace".to_string()),
                None,
                None,
                None,
                None,
                "",
                "",
            )
            .expect("set title");
        assert_eq!(set_detail.clip.title.as_deref(), Some("Ace"));

        let fts_hit = db
            .list_clips(
                &ListClipsQuery {
                    search: Some("Ace".to_string()),
                    ..Default::default()
                },
                "",
                "",
            )
            .expect("fts search before clear");
        assert_eq!(fts_hit.total, 1);

        let cleared_detail = db
            .update_clip_meta(
                &clip_id,
                Some("".to_string()),
                None,
                None,
                None,
                None,
                "",
                "",
            )
            .expect("clear title");
        assert_eq!(cleared_detail.clip.title, None);

        let fts_after = db
            .list_clips(
                &ListClipsQuery {
                    search: Some("Ace".to_string()),
                    ..Default::default()
                },
                "",
                "",
            )
            .expect("fts search after clear");
        assert_eq!(fts_after.total, 0);
    }

    #[test]
    fn list_clips_filters_by_min_and_max_duration_and_updates_totals() {
        let db = Db::open_in_memory().expect("open in-memory db");
        let game_id = db.upsert_game("Valorant", "Valorant").expect("game");

        let mut short_clip = sample_clip(r"C:\a.mp4", "a.mp4", Some(game_id.clone()), 15.0);
        short_clip.file_size_bytes = 1_000_000;
        let (short_id, _) = db.upsert_scanned_clip(short_clip).expect("short");

        let mut mid_clip = sample_clip(r"C:\b.mp4", "b.mp4", Some(game_id.clone()), 45.0);
        mid_clip.file_size_bytes = 2_000_000;
        let (mid_id, _) = db.upsert_scanned_clip(mid_clip).expect("mid");

        let mut long_clip = sample_clip(r"C:\c.mp4", "c.mp4", Some(game_id), 150.0);
        long_clip.file_size_bytes = 4_000_000;
        let (long_id, _) = db.upsert_scanned_clip(long_clip).expect("long");

        let json_query: ListClipsQuery = serde_json::from_str(
            r#"{"minDurationSec": 30, "maxDurationSec": 120}"#,
        )
        .expect("deserialize camelCase minDurationSec");
        let mid_res = db.list_clips(&json_query, "", "").expect("mid query");
        assert_eq!(mid_res.total, 1);
        assert_eq!(mid_res.total_size_bytes, 2_000_000);
        assert_eq!(mid_res.items[0].id, mid_id);

        let over_res = db
            .list_clips(
                &ListClipsQuery {
                    min_duration_sec: Some(120.0),
                    ..Default::default()
                },
                "",
                "",
            )
            .expect("over 120s query");
        assert_eq!(over_res.total, 1);
        assert_eq!(over_res.total_size_bytes, 4_000_000);
        assert_eq!(over_res.items[0].id, long_id);

        let under_res = db
            .list_clips(
                &ListClipsQuery {
                    max_duration_sec: Some(30.0),
                    ..Default::default()
                },
                "",
                "",
            )
            .expect("under 30s query");
        assert_eq!(under_res.total, 1);
        assert_eq!(under_res.total_size_bytes, 1_000_000);
        assert_eq!(under_res.items[0].id, short_id);
    }

    #[test]
    fn batch_scan_helpers_preload_folder_states_and_mark_missing_in_tx() {
        let db = Db::open_in_memory().expect("open in-memory db");
        let game_id = db.upsert_game("Valorant", "Valorant").expect("game");
        let batch = vec![
            sample_clip(r"C:\Clips\Valorant\one.mp4", "one.mp4", Some(game_id.clone()), 10.0),
            sample_clip(r"C:\Clips\Valorant\two.mp4", "two.mp4", Some(game_id), 20.0),
        ];
        let inserted = db.upsert_scanned_clips_batch(&batch).expect("batch insert");
        assert_eq!(inserted.len(), 2);
        assert!(inserted.iter().all(|(_, is_new)| *is_new));

        let states = db
            .list_folder_clip_states(r"C:\Clips")
            .expect("list folder states");
        assert_eq!(states.len(), 2);
        assert!(states.contains_key(r"c:\clips\valorant\one.mp4"));

        let mut seen = std::collections::HashSet::new();
        seen.insert(r"c:\clips\valorant\one.mp4".to_string());
        let missing = db
            .mark_missing_clips_for_folder(r"C:\Clips", &seen)
            .expect("mark missing");
        assert_eq!(missing.len(), 1);
        assert_eq!(missing[0], inserted[1].0);
    }
}
