use rusqlite::{params, OptionalExtension};

use super::{now_iso, Db};
use crate::error::AppResult;
use crate::models::AppSettings;

impl Db {
    pub fn get_settings(&self, defaults: &AppSettings) -> AppResult<AppSettings> {
        let conn = self.lock()?;
        let row: Option<String> = conn
            .query_row(
                "SELECT value_json FROM app_settings WHERE key = 'app_settings'",
                [],
                |r| r.get(0),
            )
            .optional()?;

        match row {
            Some(json) => Ok(serde_json::from_str(&json)?),
            None => Ok(defaults.clone()),
        }
    }

    pub fn update_settings(&self, settings: &AppSettings) -> AppResult<AppSettings> {
        let conn = self.lock()?;
        let json = serde_json::to_string(settings)?;
        conn.execute(
            "INSERT INTO app_settings (key, value_json) VALUES ('app_settings', ?1)
             ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json",
            [json],
        )?;
        Ok(settings.clone())
    }

    pub fn insert_export_job(
        &self,
        job_id: &str,
        clip_id: &str,
        preset: &str,
        start_sec: f64,
        end_sec: f64,
        output_path: &str,
    ) -> AppResult<()> {
        let conn = self.lock()?;
        conn.execute(
            "INSERT INTO export_jobs (
                id, clip_id, preset, start_sec, end_sec, output_path, status, created_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'running', ?7)",
            params![
                job_id,
                clip_id,
                preset,
                start_sec,
                end_sec,
                output_path,
                now_iso()
            ],
        )?;
        Ok(())
    }

    pub fn update_export_job_done(
        &self,
        job_id: &str,
        output_size_bytes: i64,
        encoder_used: &str,
    ) -> AppResult<()> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE export_jobs
             SET status = 'done', output_size_bytes = ?1, encoder_used = ?2, finished_at = ?3
             WHERE id = ?4",
            params![output_size_bytes, encoder_used, now_iso(), job_id],
        )?;
        Ok(())
    }

    pub fn update_export_job_failed(&self, job_id: &str, error_message: &str) -> AppResult<()> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE export_jobs
             SET status = 'failed', error_message = ?1, finished_at = ?2
             WHERE id = ?3",
            params![error_message, now_iso(), job_id],
        )?;
        Ok(())
    }

    pub fn update_export_job_cancelled(&self, job_id: &str) -> AppResult<()> {
        let conn = self.lock()?;
        conn.execute(
            "UPDATE export_jobs
             SET status = 'cancelled', finished_at = ?1
             WHERE id = ?2",
            params![now_iso(), job_id],
        )?;
        Ok(())
    }
}
