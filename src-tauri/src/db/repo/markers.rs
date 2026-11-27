use rusqlite::{params, OptionalExtension};
use uuid::Uuid;

use super::{now_iso, Db};
use crate::error::{AppError, AppResult};
use crate::models::ClipMarker;

const DEFAULT_MARKER_COLOR: &str = "#2563EB";
const MAX_MARKER_LABEL_CHARS: usize = 120;

fn normalize_marker_label(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(
            "Marker label cannot be empty".to_string(),
        ));
    }
    if trimmed.chars().count() > MAX_MARKER_LABEL_CHARS {
        return Err(AppError::InvalidInput(format!(
            "Marker label cannot exceed {MAX_MARKER_LABEL_CHARS} characters"
        )));
    }
    Ok(trimmed.to_string())
}

fn normalize_marker_color(raw: Option<&str>) -> AppResult<String> {
    let Some(value) = raw else {
        return Ok(DEFAULT_MARKER_COLOR.to_string());
    };
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Ok(DEFAULT_MARKER_COLOR.to_string());
    }
    let valid_hex = (trimmed.len() == 4 || trimmed.len() == 7 || trimmed.len() == 9)
        && trimmed.starts_with('#')
        && trimmed[1..].bytes().all(|b| b.is_ascii_hexdigit());
    if !valid_hex {
        return Err(AppError::InvalidInput(
            "Marker color must be a valid hex color such as #2563EB".to_string(),
        ));
    }
    Ok(trimmed.to_ascii_uppercase())
}

fn validate_marker_time(time_sec: f64, clip_duration_sec: f64) -> AppResult<f64> {
    if !time_sec.is_finite() || time_sec < 0.0 {
        return Err(AppError::InvalidInput(
            "Marker timestamp must be a non-negative finite number".to_string(),
        ));
    }
    if clip_duration_sec.is_finite() && clip_duration_sec > 0.0 {
        Ok(time_sec.min(clip_duration_sec))
    } else {
        Ok(time_sec)
    }
}

