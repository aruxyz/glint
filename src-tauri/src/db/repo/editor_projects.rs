use std::collections::{HashMap, HashSet};
use std::path::Path;

use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use uuid::Uuid;

use super::{
    enrich_clip_summaries, map_clip_summary_row, now_iso, numbered_placeholders, Db,
    SQLITE_CHUNK_SIZE,
};
use crate::error::{AppError, AppResult};
use crate::models::{
    ClipSummary, EditorAudioLayer, EditorProjectDetail, EditorProjectPayload,
    EditorProjectSegment, EditorProjectSummary, LoadEditorProjectResult, MissingProjectAudioLayer,
    MissingProjectSegment, SaveEditorProjectRequest,
};
use crate::paths::normalize_windows_path;

const MAX_PROJECT_NAME_CHARS: usize = 80;
const MIN_PROJECT_TRANSITION_SEC: f64 = 0.10;
const MAX_PROJECT_TRANSITION_SEC: f64 = 3.0;
const DEFAULT_LEGACY_CROSSFADE_SEC: f64 = 0.35;
const MIN_PROJECT_BODY_RESERVE_SEC: f64 = 0.20;

fn normalize_project_framing(raw: &str) -> String {
    match raw.trim().to_ascii_lowercase().as_str() {
        "fill" => "fill".to_string(),
        "stretch" => "stretch".to_string(),
        _ => "fit".to_string(),
    }
}

fn clamp_segment_bounds(raw_start: f64, raw_end: f64, max_dur: f64) -> (f64, f64) {
    let safe_max = if max_dur.is_finite() {
        max_dur.max(0.0)
    } else {
        0.0
    };
    let start = if raw_start.is_finite() {
        raw_start.clamp(0.0, safe_max)
    } else {
        0.0
    };
    let end = if raw_end.is_finite() {
        raw_end.clamp(0.0, safe_max)
    } else {
        safe_max
    };
    if end <= start {
        (0.0, safe_max)
    } else {
        (start, end)
    }
}

fn get_clip_summaries_by_ids_conn(
    conn: &Connection,
    clip_ids: &[String],
    streamer_base_url: &str,
    token: &str,
) -> AppResult<HashMap<String, ClipSummary>> {
    if clip_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let mut raw_clips = Vec::new();
    for chunk in clip_ids.chunks(SQLITE_CHUNK_SIZE) {
        let placeholders = numbered_placeholders(1, chunk.len());
        let sql = format!(
            "SELECT c.id, c.file_path, c.file_name, c.file_size_bytes, c.source_type,
                    c.game_id, COALESCE(g.display_name, 'Uncategorized') AS game_name,
                    c.recorded_at, c.duration_sec, c.width, c.height, c.fps,
                    c.video_codec, c.audio_track_count, c.is_favorite, c.is_pinned,
                    c.title, c.is_missing
             FROM clips c
             LEFT JOIN games g ON g.id = c.game_id
             WHERE c.id IN ({placeholders})"
        );
        let mut stmt = conn.prepare(&sql)?;
        let rows = stmt
            .query_map(params_from_iter(chunk.iter()), |row| {
                map_clip_summary_row(row, streamer_base_url, token)
            })?
            .collect::<Result<Vec<_>, _>>()?;
        raw_clips.extend(rows);
    }

    let enriched = enrich_clip_summaries(conn, raw_clips)?;
    let mut map = HashMap::with_capacity(enriched.len());
    for clip in enriched {
        map.insert(clip.id.clone(), clip);
    }
    Ok(map)
}

impl Db {
    pub fn get_clip_summary_by_id(
        &self,
        clip_id: &str,
        streamer_base_url: &str,
        token: &str,
    ) -> AppResult<Option<ClipSummary>> {
        let conn = self.lock()?;
        let mut map = get_clip_summaries_by_ids_conn(
            &conn,
            &[clip_id.to_string()],
            streamer_base_url,
            token,
        )?;
        Ok(map.remove(clip_id))
    }

