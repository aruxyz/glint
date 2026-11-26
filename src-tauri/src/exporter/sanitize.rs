use std::path::{Path, PathBuf};

use crate::error::{AppError, AppResult};
use crate::models::ExportPreset;
pub use crate::paths::{ensure_contained_in_dir, resolve_unique_output_path, sanitize_filename_stem};

pub fn build_output_path(
    export_dir: &Path,
    original_file_name: &str,
    preset: ExportPreset,
    job_id: &str,
) -> AppResult<PathBuf> {
    let raw_stem = Path::new(original_file_name)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("glint_clip");
    let stem = sanitize_filename_stem(raw_stem, "glint_clip");
    let short_id: String = job_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .take(6)
        .collect();
    let suffix = match preset {
        ExportPreset::Discord10mb => "10mb",
        ExportPreset::Discord25mb => "25mb",
        ExportPreset::LosslessTrim => "trim",
        ExportPreset::VerticalBlur916 => "9x16_blur",
        ExportPreset::VerticalCrop916 => "9x16_crop",
    };
    let base = if short_id.is_empty() {
        format!("{stem}_{suffix}")
    } else {
        format!("{stem}_{suffix}_{short_id}")
    };
    resolve_unique_output_path(export_dir, &base, "mp4")
}

pub fn build_merge_output_path(
    export_dir: &Path,
    output_name: Option<&str>,
) -> AppResult<PathBuf> {
    build_named_timestamp_output_path(export_dir, output_name, "glint_montage")
}

pub fn build_editor_output_path(
    export_dir: &Path,
    output_name: Option<&str>,
) -> AppResult<PathBuf> {
    build_named_timestamp_output_path(export_dir, output_name, "Glint_Edit")
}

fn build_named_timestamp_output_path(
    export_dir: &Path,
    output_name: Option<&str>,
    default_stem: &str,
) -> AppResult<PathBuf> {
    let base_name = output_name
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| sanitize_filename_stem(s, default_stem))
        .unwrap_or_else(|| default_stem.to_string());
    let stamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    resolve_unique_output_path(export_dir, &format!("{base_name}_{stamp}"), "mp4")
}

/// Validate and clamp export/trim timestamps, ensuring `end_sec > start_sec`
/// and `end_sec <= clip_duration_sec` when source duration is known.
pub fn validate_export_range(
    start_sec: f64,
    end_sec: f64,
    clip_duration_sec: f64,
    min_duration_sec: f64,
) -> AppResult<(f64, f64, f64)> {
    if !start_sec.is_finite() || !end_sec.is_finite() || start_sec < 0.0 {
        return Err(AppError::InvalidInput(
            "Invalid start or end timestamp".to_string(),
        ));
    }
    if clip_duration_sec > 0.0 && start_sec >= clip_duration_sec {
        return Err(AppError::InvalidInput(
            "Start timestamp exceeds source clip duration".to_string(),
        ));
    }

    let clamped_end = if clip_duration_sec > 0.0 {
        end_sec.min(clip_duration_sec)
    } else {
        end_sec
    };

    if clamped_end <= start_sec {
        return Err(AppError::InvalidInput(
            "endSec must be greater than startSec".to_string(),
        ));
    }

    let duration_sec = clamped_end - start_sec;
    if duration_sec < min_duration_sec {
        return Err(AppError::InvalidInput(format!(
            "Clip duration must be at least {min_duration_sec:.1} seconds"
        )));
    }

    Ok((start_sec, clamped_end, duration_sec))
}

pub fn validate_save_trim_range(
    start_sec: f64,
    end_sec: f64,
    clip_duration_sec: f64,
) -> AppResult<f64> {
    let (_, _, duration_sec) = validate_export_range(start_sec, end_sec, clip_duration_sec, 0.2)?;
    Ok(duration_sec)
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn sanitizes_windows_illegal_chars_traversal_and_reserved_device_names() {
        assert_eq!(
            sanitize_filename_stem(r#"my<clip>:bad/name\..\test|?*."#, "fallback"),
            "my_clip__bad_name___test___"
        );
        assert_eq!(sanitize_filename_stem(".. ..   ...", "fallback"), "fallback");
        assert_eq!(sanitize_filename_stem("CON", "fallback"), "CON_clip");
        assert_eq!(sanitize_filename_stem("prn", "fallback"), "prn_clip");
        assert_eq!(sanitize_filename_stem("Aux.txt", "fallback"), "Aux.txt_clip");
        assert_eq!(sanitize_filename_stem("NUL", "fallback"), "NUL_clip");
        assert_eq!(sanitize_filename_stem("COM1", "fallback"), "COM1_clip");
        assert_eq!(sanitize_filename_stem("lpt9", "fallback"), "lpt9_clip");
        assert_eq!(
            sanitize_filename_stem("Valorant\x00\x1f  Ace . ", "fallback"),
            "Valorant Ace"
        );
    }

    #[test]
    fn resolve_unique_output_path_prevents_overwrite_and_checks_containment() {
        let dir = std::env::temp_dir().join(format!("glint_exp_uniq_{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create export dir");

        let p0 = resolve_unique_output_path(&dir, "Ace Clip", "mp4").expect("p0");
        assert_eq!(p0.file_name().and_then(|n| n.to_str()), Some("Ace Clip.mp4"));
        std::fs::write(&p0, b"first").expect("write p0");

        let p1 = resolve_unique_output_path(&dir, "Ace Clip", "mp4").expect("p1");
        assert_eq!(
            p1.file_name().and_then(|n| n.to_str()),
            Some("Ace Clip_1.mp4")
        );
        std::fs::write(&p1, b"second").expect("write p1");

        let p2 = resolve_unique_output_path(&dir, "Ace Clip", "mp4").expect("p2");
        assert_eq!(
            p2.file_name().and_then(|n| n.to_str()),
            Some("Ace Clip_2.mp4")
        );

        let escaped = dir.join("..").join("escape.mp4");
        assert!(ensure_contained_in_dir(&dir, &escaped).is_err());

        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn validate_export_range_clamps_end_and_rejects_invalid_bounds() {
        let (s, e, d) = validate_export_range(1.0, 25.0, 10.0, 0.5).expect("clamped");
        assert_eq!(s, 1.0);
        assert_eq!(e, 10.0);
        assert!((d - 9.0).abs() < 0.0001);

        assert!(validate_export_range(f64::NAN, 5.0, 10.0, 0.5).is_err());
        assert!(validate_export_range(0.0, f64::INFINITY, 10.0, 0.5).is_err());
        assert!(validate_export_range(-1.0, 5.0, 10.0, 0.5).is_err());
        assert!(validate_export_range(5.0, 5.0, 10.0, 0.5).is_err());
        assert!(validate_export_range(6.0, 4.0, 10.0, 0.5).is_err());
        assert!(validate_export_range(9.8, 15.0, 10.0, 0.5).is_err());
        assert!(validate_export_range(10.0, 12.0, 10.0, 0.5).is_err());
    }
}
