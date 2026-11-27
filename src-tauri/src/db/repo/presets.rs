use rusqlite::{params, OptionalExtension, Row};
use uuid::Uuid;

use super::{now_iso, Db};
use crate::error::{AppError, AppResult};
use crate::models::{CustomExportPreset, CustomPresetInput};

const MAX_PRESET_NAME_CHARS: usize = 80;

struct NormalizedPresetInput {
    name: String,
    container: String,
    target_size_mb: Option<f64>,
    video_bitrate_kbps: Option<i64>,
    resolution: String,
    fps: String,
    audio_normalize: bool,
    stretch_16_9: bool,
}

fn validate_custom_preset_input(input: &CustomPresetInput) -> AppResult<NormalizedPresetInput> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(AppError::InvalidInput(
            "Preset name cannot be empty".to_string(),
        ));
    }
    if name.chars().count() > MAX_PRESET_NAME_CHARS {
        return Err(AppError::InvalidInput(format!(
            "Preset name cannot exceed {MAX_PRESET_NAME_CHARS} characters"
        )));
    }

    let container = match input.container.trim().to_ascii_lowercase().as_str() {
        "mp4" => "mp4".to_string(),
        "mkv" => "mkv".to_string(),
        "webm" => "webm".to_string(),
        _ => {
            return Err(AppError::InvalidInput(
                "Preset container must be one of: mp4, mkv, webm".to_string(),
            ))
        }
    };

    let resolution = match input.resolution.trim().to_ascii_lowercase().as_str() {
        "source" => "source".to_string(),
        "1080p" => "1080p".to_string(),
        "720p" => "720p".to_string(),
        "vertical_blur_9_16" => "vertical_blur_9_16".to_string(),
        "vertical_crop_9_16" => "vertical_crop_9_16".to_string(),
        _ => {
            return Err(AppError::InvalidInput(
                "Preset resolution must be one of: source, 1080p, 720p, vertical_blur_9_16, vertical_crop_9_16".to_string(),
            ))
        }
    };

    let fps = match input.fps.trim().to_ascii_lowercase().as_str() {
        "source" => "source".to_string(),
        "60" => "60".to_string(),
        "30" => "30".to_string(),
        _ => {
            return Err(AppError::InvalidInput(
                "Preset fps must be one of: source, 60, 30".to_string(),
            ))
        }
    };

    let target_size_mb = match input.target_size_mb {
        Some(v) => {
            if !v.is_finite() || v <= 0.0 || v > 4096.0 {
                return Err(AppError::InvalidInput(
                    "Target size MB must be between 0 and 4096".to_string(),
                ));
            }
            Some(v)
        }
        None => None,
    };

    let video_bitrate_kbps = match input.video_bitrate_kbps {
        Some(v) => {
            if !(100..=200_000).contains(&v) {
                return Err(AppError::InvalidInput(
                    "Video bitrate kbps must be between 100 and 200000".to_string(),
                ));
            }
            Some(v)
        }
        None => None,
    };

    Ok(NormalizedPresetInput {
        name: name.to_string(),
        container,
        target_size_mb,
        video_bitrate_kbps,
        resolution,
        fps,
        audio_normalize: input.audio_normalize,
        stretch_16_9: input.stretch_16_9,
    })
}