impl Db {
    pub fn list_clip_markers(&self, clip_id: &str) -> AppResult<Vec<ClipMarker>> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, clip_id, time_sec, label, color, created_at
             FROM clip_markers
             WHERE clip_id = ?1
             ORDER BY time_sec ASC, created_at ASC",
        )?;
        let rows = stmt.query_map([clip_id], |row| {
            Ok(ClipMarker {
                id: row.get(0)?,
                clip_id: row.get(1)?,
                time_sec: row.get(2)?,
                label: row.get(3)?,
                color: row.get(4)?,
                created_at: row.get(5)?,
            })
        })?;

        let mut items = Vec::new();
        for item in rows {
            items.push(item?);
        }
        Ok(items)
    }

    pub fn create_clip_marker(
        &self,
        clip_id: &str,
        time_sec: f64,
        label: &str,
        color: Option<&str>,
    ) -> AppResult<ClipMarker> {
        let clean_label = normalize_marker_label(label)?;
        let clean_color = normalize_marker_color(color)?;

        let conn = self.conn.lock().expect("db lock poisoned");
        let clip_duration: Option<f64> = conn
            .query_row(
                "SELECT duration_sec FROM clips WHERE id = ?1",
                [clip_id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(duration_sec) = clip_duration else {
            return Err(AppError::NotFound(format!("Clip '{clip_id}' not found")));
        };

        let clamped_time = validate_marker_time(time_sec, duration_sec)?;
        let id = Uuid::new_v4().to_string();
        let created_at = now_iso();

        conn.execute(
            "INSERT INTO clip_markers (id, clip_id, time_sec, label, color, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, clip_id, clamped_time, clean_label, clean_color, created_at],
        )?;

        Ok(ClipMarker {
            id,
            clip_id: clip_id.to_string(),
            time_sec: clamped_time,
            label: clean_label,
            color: clean_color,
            created_at,
        })
    }

    pub fn update_clip_marker(
        &self,
        id: &str,
        label: Option<&str>,
        color: Option<&str>,
        time_sec: Option<f64>,
    ) -> AppResult<ClipMarker> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let existing: Option<(ClipMarker, f64)> = conn
            .query_row(
                "SELECT m.id, m.clip_id, m.time_sec, m.label, m.color, m.created_at, c.duration_sec
                 FROM clip_markers m
                 JOIN clips c ON c.id = m.clip_id
                 WHERE m.id = ?1",
                [id],
                |row| {
                    Ok((
                        ClipMarker {
                            id: row.get(0)?,
                            clip_id: row.get(1)?,
                            time_sec: row.get(2)?,
                            label: row.get(3)?,
                            color: row.get(4)?,
                            created_at: row.get(5)?,
                        },
                        row.get(6)?,
                    ))
                },
            )
            .optional()?;

        let Some((mut marker, clip_duration)) = existing else {
            return Err(AppError::NotFound(format!("Marker '{id}' not found")));
        };

        if let Some(new_label) = label {
            marker.label = normalize_marker_label(new_label)?;
        }
        if let Some(new_color) = color {
            marker.color = normalize_marker_color(Some(new_color))?;
        }
        if let Some(new_time) = time_sec {
            marker.time_sec = validate_marker_time(new_time, clip_duration)?;
        }

        conn.execute(
            "UPDATE clip_markers
             SET time_sec = ?2, label = ?3, color = ?4
             WHERE id = ?1",
            params![marker.id, marker.time_sec, marker.label, marker.color],
        )?;

        Ok(marker)
    }

    pub fn delete_clip_marker(&self, id: &str) -> AppResult<bool> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let affected = conn.execute("DELETE FROM clip_markers WHERE id = ?1", [id])?;
        Ok(affected > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};

    use crate::db::schema::run_migrations;

    fn open_test_db() -> Db {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
        run_migrations(&conn).expect("run migrations");
        conn.execute(
            "INSERT INTO clips (
                id, file_path, file_name, file_size_bytes, file_mtime,
                source_type, recorded_at, duration_sec, width, height, fps, video_codec,
                indexed_at
            ) VALUES (
                'clip-1', 'C:\\Clips\\c1.mp4', 'c1.mp4', 1000, 1000,
                'custom', '2026-01-01T00:00:00Z', 15.0, 1920, 1080, 60.0, 'h264',
                '2026-01-01T00:00:00Z'
            )",
            [],
        )
        .expect("insert clip");
        Db {
            conn: Arc::new(Mutex::new(conn)),
        }
    }

    #[test]
    fn crud_clip_markers_orders_by_time_and_validates_inputs() {
        let db = open_test_db();

        assert!(db.create_clip_marker("clip-1", 1.0, "   ", None).is_err());
        assert!(db
            .create_clip_marker("clip-1", 1.0, "Goal", Some("blue"))
            .is_err());
        assert!(db
            .create_clip_marker("missing-clip", 1.0, "Goal", None)
            .is_err());

        let m2 = db
            .create_clip_marker("clip-1", 12.5, "End Clutch", Some("#ef4444"))
            .expect("create m2");
        let m1 = db
            .create_clip_marker("clip-1", 3.0, "Entry Kill", None)
            .expect("create m1");
        assert_eq!(m1.color, "#2563EB");
        assert_eq!(m2.color, "#EF4444");

        let listed = db.list_clip_markers("clip-1").expect("list markers");
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].id, m1.id);
        assert_eq!(listed[1].id, m2.id);

        let updated = db
            .update_clip_marker(&m2.id, Some("Final Kill"), Some("#10b981"), Some(99.0))
            .expect("update marker");
        assert_eq!(updated.label, "Final Kill");
        assert_eq!(updated.color, "#10B981");
        assert!((updated.time_sec - 15.0).abs() < f64::EPSILON);

        assert!(db.delete_clip_marker(&m1.id).expect("delete m1"));
        assert!(!db.delete_clip_marker("non-existent").expect("delete missing"));
        let remaining = db.list_clip_markers("clip-1").expect("list remaining");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].id, m2.id);
    }
}
