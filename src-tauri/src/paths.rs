use std::path::{Component, Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::models::AppSettings;

#[derive(Debug, Clone)]
pub struct AppPaths {
    pub base_dir: PathBuf,
    pub db_path: PathBuf,
    pub thumbs_dir: PathBuf,
    pub audio_cache_dir: PathBuf,
    pub waveform_cache_dir: PathBuf,
    pub steam_remux_dir: PathBuf,
    pub default_hardlink_dir: PathBuf,
    pub default_export_dir: PathBuf,
    pub saved_clips_dir: PathBuf,
}

impl AppPaths {
    pub fn from_system() -> AppResult<Self> {
        let local_app_data = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .or_else(|| {
                std::env::var_os("USERPROFILE")
                    .map(|p| PathBuf::from(p).join("AppData").join("Local"))
            })
            .unwrap_or_else(std::env::temp_dir);

        let base_dir = local_app_data.join("Glint");
        let export_dir = std::env::var_os("USERPROFILE")
            .map(|p| PathBuf::from(p).join("Videos").join("Glint Exports"))
            .unwrap_or_else(|| base_dir.join("exports"));

        Self::from_base_and_export(base_dir, export_dir)
    }

    pub fn from_base_and_export(base_dir: PathBuf, default_export_dir: PathBuf) -> AppResult<Self> {
        let thumbs_dir = base_dir.join("cache").join("thumbs");
        let audio_cache_dir = base_dir.join("cache").join("audio");
        let waveform_cache_dir = base_dir.join("cache").join("waveforms");
        let steam_remux_dir = base_dir.join("cache").join("steam-remux");
        let default_hardlink_dir = base_dir.join("linked-folders");
        let saved_clips_dir = base_dir.join("saved-clips");
        let db_path = base_dir.join("glint.db");

        std::fs::create_dir_all(&base_dir)?;
        std::fs::create_dir_all(&thumbs_dir)?;
        std::fs::create_dir_all(&audio_cache_dir)?;
        std::fs::create_dir_all(&waveform_cache_dir)?;
        std::fs::create_dir_all(&steam_remux_dir)?;
        std::fs::create_dir_all(&default_hardlink_dir)?;
        std::fs::create_dir_all(&saved_clips_dir)?;

        Ok(Self {
            base_dir,
            db_path,
            thumbs_dir,
            audio_cache_dir,
            waveform_cache_dir,
            steam_remux_dir,
            default_hardlink_dir,
            default_export_dir,
            saved_clips_dir,
        })
    }

    pub fn default_settings(&self) -> AppSettings {
        AppSettings {
            max_storage_gb: 100.0,
            hardlink_base_dir: self.default_hardlink_dir.to_string_lossy().to_string(),
            export_output_dir: self.default_export_dir.to_string_lossy().to_string(),
            auto_copy_export_to_clipboard: true,
            default_auto_next: true,
            minimize_to_tray: false,
        }
    }

    pub fn thumb_path(&self, clip_id: &str) -> PathBuf {
        self.thumbs_dir.join(format!("{clip_id}.jpg"))
    }

    pub fn audio_cache_path(&self, clip_id: &str, track_order: i32) -> PathBuf {
        self.audio_cache_dir
            .join(format!("{clip_id}_{track_order}.m4a"))
    }

    pub fn waveform_cache_path(&self, clip_id: &str, track_order: i32) -> PathBuf {
        self.waveform_cache_dir
            .join(format!("{clip_id}_{track_order}.json"))
    }
}

pub fn normalize_windows_path(path: &Path) -> PathBuf {
    let raw = path.to_string_lossy();
    if let Some(stripped) = raw.strip_prefix(r"\\?\UNC\") {
        PathBuf::from(format!(r"\\{stripped}"))
    } else if let Some(stripped) = raw.strip_prefix(r"\\?\") {
        PathBuf::from(stripped)
    } else {
        path.to_path_buf()
    }
}

fn is_windows_reserved_name(stem: &str) -> bool {
    let base = stem.split('.').next().unwrap_or(stem);
    let upper = base.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

pub fn sanitize_filename_stem(raw: &str, fallback: &str) -> String {
    let safe_fallback = if fallback.trim().is_empty() || is_windows_reserved_name(fallback.trim()) {
        "glint_clip"
    } else {
        fallback.trim()
    };

    let cleaned: String = raw
        .chars()
        .filter(|ch| !ch.is_control())
        .map(|ch| {
            if matches!(ch, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') {
                '_'
            } else {
                ch
            }
        })
        .collect();

    let mut no_parent_dots = cleaned;
    while no_parent_dots.contains("..") {
        no_parent_dots = no_parent_dots.replace("..", "_");
    }

    let trimmed = no_parent_dots
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_matches(|c: char| c == '.' || c == ' ')
        .to_string();

    if trimmed.is_empty() || trimmed.chars().all(|c| c == '_' || c == '.' || c == ' ') {
        return safe_fallback.to_string();
    }

    if is_windows_reserved_name(&trimmed) {
        return format!("{trimmed}_clip");
    }

    trimmed
}

pub fn sanitize_path_segment(raw: &str, fallback: &str) -> String {
    sanitize_filename_stem(raw, fallback)
}

pub fn ensure_contained_in_dir(dir: &Path, candidate: &Path) -> AppResult<()> {
    if candidate
        .components()
        .any(|c| matches!(c, Component::ParentDir))
    {
        return Err(AppError::InvalidInput(
            "Output path contains parent traversal".to_string(),
        ));
    }

    let norm_dir = normalize_windows_path(dir);
    let norm_candidate = normalize_windows_path(candidate);

    if norm_dir.exists() {
        let canon_dir = std::fs::canonicalize(&norm_dir).map(|p| normalize_windows_path(&p))?;
        let candidate_parent = norm_candidate.parent().ok_or_else(|| {
            AppError::InvalidInput("Output path has no parent directory".to_string())
        })?;
        let canon_parent =
            std::fs::canonicalize(candidate_parent).map(|p| normalize_windows_path(&p))?;
        if canon_parent != canon_dir {
            return Err(AppError::InvalidInput(
                "Output path escapes target directory".to_string(),
            ));
        }
        return Ok(());
    }

    if norm_candidate.parent() != Some(norm_dir.as_path()) {
        return Err(AppError::InvalidInput(
            "Output path escapes target directory".to_string(),
        ));
    }
    Ok(())
}

pub fn resolve_unique_output_path(dir: &Path, raw_stem: &str, ext: &str) -> AppResult<PathBuf> {
    let clean_stem = sanitize_filename_stem(raw_stem, "glint_clip");
    let clean_ext = ext.trim().trim_start_matches('.');
    let primary = if clean_ext.is_empty() {
        dir.join(&clean_stem)
    } else {
        dir.join(format!("{clean_stem}.{clean_ext}"))
    };
    ensure_contained_in_dir(dir, &primary)?;
    if !primary.exists() {
        return Ok(primary);
    }

    for idx in 1..=10_000u32 {
        let candidate = if clean_ext.is_empty() {
            dir.join(format!("{clean_stem}_{idx}"))
        } else {
            dir.join(format!("{clean_stem}_{idx}.{clean_ext}"))
        };
        ensure_contained_in_dir(dir, &candidate)?;
        if !candidate.exists() {
            return Ok(candidate);
        }
    }

    Err(AppError::Internal(
        "Unable to allocate unique output filename".to_string(),
    ))
}
