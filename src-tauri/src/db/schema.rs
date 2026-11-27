use chrono::Utc;
use rusqlite::Connection;

use crate::error::AppResult;

const MIGRATION_V1: &str = r#"
CREATE TABLE IF NOT EXISTS watch_folders (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL CHECK (source_type IN ('nvidia', 'obs', 'steam', 'custom')),
    enabled INTEGER NOT NULL DEFAULT 1,
    last_scanned_at TEXT
);

CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    raw_name TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    alias_group_id TEXT,
    cover_color TEXT
);

CREATE TABLE IF NOT EXISTS clips (
    id TEXT PRIMARY KEY,
    file_path TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    file_size_bytes INTEGER NOT NULL,
    file_mtime INTEGER NOT NULL,
    source_type TEXT NOT NULL,
    game_id TEXT REFERENCES games(id) ON DELETE SET NULL,
    recorded_at TEXT NOT NULL,
    duration_sec REAL NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    fps REAL NOT NULL,
    video_codec TEXT NOT NULL,
    audio_track_count INTEGER NOT NULL DEFAULT 1,
    is_favorite INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    title TEXT,
    notes TEXT,
    thumb_path TEXT,
    is_missing INTEGER NOT NULL DEFAULT 0,
    indexed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS audio_tracks (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    stream_index INTEGER NOT NULL,
    track_order INTEGER NOT NULL,
    label TEXT NOT NULL,
    codec TEXT NOT NULL,
    channels INTEGER NOT NULL,
    sample_rate INTEGER NOT NULL,
    bitrate INTEGER
);

CREATE TABLE IF NOT EXISTS collections (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('manual', 'smart')),
    icon TEXT,
    color TEXT,
    smart_rules_json TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS collection_clips (
    collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (collection_id, clip_id)
);

CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    color TEXT
);

CREATE TABLE IF NOT EXISTS clip_tags (
    clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (clip_id, tag_id)
);

CREATE TABLE IF NOT EXISTS export_jobs (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    preset TEXT NOT NULL,
    start_sec REAL NOT NULL,
    end_sec REAL NOT NULL,
    output_path TEXT NOT NULL,
    output_size_bytes INTEGER,
    encoder_used TEXT,
    status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'done', 'failed', 'cancelled')),
    error_message TEXT,
    created_at TEXT NOT NULL,
    finished_at TEXT
);

CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clips_game_recorded ON clips(game_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_clips_favorite ON clips(is_favorite) WHERE is_favorite = 1;
CREATE INDEX IF NOT EXISTS idx_clips_missing ON clips(is_missing);
CREATE INDEX IF NOT EXISTS idx_collection_clips_col ON collection_clips(collection_id, position);

CREATE VIRTUAL TABLE IF NOT EXISTS clips_fts USING fts5(
    clip_id UNINDEXED,
    title,
    file_name,
    notes,
    game_name,
    tags_text
);
"#;

const MIGRATION_V2: &str = r#"
CREATE TABLE watch_folders_new (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    source_type TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 1,
    last_scanned_at TEXT
);
INSERT INTO watch_folders_new (id, path, source_type, enabled, last_scanned_at)
SELECT id, path, source_type, enabled, last_scanned_at FROM watch_folders;
DROP TABLE watch_folders;
ALTER TABLE watch_folders_new RENAME TO watch_folders;
"#;

const MIGRATION_V3: &str = r#"
CREATE TABLE IF NOT EXISTS editor_projects (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    segment_count INTEGER NOT NULL DEFAULT 0,
    total_duration_sec REAL NOT NULL DEFAULT 0,
    data_json TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_editor_projects_updated
    ON editor_projects(updated_at DESC);
"#;

const MIGRATION_V4: &str = r#"
CREATE TABLE IF NOT EXISTS clip_markers (
    id TEXT PRIMARY KEY,
    clip_id TEXT NOT NULL REFERENCES clips(id) ON DELETE CASCADE,
    time_sec REAL NOT NULL,
    label TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#2563EB',
    created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_clip_markers_clip_time
    ON clip_markers(clip_id, time_sec ASC);

CREATE TABLE IF NOT EXISTS custom_export_presets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    container TEXT NOT NULL DEFAULT 'mp4',
    target_size_mb REAL,
    video_bitrate_kbps INTEGER,
    resolution TEXT NOT NULL DEFAULT 'source',
    fps TEXT NOT NULL DEFAULT 'source',
    audio_normalize INTEGER NOT NULL DEFAULT 0,
    stretch_16_9 INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
"#;

pub fn run_migrations(conn: &Connection) -> AppResult<()> {
    conn.execute_batch(
        "PRAGMA journal_mode = WAL;
         PRAGMA foreign_keys = ON;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;",
    )?;

    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS schema_migrations (
            version INTEGER PRIMARY KEY,
            applied_at TEXT NOT NULL
        );",
    )?;

    let v1_applied: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 1",
        [],
        |row| row.get(0),
    )?;

    if v1_applied == 0 {
        conn.execute_batch(MIGRATION_V1)?;
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?1)",
            [Utc::now().to_rfc3339()],
        )?;
    }

    let v2_applied: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 2",
        [],
        |row| row.get(0),
    )?;

    if v2_applied == 0 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(MIGRATION_V2)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (2, ?1)",
            [Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
    }

    let v3_applied: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 3",
        [],
        |row| row.get(0),
    )?;

    if v3_applied == 0 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(MIGRATION_V3)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (3, ?1)",
            [Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
    }

    let v4_applied: i64 = conn.query_row(
        "SELECT COUNT(*) FROM schema_migrations WHERE version = 4",
        [],
        |row| row.get(0),
    )?;

    if v4_applied == 0 {
        let tx = conn.unchecked_transaction()?;
        tx.execute_batch(MIGRATION_V4)?;
        tx.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (4, ?1)",
            [Utc::now().to_rfc3339()],
        )?;
        tx.commit()?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::SourceType;

    #[test]
    fn migration_v2_upgrades_v1_watch_folders_and_allows_extended_source_types() {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
        conn.execute_batch(
            "CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL
            );",
        )
        .expect("create schema_migrations");
        conn.execute_batch(MIGRATION_V1).expect("apply v1 schema");
        conn.execute(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (1, '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("record v1");

        conn.execute(
            "INSERT INTO watch_folders (id, path, source_type, enabled) VALUES ('wf-1', 'C:\\Videos\\NVIDIA', 'nvidia', 1)",
            [],
        )
        .expect("insert v1 nvidia watch folder");

        let pre_v2 = conn.execute(
            "INSERT INTO watch_folders (id, path, source_type, enabled) VALUES ('wf-amd', 'C:\\Videos\\Radeon ReLive', 'amd_relive', 1)",
            [],
        );
        assert!(pre_v2.is_err(), "v1 check constraint must reject amd_relive");

        run_migrations(&conn).expect("upgrade to v2");
        // Idempotent re-run must also succeed.
        run_migrations(&conn).expect("re-run migrations");

        let v2_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 2",
                [],
                |r| r.get(0),
            )
            .expect("check v2 row");
        assert_eq!(v2_count, 1);

        let preserved_source: String = conn
            .query_row(
                "SELECT source_type FROM watch_folders WHERE id = 'wf-1'",
                [],
                |r| r.get(0),
            )
            .expect("existing row preserved");
        assert_eq!(preserved_source, "nvidia");

        for (id, st) in [
            ("wf-amd", SourceType::AmdRelive),
            ("wf-medal", SourceType::Medal),
            ("wf-ascent", SourceType::Ascent),
        ] {
            let path = format!("C:\\Clips\\{id}");
            conn.execute(
                "INSERT INTO watch_folders (id, path, source_type, enabled) VALUES (?1, ?2, ?3, 1)",
                rusqlite::params![id, path, st.as_str()],
            )
            .expect("insert extended source_type after v2");
        }
    }

    #[test]
    fn migration_v4_creates_clip_markers_and_custom_export_presets() {
        let conn = Connection::open_in_memory().expect("open in-memory sqlite");
        run_migrations(&conn).expect("run all migrations");
        run_migrations(&conn).expect("idempotent re-run");

        let v4_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 4",
                [],
                |r| r.get(0),
            )
            .expect("check v4 row");
        assert_eq!(v4_count, 1);

        conn.execute(
            "INSERT INTO clips (
                id, file_path, file_name, file_size_bytes, file_mtime,
                source_type, recorded_at, duration_sec, width, height, fps, video_codec,
                indexed_at
            ) VALUES (
                'clip-1', 'C:\\Clips\\c1.mp4', 'c1.mp4', 1000, 1000,
                'custom', '2026-01-01T00:00:00Z', 10.0, 1920, 1080, 60.0, 'h264',
                '2026-01-01T00:00:00Z'
            )",
            [],
        )
        .expect("insert clip");

        conn.execute(
            "INSERT INTO clip_markers (id, clip_id, time_sec, label, created_at)
             VALUES ('m-1', 'clip-1', 2.5, 'Clutch', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("insert marker with default color");

        let color: String = conn
            .query_row(
                "SELECT color FROM clip_markers WHERE id = 'm-1'",
                [],
                |r| r.get(0),
            )
            .expect("read default marker color");
        assert_eq!(color, "#2563EB");

        conn.execute("DELETE FROM clips WHERE id = 'clip-1'", [])
            .expect("delete clip");
        let remaining_markers: i64 = conn
            .query_row("SELECT COUNT(*) FROM clip_markers", [], |r| r.get(0))
            .expect("count markers after cascade");
        assert_eq!(remaining_markers, 0);

        conn.execute(
            "INSERT INTO custom_export_presets (id, name, created_at, updated_at)
             VALUES ('p-1', 'YouTube 1080p', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')",
            [],
        )
        .expect("insert custom preset with defaults");

        let (container, resolution, fps): (String, String, String) = conn
            .query_row(
                "SELECT container, resolution, fps FROM custom_export_presets WHERE id = 'p-1'",
                [],
                |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
            )
            .expect("read custom preset defaults");
        assert_eq!(container, "mp4");
        assert_eq!(resolution, "source");
        assert_eq!(fps, "source");
    }
}