    pub fn list_editor_projects(&self) -> AppResult<Vec<EditorProjectSummary>> {
        let conn = self.lock()?;
        let mut stmt = conn.prepare(
            "SELECT id, name, segment_count, total_duration_sec, created_at, updated_at
             FROM editor_projects
             ORDER BY updated_at DESC, created_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(EditorProjectSummary {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    segment_count: row.get(2)?,
                    total_duration_sec: row.get(3)?,
                    created_at: row.get(4)?,
                    updated_at: row.get(5)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(rows)
    }

    pub fn save_editor_project(
        &self,
        request: &SaveEditorProjectRequest,
    ) -> AppResult<EditorProjectSummary> {
        let trimmed_name = request.name.trim();
        if trimmed_name.is_empty() {
            return Err(AppError::InvalidInput(
                "Project name cannot be empty".to_string(),
            ));
        }
        if trimmed_name.chars().count() > MAX_PROJECT_NAME_CHARS {
            return Err(AppError::InvalidInput(format!(
                "Project name must be at most {MAX_PROJECT_NAME_CHARS} characters"
            )));
        }

        let data_json = serde_json::to_string(&request.data)?;
        let segment_count = request.segment_count.max(0);
        let total_duration_sec = if request.total_duration_sec.is_finite() {
            request.total_duration_sec.max(0.0)
        } else {
            0.0
        };
        let now = now_iso();
        let conn = self.lock()?;

        if let Some(existing_id) = request
            .id
            .as_deref()
            .map(str::trim)
            .filter(|id| !id.is_empty())
        {
            let affected = conn.execute(
                "UPDATE editor_projects
                 SET name = ?1, segment_count = ?2, total_duration_sec = ?3, data_json = ?4, updated_at = ?5
                 WHERE id = ?6",
                params![
                    trimmed_name,
                    segment_count,
                    total_duration_sec,
                    data_json,
                    now,
                    existing_id
                ],
            )?;
            if affected == 0 {
                return Err(AppError::NotFound(format!(
                    "Editor project '{existing_id}' not found"
                )));
            }
            let created_at: String = conn.query_row(
                "SELECT created_at FROM editor_projects WHERE id = ?1",
                [existing_id],
                |row| row.get(0),
            )?;
            return Ok(EditorProjectSummary {
                id: existing_id.to_string(),
                name: trimmed_name.to_string(),
                segment_count,
                total_duration_sec,
                created_at,
                updated_at: now,
            });
        }

        let id = Uuid::new_v4().to_string();
        conn.execute(
            "INSERT INTO editor_projects (id, name, segment_count, total_duration_sec, data_json, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                trimmed_name,
                segment_count,
                total_duration_sec,
                data_json,
                now,
                now
            ],
        )?;

        Ok(EditorProjectSummary {
            id,
            name: trimmed_name.to_string(),
            segment_count,
            total_duration_sec,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn load_editor_project(
        &self,
        project_id: &str,
        streamer_base_url: &str,
        token: &str,
    ) -> AppResult<LoadEditorProjectResult> {
        let conn = self.lock()?;
        let row: Option<(String, String, String, String, String)> = conn
            .query_row(
                "SELECT id, name, data_json, created_at, updated_at
                 FROM editor_projects
                 WHERE id = ?1",
                [project_id],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
            )
            .optional()?;

        let (id, name, data_json, created_at, updated_at) = row.ok_or_else(|| {
            AppError::NotFound(format!("Editor project '{project_id}' not found"))
        })?;

        let payload: EditorProjectPayload = serde_json::from_str(&data_json)?;
        let unique_clip_ids: Vec<String> = payload
            .segments
            .iter()
            .map(|s| s.clip_id.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();

        let clip_map =
            get_clip_summaries_by_ids_conn(&conn, &unique_clip_ids, streamer_base_url, token)?;

        let mut rehydrated_segments = Vec::with_capacity(payload.segments.len());
        let mut missing_segments = Vec::new();

        for (segment_index, seg) in payload.segments.into_iter().enumerate() {
            match clip_map.get(&seg.clip_id) {
                None => {
                    let snapshot = seg.clip_snapshot.as_ref();
                    let file_name = snapshot
                        .map(|s| s.file_name.clone())
                        .filter(|f| !f.trim().is_empty())
                        .unwrap_or_else(|| seg.clip_id.clone());
                    let title = snapshot
                        .and_then(|s| s.title.as_deref())
                        .filter(|t| !t.trim().is_empty())
                        .map(str::to_string)
                        .unwrap_or_else(|| file_name.clone());
                    missing_segments.push(MissingProjectSegment {
                        segment_index,
                        clip_id: seg.clip_id,
                        title,
                        file_name,
                        reason: "deleted".to_string(),
                    });
                }
                Some(clip) if clip.is_missing => {
                    let title = clip
                        .title
                        .as_deref()
                        .filter(|t| !t.trim().is_empty())
                        .map(str::to_string)
                        .unwrap_or_else(|| clip.file_name.clone());
                    missing_segments.push(MissingProjectSegment {
                        segment_index,
                        clip_id: seg.clip_id,
                        title,
                        file_name: clip.file_name.clone(),
                        reason: "file_missing".to_string(),
                    });
                }
                Some(clip) => {
                    let (start_sec, end_sec) =
                        clamp_segment_bounds(seg.start_sec, seg.end_sec, clip.duration_sec);
                    let speed = if seg.speed.is_finite() {
                        seg.speed.clamp(0.25, 4.0)
                    } else {
                        1.0
                    };
                    let effective_dur = ((end_sec - start_sec) / speed).max(0.0);
                    let (transition_in, transition_in_duration_sec) =
                        if rehydrated_segments.is_empty() {
                            if seg.transition_in == "fade" {
                                let raw = seg.transition_in_duration_sec.unwrap_or(0.0);
                                let max_fade = (effective_dur - MIN_PROJECT_BODY_RESERVE_SEC)
                                    .clamp(0.0, MAX_PROJECT_TRANSITION_SEC);
                                if raw.is_finite()
                                    && raw >= MIN_PROJECT_TRANSITION_SEC
                                    && max_fade >= MIN_PROJECT_TRANSITION_SEC
                                {
                                    ("fade".to_string(), raw.min(max_fade))
                                } else {
                                    ("cut".to_string(), 0.0)
                                }
                            } else {
                                ("cut".to_string(), 0.0)
                            }
                        } else if seg.transition_in == "crossfade" {
                            let raw = seg
                                .transition_in_duration_sec
                                .unwrap_or(DEFAULT_LEGACY_CROSSFADE_SEC);
                            let prev: &EditorProjectSegment =
                                rehydrated_segments.last().expect("prev segment exists");
                            let prev_eff = ((prev.end_sec - prev.start_sec) / prev.speed).max(0.0);
                            let prev_in_reserve = if prev.transition_in != "cut" {
                                prev.transition_in_duration_sec
                            } else {
                                0.0
                            };
                            let prev_avail = (prev_eff - prev_in_reserve - MIN_PROJECT_BODY_RESERVE_SEC)
                                .max(0.0);
                            let curr_avail =
                                (effective_dur - MIN_PROJECT_BODY_RESERVE_SEC).max(0.0);
                            let max_cf = prev_avail
                                .min(curr_avail)
                                .min(MAX_PROJECT_TRANSITION_SEC);
                            if raw.is_finite()
                                && raw >= MIN_PROJECT_TRANSITION_SEC
                                && max_cf >= MIN_PROJECT_TRANSITION_SEC
                            {
                                ("crossfade".to_string(), raw.min(max_cf))
                            } else {
                                ("cut".to_string(), 0.0)
                            }
                        } else {
                            ("cut".to_string(), 0.0)
                        };
                    let master_volume = if seg.master_volume.is_finite() {
                        seg.master_volume.clamp(0.0, 100.0)
                    } else {
                        100.0
                    };
                    let vibrance = if seg.vibrance.is_finite() {
                        seg.vibrance.clamp(-100.0, 100.0)
                    } else {
                        0.0
                    };
                    let saturation = if seg.saturation.is_finite() {
                        seg.saturation.clamp(0.0, 200.0)
                    } else {
                        100.0
                    };

                    rehydrated_segments.push(EditorProjectSegment {
                        id: seg.id,
                        clip_id: seg.clip_id,
                        clip: clip.clone(),
                        start_sec,
                        end_sec,
                        speed,
                        audio_mix: seg.audio_mix,
                        master_volume,
                        master_muted: seg.master_muted,
                        transition_in,
                        transition_in_duration_sec,
                        transition_out: seg.transition_out,
                        transition_out_duration_sec: seg.transition_out_duration_sec,
                        vibrance,
                        saturation,
                        framing: normalize_project_framing(&seg.framing),
                    });
                }
            }
        }

        let seg_len = rehydrated_segments.len();
        for (idx, seg) in rehydrated_segments.iter_mut().enumerate() {
            let is_last = idx + 1 == seg_len;
            if is_last && seg.transition_out == "fade" {
                let effective_dur = ((seg.end_sec - seg.start_sec) / seg.speed).max(0.0);
                let in_reserve = if seg.transition_in != "cut" {
                    seg.transition_in_duration_sec
                } else {
                    0.0
                };
                let max_fade = (effective_dur - in_reserve - MIN_PROJECT_BODY_RESERVE_SEC)
                    .clamp(0.0, MAX_PROJECT_TRANSITION_SEC);
                if seg.transition_out_duration_sec.is_finite()
                    && seg.transition_out_duration_sec >= MIN_PROJECT_TRANSITION_SEC
                    && max_fade >= MIN_PROJECT_TRANSITION_SEC
                {
                    seg.transition_out_duration_sec = seg.transition_out_duration_sec.min(max_fade);
                } else {
                    seg.transition_out = "cut".to_string();
                    seg.transition_out_duration_sec = 0.0;
                }
            } else {
                seg.transition_out = "cut".to_string();
                seg.transition_out_duration_sec = 0.0;
            }
        }

        let mut rehydrated_audio_layers = Vec::with_capacity(payload.audio_layers.len());
        let mut missing_audio_layers = Vec::new();

        for layer in payload.audio_layers {
            let duration_sec = if layer.duration_sec.is_finite() {
                layer.duration_sec.max(0.25)
            } else {
                0.25
            };
            let timeline_offset_sec = if layer.timeline_offset_sec.is_finite() {
                layer.timeline_offset_sec.max(0.0)
            } else {
                0.0
            };
            let (trim_start_sec, trim_end_sec) =
                clamp_segment_bounds(layer.trim_start_sec, layer.trim_end_sec, duration_sec);
            let trim_end_sec = trim_end_sec
                .max((trim_start_sec + 0.25).min(duration_sec))
                .min(duration_sec);
            let volume = if layer.volume.is_finite() {
                layer.volume.clamp(0.0, 200.0)
            } else {
                100.0
            };
            let is_missing = !normalize_windows_path(Path::new(&layer.file_path)).exists();
            if is_missing {
                missing_audio_layers.push(MissingProjectAudioLayer {
                    layer_id: layer.id.clone(),
                    title: layer.title.clone(),
                    file_path: layer.file_path.clone(),
                    reason: "file_missing".to_string(),
                });
            }

            rehydrated_audio_layers.push(EditorAudioLayer {
                id: layer.id,
                file_path: layer.file_path,
                title: layer.title,
                duration_sec,
                timeline_offset_sec,
                trim_start_sec,
                trim_end_sec,
                volume,
                muted: layer.muted,
                is_missing,
            });
        }

        Ok(LoadEditorProjectResult {
            project: EditorProjectDetail {
                id,
                name,
                created_at,
                updated_at,
                segments: rehydrated_segments,
                audio_layers: rehydrated_audio_layers,
                export_options: payload.export_options,
            },
            missing_segments,
            missing_audio_layers,
        })
    }

    pub fn delete_editor_project(&self, project_id: &str) -> AppResult<()> {
        let conn = self.lock()?;
        conn.execute("DELETE FROM editor_projects WHERE id = ?1", [project_id])?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::ScannedClipInsert;
    use crate::models::{
        EditorAudioLayerData, EditorClipSnapshot, EditorExportOptions, EditorProjectSegmentData,
        SourceType,
    };

    fn sample_export_options() -> EditorExportOptions {
        EditorExportOptions {
            preset: "discord_10mb".to_string(),
            vertical916: true,
            vertical_style: "blur".to_string(),
            normalize_audio: true,
            copy_to_clipboard: true,
            add_to_library: false,
            output_name: "Valorant Highlight".to_string(),
        }
    }

    fn insert_test_clip(db: &Db, file_name: &str, duration_sec: f64) -> String {
        let (clip_id, _) = db
            .upsert_scanned_clip(ScannedClipInsert {
                file_path: format!(r"C:\Videos\Valorant\{file_name}"),
                file_name: file_name.to_string(),
                file_size_bytes: 2_048_000,
                file_mtime: 1_760_000_000,
                source_type: SourceType::Nvidia,
                game_id: None,
                recorded_at: "2026-11-26T01:00:00Z".to_string(),
                duration_sec,
                width: 1920,
                height: 1080,
                fps: 60.0,
                video_codec: "h264".to_string(),
                audio_tracks: Vec::new(),
                thumb_path: None,
            })
            .expect("insert test clip");
        clip_id
    }

    #[test]
    fn crud_editor_projects_validates_name_and_updates_existing_rows() {
        let db = Db::open_in_memory().expect("open in-memory db");

        let empty_req = SaveEditorProjectRequest {
            id: None,
            name: "   ".to_string(),
            segment_count: 0,
            total_duration_sec: 0.0,
            data: EditorProjectPayload {
                version: 1,
                segments: Vec::new(),
                audio_layers: Vec::new(),
                export_options: sample_export_options(),
            },
        };
        assert!(matches!(
            db.save_editor_project(&empty_req),
            Err(AppError::InvalidInput(_))
        ));

        let long_req = SaveEditorProjectRequest {
            name: "x".repeat(81),
            ..empty_req.clone()
        };
        assert!(matches!(
            db.save_editor_project(&long_req),
            Err(AppError::InvalidInput(_))
        ));

        let create_req = SaveEditorProjectRequest {
            id: None,
            name: "  Valorant Ranked Highlights  ".to_string(),
            segment_count: 2,
            total_duration_sec: 14.5,
            data: EditorProjectPayload {
                version: 1,
                segments: Vec::new(),
                audio_layers: Vec::new(),
                export_options: sample_export_options(),
            },
        };
        let created = db
            .save_editor_project(&create_req)
            .expect("create project");
        assert_eq!(created.name, "Valorant Ranked Highlights");
        assert_eq!(created.segment_count, 2);

        let listed = db.list_editor_projects().expect("list projects");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);

        let update_req = SaveEditorProjectRequest {
            id: Some(created.id.clone()),
            name: "Valorant Ranked v2".to_string(),
            segment_count: 3,
            total_duration_sec: 22.0,
            data: create_req.data.clone(),
        };
        let updated = db
            .save_editor_project(&update_req)
            .expect("update project");
        assert_eq!(updated.id, created.id);
        assert_eq!(updated.name, "Valorant Ranked v2");
        assert_eq!(updated.segment_count, 3);
        assert_eq!(updated.created_at, created.created_at);

        let missing_update = SaveEditorProjectRequest {
            id: Some("nonexistent-project-id".to_string()),
            ..update_req
        };
        assert!(matches!(
            db.save_editor_project(&missing_update),
            Err(AppError::NotFound(_))
        ));

        db.delete_editor_project(&created.id)
            .expect("delete project");
        assert!(db.list_editor_projects().expect("list after delete").is_empty());
    }

    #[test]
    fn load_editor_project_rehydrates_valid_clips_and_reports_deleted_and_missing_files() {
        let db = Db::open_in_memory().expect("open in-memory db");
        let valid_clip_id = insert_test_clip(&db, "clutch_ace.mp4", 12.0);
        let missing_file_clip_id = insert_test_clip(&db, "moved_clip.mp4", 8.0);
        db.mark_clip_missing_by_path(r"C:\Videos\Valorant\moved_clip.mp4")
            .expect("mark clip missing");

        db.update_clip_meta(
            &valid_clip_id,
            Some("Clutch Ace".to_string()),
            None,
            Some(true),
            None,
            Some(vec!["ace".to_string()]),
            "http://127.0.0.1:43210",
            "tok",
        )
        .expect("enrich clip meta");

        let save_req = SaveEditorProjectRequest {
            id: None,
            name: "Mixed Recovery Test".to_string(),
            segment_count: 3,
            total_duration_sec: 25.0,
            data: EditorProjectPayload {
                version: 1,
                segments: vec![
                    EditorProjectSegmentData {
                        id: "seg-deleted".to_string(),
                        clip_id: "deleted-clip-id".to_string(),
                        start_sec: 0.0,
                        end_sec: 5.0,
                        speed: 1.0,
                        audio_mix: Vec::new(),
                        master_volume: 100.0,
                        master_muted: false,
                        transition_in: "cut".to_string(),
                        transition_in_duration_sec: None,
                        transition_out: "cut".to_string(),
                        transition_out_duration_sec: 0.0,
                        vibrance: 0.0,
                        saturation: 100.0,
                        framing: "fit".to_string(),
                        clip_snapshot: Some(EditorClipSnapshot {
                            title: Some("Old Deleted Clip".to_string()),
                            file_name: "old_deleted.mp4".to_string(),
                            duration_sec: 5.0,
                            game_name: "Valorant".to_string(),
                        }),
                    },
                    EditorProjectSegmentData {
                        id: "seg-valid".to_string(),
                        clip_id: valid_clip_id.clone(),
                        start_sec: 2.0,
                        end_sec: 99.0, // exceeds clip.duration_sec (12.0), must clamp
                        speed: 1.5,
                        audio_mix: Vec::new(),
                        master_volume: 90.0,
                        master_muted: false,
                        transition_in: "crossfade".to_string(), // must normalize to "cut" as first valid segment
                        transition_in_duration_sec: None,
                        transition_out: "fade".to_string(),
                        transition_out_duration_sec: 1.25,
                        vibrance: 25.0,
                        saturation: 110.0,
                        framing: "stretch".to_string(),
                        clip_snapshot: None,
                    },
                    EditorProjectSegmentData {
                        id: "seg-missing-file".to_string(),
                        clip_id: missing_file_clip_id.clone(),
                        start_sec: 0.0,
                        end_sec: 4.0,
                        speed: 1.0,
                        audio_mix: Vec::new(),
                        master_volume: 100.0,
                        master_muted: false,
                        transition_in: "cut".to_string(),
                        transition_in_duration_sec: None,
                        transition_out: "cut".to_string(),
                        transition_out_duration_sec: 0.0,
                        vibrance: 0.0,
                        saturation: 100.0,
                        framing: "fit".to_string(),
                        clip_snapshot: None,
                    },
                ],
                audio_layers: Vec::new(),
                export_options: sample_export_options(),
            },
        };

        let saved = db.save_editor_project(&save_req).expect("save project");
        let loaded = db
            .load_editor_project(&saved.id, "http://127.0.0.1:43210", "tok")
            .expect("load project");

        assert_eq!(loaded.project.id, saved.id);
        assert_eq!(loaded.project.name, "Mixed Recovery Test");
        assert_eq!(loaded.project.export_options.preset, "discord_10mb");
        assert!(loaded.project.export_options.vertical916);

        assert_eq!(loaded.project.segments.len(), 1);
        let seg = &loaded.project.segments[0];
        assert_eq!(seg.id, "seg-valid");
        assert_eq!(seg.clip.id, valid_clip_id);
        assert_eq!(seg.clip.title.as_deref(), Some("Clutch Ace"));
        assert_eq!(seg.clip.tags, vec!["ace".to_string()]);
        assert_eq!(
            seg.clip.thumb_url,
            format!("http://127.0.0.1:43210/thumb/{valid_clip_id}?token=tok")
        );
        assert!((seg.start_sec - 2.0).abs() < f64::EPSILON);
        assert!((seg.end_sec - 12.0).abs() < f64::EPSILON);
        assert_eq!(seg.transition_in, "cut");
        assert!((seg.transition_in_duration_sec - 0.0).abs() < f64::EPSILON);
        assert_eq!(seg.transition_out, "fade");
        assert!((seg.transition_out_duration_sec - 1.25).abs() < f64::EPSILON);
        assert_eq!(seg.framing, "stretch");

        assert_eq!(loaded.missing_segments.len(), 2);
        assert_eq!(loaded.missing_segments[0].segment_index, 0);
        assert_eq!(loaded.missing_segments[0].reason, "deleted");
        assert_eq!(loaded.missing_segments[0].title, "Old Deleted Clip");
        assert_eq!(loaded.missing_segments[0].file_name, "old_deleted.mp4");

        assert_eq!(loaded.missing_segments[1].segment_index, 2);
        assert_eq!(loaded.missing_segments[1].reason, "file_missing");
        assert_eq!(loaded.missing_segments[1].clip_id, missing_file_clip_id);
        assert_eq!(loaded.missing_segments[1].file_name, "moved_clip.mp4");
        assert!(loaded.project.audio_layers.is_empty());
        assert!(loaded.missing_audio_layers.is_empty());
    }

    #[test]
    fn load_editor_project_supports_v1_without_audio_layers_and_v2_audio_layers() {
        let db = Db::open_in_memory().expect("open in-memory db");
        let existing_audio = std::env::temp_dir().join(format!(
            "glint_proj_audio_{}.mp3",
            Uuid::new_v4()
        ));
        std::fs::write(&existing_audio, b"ID3dummy").expect("write dummy audio");

        // 1. Simulate legacy v1 row in SQLite without audioLayers field
        let v1_json = serde_json::json!({
            "version": 1,
            "segments": [],
            "exportOptions": {
                "preset": "original",
                "vertical916": false,
                "verticalStyle": "none"
            }
        })
        .to_string();
        {
            let conn = db.lock().expect("lock db");
            conn.execute(
                "INSERT INTO editor_projects (id, name, segment_count, total_duration_sec, data_json, created_at, updated_at)
                 VALUES (?1, ?2, 0, 0.0, ?3, '2026-11-26T00:00:00Z', '2026-11-26T00:00:00Z')",
                params!["legacy-v1-id", "Legacy V1", v1_json],
            )
            .expect("insert v1 project");
        }

        let loaded_v1 = db
            .load_editor_project("legacy-v1-id", "http://127.0.0.1:43210", "tok")
            .expect("load legacy v1 project");
        assert!(loaded_v1.project.audio_layers.is_empty());
        assert!(loaded_v1.missing_audio_layers.is_empty());

        // 2. Save v2 project with one valid audio layer (with out-of-range volume/offset) and one missing file
        let save_v2 = SaveEditorProjectRequest {
            id: None,
            name: "V2 Music Project".to_string(),
            segment_count: 0,
            total_duration_sec: 12.0,
            data: EditorProjectPayload {
                version: 2,
                segments: Vec::new(),
                audio_layers: vec![
                    EditorAudioLayerData {
                        id: "aud-1".to_string(),
                        file_path: existing_audio.to_string_lossy().to_string(),
                        title: "BGM Track".to_string(),
                        duration_sec: 30.0,
                        timeline_offset_sec: -2.0,
                        trim_start_sec: 1.0,
                        trim_end_sec: 45.0,
                        volume: 250.0,
                        muted: false,
                    },
                    EditorAudioLayerData {
                        id: "aud-missing".to_string(),
                        file_path: r"C:\NonExistent\missing_song.mp3".to_string(),
                        title: "Missing Song".to_string(),
                        duration_sec: 15.0,
                        timeline_offset_sec: 2.0,
                        trim_start_sec: 0.0,
                        trim_end_sec: 10.0,
                        volume: 80.0,
                        muted: true,
                    },
                ],
                export_options: sample_export_options(),
            },
        };
        let saved_v2 = db.save_editor_project(&save_v2).expect("save v2");
        let loaded_v2 = db
            .load_editor_project(&saved_v2.id, "http://127.0.0.1:43210", "tok")
            .expect("load v2");

        assert_eq!(loaded_v2.project.audio_layers.len(), 2);
        let a1 = &loaded_v2.project.audio_layers[0];
        assert!(!a1.is_missing);
        assert!((a1.timeline_offset_sec - 0.0).abs() < f64::EPSILON);
        assert!((a1.trim_start_sec - 1.0).abs() < f64::EPSILON);
        assert!((a1.trim_end_sec - 30.0).abs() < f64::EPSILON);
        assert!((a1.volume - 200.0).abs() < f64::EPSILON);

        let a2 = &loaded_v2.project.audio_layers[1];
        assert!(a2.is_missing);
        assert!(a2.muted);

        assert_eq!(loaded_v2.missing_audio_layers.len(), 1);
        assert_eq!(loaded_v2.missing_audio_layers[0].layer_id, "aud-missing");
        assert_eq!(loaded_v2.missing_audio_layers[0].reason, "file_missing");

        let _ = std::fs::remove_file(existing_audio);
    }

    #[test]
    fn load_editor_project_normalizes_legacy_crossfade_and_clamps_dynamic_transitions() {
        let db = Db::open_in_memory().expect("open in-memory db");
        let clip_a = insert_test_clip(&db, "clip_a.mp4", 3.0);
        let clip_b = insert_test_clip(&db, "clip_b.mp4", 3.0);

        let legacy_json = serde_json::json!({
            "version": 1,
            "segments": [
                {
                    "id": "s1",
                    "clipId": clip_a,
                    "startSec": 0.0,
                    "endSec": 3.0,
                    "speed": 1.0,
                    "masterVolume": 100.0,
                    "transitionIn": "cut"
                },
                {
                    "id": "s2",
                    "clipId": clip_b,
                    "startSec": 0.0,
                    "endSec": 3.0,
                    "speed": 1.0,
                    "masterVolume": 100.0,
                    "transitionIn": "crossfade"
                }
            ],
            "exportOptions": {
                "preset": "original",
                "vertical916": false,
                "verticalStyle": "none"
            }
        })
        .to_string();

        {
            let conn = db.lock().expect("lock db");
            conn.execute(
                "INSERT INTO editor_projects (id, name, segment_count, total_duration_sec, data_json, created_at, updated_at)
                 VALUES (?1, ?2, 2, 5.65, ?3, '2026-11-26T00:00:00Z', '2026-11-26T00:00:00Z')",
                params!["legacy-cf-id", "Legacy CF", legacy_json],
            )
            .expect("insert legacy cf project");
        }

        let loaded_legacy = db
            .load_editor_project("legacy-cf-id", "http://127.0.0.1:43210", "tok")
            .expect("load legacy cf");
        assert_eq!(loaded_legacy.project.segments[1].transition_in, "crossfade");
        assert!(
            (loaded_legacy.project.segments[1].transition_in_duration_sec - 0.35).abs()
                < f64::EPSILON
        );

        let save_dyn = SaveEditorProjectRequest {
            id: None,
            name: "Dynamic Transitions".to_string(),
            segment_count: 2,
            total_duration_sec: 4.5,
            data: EditorProjectPayload {
                version: 2,
                segments: vec![
                    EditorProjectSegmentData {
                        id: "d1".to_string(),
                        clip_id: clip_a,
                        start_sec: 0.0,
                        end_sec: 3.0,
                        speed: 1.0,
                        audio_mix: Vec::new(),
                        master_volume: 100.0,
                        master_muted: false,
                        transition_in: "fade".to_string(),
                        transition_in_duration_sec: Some(1.0),
                        transition_out: "fade".to_string(), // non-last segment must normalize to "cut"
                        transition_out_duration_sec: 0.5,
                        vibrance: 0.0,
                        saturation: 100.0,
                        framing: "fit".to_string(),
                        clip_snapshot: None,
                    },
                    EditorProjectSegmentData {
                        id: "d2".to_string(),
                        clip_id: clip_b,
                        start_sec: 0.0,
                        end_sec: 3.0,
                        speed: 1.0,
                        audio_mix: Vec::new(),
                        master_volume: 100.0,
                        master_muted: false,
                        transition_in: "crossfade".to_string(),
                        // max crossfade = 3.0 - 1.0 (d1 fadeIn) - 0.20 = 1.80
                        transition_in_duration_sec: Some(2.5),
                        transition_out: "fade".to_string(),
                        // max fadeOut = 3.0 - 1.80 - 0.20 = 1.00
                        transition_out_duration_sec: 2.0,
                        vibrance: 0.0,
                        saturation: 100.0,
                        framing: "fit".to_string(),
                        clip_snapshot: None,
                    },
                ],
                audio_layers: Vec::new(),
                export_options: sample_export_options(),
            },
        };

        let saved_dyn = db.save_editor_project(&save_dyn).expect("save dyn");
        let loaded_dyn = db
            .load_editor_project(&saved_dyn.id, "http://127.0.0.1:43210", "tok")
            .expect("load dyn");
        let s0 = &loaded_dyn.project.segments[0];
        let s1 = &loaded_dyn.project.segments[1];
        assert_eq!(s0.transition_in, "fade");
        assert!((s0.transition_in_duration_sec - 1.0).abs() < f64::EPSILON);
        assert_eq!(s0.transition_out, "cut");
        assert!((s0.transition_out_duration_sec - 0.0).abs() < f64::EPSILON);

        assert_eq!(s1.transition_in, "crossfade");
        assert!((s1.transition_in_duration_sec - 1.80).abs() < 1e-6);
        assert_eq!(s1.transition_out, "fade");
        assert!((s1.transition_out_duration_sec - 1.00).abs() < 1e-6);
    }
}