fn map_preset_row(row: &Row<'_>) -> rusqlite::Result<CustomExportPreset> {
    Ok(CustomExportPreset {
        id: row.get(0)?,
        name: row.get(1)?,
        container: row.get(2)?,
        target_size_mb: row.get(3)?,
        video_bitrate_kbps: row.get(4)?,
        resolution: row.get(5)?,
        fps: row.get(6)?,
        audio_normalize: row.get::<_, i64>(7)? != 0,
        stretch_16_9: row.get::<_, i64>(8)? != 0,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

impl Db {
    pub fn list_custom_presets(&self) -> AppResult<Vec<CustomExportPreset>> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let mut stmt = conn.prepare(
            "SELECT id, name, container, target_size_mb, video_bitrate_kbps,
                    resolution, fps, audio_normalize, stretch_16_9, created_at, updated_at
             FROM custom_export_presets
             ORDER BY updated_at DESC, name ASC",
        )?;
        let rows = stmt.query_map([], map_preset_row)?;
        let mut items = Vec::new();
        for item in rows {
            items.push(item?);
        }
        Ok(items)
    }

    pub fn get_custom_preset(&self, id: &str) -> AppResult<Option<CustomExportPreset>> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let row = conn
            .query_row(
                "SELECT id, name, container, target_size_mb, video_bitrate_kbps,
                        resolution, fps, audio_normalize, stretch_16_9, created_at, updated_at
                 FROM custom_export_presets
                 WHERE id = ?1",
                [id],
                map_preset_row,
            )
            .optional()?;
        Ok(row)
    }

    pub fn create_custom_preset(&self, input: &CustomPresetInput) -> AppResult<CustomExportPreset> {
        let clean = validate_custom_preset_input(input)?;
        let id = Uuid::new_v4().to_string();
        let now = now_iso();

        let conn = self.conn.lock().expect("db lock poisoned");
        conn.execute(
            "INSERT INTO custom_export_presets (
                id, name, container, target_size_mb, video_bitrate_kbps,
                resolution, fps, audio_normalize, stretch_16_9, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
            params![
                id,
                clean.name,
                clean.container,
                clean.target_size_mb,
                clean.video_bitrate_kbps,
                clean.resolution,
                clean.fps,
                if clean.audio_normalize { 1 } else { 0 },
                if clean.stretch_16_9 { 1 } else { 0 },
                now,
                now
            ],
        )?;

        Ok(CustomExportPreset {
            id,
            name: clean.name,
            container: clean.container,
            target_size_mb: clean.target_size_mb,
            video_bitrate_kbps: clean.video_bitrate_kbps,
            resolution: clean.resolution,
            fps: clean.fps,
            audio_normalize: clean.audio_normalize,
            stretch_16_9: clean.stretch_16_9,
            created_at: now.clone(),
            updated_at: now,
        })
    }

    pub fn update_custom_preset(
        &self,
        id: &str,
        input: &CustomPresetInput,
    ) -> AppResult<CustomExportPreset> {
        let clean = validate_custom_preset_input(input)?;
        let conn = self.conn.lock().expect("db lock poisoned");
        let existing_created_at: Option<String> = conn
            .query_row(
                "SELECT created_at FROM custom_export_presets WHERE id = ?1",
                [id],
                |row| row.get(0),
            )
            .optional()?;
        let Some(created_at) = existing_created_at else {
            return Err(AppError::NotFound(format!(
                "Custom preset '{id}' not found"
            )));
        };

        let updated_at = now_iso();
        conn.execute(
            "UPDATE custom_export_presets
             SET name = ?2,
                 container = ?3,
                 target_size_mb = ?4,
                 video_bitrate_kbps = ?5,
                 resolution = ?6,
                 fps = ?7,
                 audio_normalize = ?8,
                 stretch_16_9 = ?9,
                 updated_at = ?10
             WHERE id = ?1",
            params![
                id,
                clean.name,
                clean.container,
                clean.target_size_mb,
                clean.video_bitrate_kbps,
                clean.resolution,
                clean.fps,
                if clean.audio_normalize { 1 } else { 0 },
                if clean.stretch_16_9 { 1 } else { 0 },
                updated_at
            ],
        )?;

        Ok(CustomExportPreset {
            id: id.to_string(),
            name: clean.name,
            container: clean.container,
            target_size_mb: clean.target_size_mb,
            video_bitrate_kbps: clean.video_bitrate_kbps,
            resolution: clean.resolution,
            fps: clean.fps,
            audio_normalize: clean.audio_normalize,
            stretch_16_9: clean.stretch_16_9,
            created_at,
            updated_at,
        })
    }

    pub fn delete_custom_preset(&self, id: &str) -> AppResult<bool> {
        let conn = self.conn.lock().expect("db lock poisoned");
        let affected = conn.execute("DELETE FROM custom_export_presets WHERE id = ?1", [id])?;
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
        Db {
            conn: Arc::new(Mutex::new(conn)),
        }
    }

    #[test]
    fn crud_custom_presets_validates_fields_and_roundtrips() {
        let db = open_test_db();

        let bad_container = CustomPresetInput {
            name: "Bad".to_string(),
            container: "avi".to_string(),
            target_size_mb: None,
            video_bitrate_kbps: None,
            resolution: "source".to_string(),
            fps: "source".to_string(),
            audio_normalize: false,
            stretch_16_9: false,
        };
        assert!(db.create_custom_preset(&bad_container).is_err());

        let input = CustomPresetInput {
            name: "Discord 50MB 60fps".to_string(),
            container: "MP4".to_string(),
            target_size_mb: Some(50.0),
            video_bitrate_kbps: None,
            resolution: "1080p".to_string(),
            fps: "60".to_string(),
            audio_normalize: true,
            stretch_16_9: true,
        };
        let created = db.create_custom_preset(&input).expect("create preset");
        assert_eq!(created.container, "mp4");
        assert_eq!(created.target_size_mb, Some(50.0));
        assert!(created.audio_normalize);
        assert!(created.stretch_16_9);

        let listed = db.list_custom_presets().expect("list presets");
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, created.id);

        let update_input = CustomPresetInput {
            name: "TikTok Vertical".to_string(),
            container: "mkv".to_string(),
            target_size_mb: None,
            video_bitrate_kbps: Some(8000),
            resolution: "vertical_blur_9_16".to_string(),
            fps: "30".to_string(),
            audio_normalize: false,
            stretch_16_9: true,
        };
        let updated = db
            .update_custom_preset(&created.id, &update_input)
            .expect("update preset");
        assert_eq!(updated.name, "TikTok Vertical");
        assert_eq!(updated.container, "mkv");
        assert_eq!(updated.video_bitrate_kbps, Some(8000));
        assert_eq!(updated.resolution, "vertical_blur_9_16");

        let fetched = db
            .get_custom_preset(&created.id)
            .expect("get preset")
            .expect("preset exists");
        assert_eq!(fetched.name, "TikTok Vertical");

        assert!(db.delete_custom_preset(&created.id).expect("delete preset"));
        assert!(!db.delete_custom_preset(&created.id).expect("delete twice"));
        assert!(db.list_custom_presets().expect("empty list").is_empty());
    }
}
