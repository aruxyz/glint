pub mod clipboard;
pub mod game_mode;
pub mod hardlink;
pub mod recorders;
pub mod registry;

use std::path::Path;
use std::process::Command;

use crate::error::{AppError, AppResult};
use crate::paths::normalize_windows_path;

pub fn apply_mica_backdrop(window: &tauri::WebviewWindow) {
    #[cfg(target_os = "windows")]
    {
        let _ = window_vibrancy::apply_mica(window, Some(false))
            .or_else(|_| window_vibrancy::apply_acrylic(window, Some((249, 250, 252, 225))));
    }
    #[cfg(not(target_os = "windows"))]
    let _ = window;
}

fn clean_explorer_path(path: &Path) -> String {
    let raw = path.to_string_lossy().replace('/', "\\");
    if let Some(unc) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        raw.strip_prefix(r"\\?\").unwrap_or(&raw).to_string()
    }
}

fn validate_explorer_clean_path(clean: &str) -> AppResult<()> {
    if clean.is_empty()
        || clean
            .chars()
            .any(|c| matches!(c, '"' | '\0' | '\r' | '\n'))
    {
        return Err(AppError::InvalidInput(
            "Invalid characters in Explorer path".to_string(),
        ));
    }
    Ok(())
}

pub fn build_explorer_select_arg(target: &Path) -> AppResult<String> {
    let norm = normalize_windows_path(target);
    if !norm.exists() {
        return Err(AppError::NotFound(format!(
            "Path does not exist: {}",
            norm.display()
        )));
    }
    let canon = std::fs::canonicalize(&norm).map(|p| normalize_windows_path(&p))?;
    if !canon.exists() {
        return Err(AppError::NotFound(format!(
            "Path does not exist: {}",
            canon.display()
        )));
    }
    let clean = clean_explorer_path(&canon);
    validate_explorer_clean_path(&clean)?;
    Ok(format!("/select,\"{clean}\""))
}

pub fn open_in_explorer(target: &Path) -> AppResult<()> {
    let norm = normalize_windows_path(target);
    if norm.is_dir() {
        let canon = std::fs::canonicalize(&norm).map(|p| normalize_windows_path(&p))?;
        let clean = clean_explorer_path(&canon);
        validate_explorer_clean_path(&clean)?;
        Command::new("explorer.exe").arg(&clean).spawn()?;
        return Ok(());
    }
    if norm.exists() {
        let select_arg = build_explorer_select_arg(&norm)?;
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            Command::new("explorer.exe").raw_arg(&select_arg).spawn()?;
        }
        #[cfg(not(target_os = "windows"))]
        {
            Command::new("explorer.exe").arg(&select_arg).spawn()?;
        }
        return Ok(());
    }
    if let Some(parent) = norm.parent() {
        if parent.exists() && parent.is_dir() {
            let canon = std::fs::canonicalize(parent).map(|p| normalize_windows_path(&p))?;
            let clean = clean_explorer_path(&canon);
            validate_explorer_clean_path(&clean)?;
            Command::new("explorer.exe").arg(&clean).spawn()?;
            return Ok(());
        }
    }
    Err(AppError::NotFound(format!(
        "Path does not exist: {}",
        norm.display()
    )))
}

pub fn move_file_to_recycle_bin(path: &Path) -> AppResult<()> {
    let norm = normalize_windows_path(path);
    if !norm.exists() {
        return Ok(());
    }
    trash::delete(&norm).map_err(|e| AppError::Internal(format!("Recycle Bin move failed: {e}")))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cleans_verbatim_prefix_and_slashes_for_explorer() {
        let p = Path::new(r"\\?\C:/Users/bebas/Videos/NVIDIA/Valorant/Valorant 2026.11.14.mp4");
        assert_eq!(
            clean_explorer_path(p),
            r"C:\Users\bebas\Videos\NVIDIA\Valorant\Valorant 2026.11.14.mp4"
        );
    }

    #[test]
    fn explorer_select_arg_validates_chars_and_canonicalizes_existing_file() {
        assert!(validate_explorer_clean_path(r#"C:\bad"quote\a.mp4"#).is_err());
        assert!(validate_explorer_clean_path("C:\\bad\0null\\a.mp4").is_err());
        assert!(validate_explorer_clean_path("C:\\bad\r\nline\\a.mp4").is_err());

        let tmp = std::env::temp_dir().join(format!("glint_exp_{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&tmp, b"ok").expect("write temp file");
        let arg = build_explorer_select_arg(&tmp).expect("valid select arg");
        assert!(arg.starts_with("/select,\""));
        assert!(arg.ends_with('"'));
        let inner = &arg["/select,\"".len()..arg.len() - 1];
        assert!(!inner.contains(r"\\?\"));
        assert!(!inner.contains('"'));
        let _ = std::fs::remove_file(&tmp);

        assert!(build_explorer_select_arg(&tmp).is_err());
    }

    #[test]
    fn explorer_select_arg_quotes_only_path_for_directories_and_files_with_spaces() {
        let dir = std::env::temp_dir().join(format!("Glint Exports {}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).expect("create temp dir with spaces");
        let file = dir.join("Glint Edit 20261126.mp4");
        std::fs::write(&file, b"ok").expect("write temp file with spaces");

        let arg = build_explorer_select_arg(&file).expect("valid select arg for spaced path");
        assert!(arg.starts_with("/select,\""));
        assert!(arg.ends_with('"'));
        assert!(!arg.starts_with("\"/select,"));

        let inner = &arg["/select,\"".len()..arg.len() - 1];
        assert!(inner.contains("Glint Exports "));
        assert!(inner.ends_with(r"\Glint Edit 20261126.mp4"));
        assert!(!inner.contains(r"\\?\"));
        assert!(!inner.contains('"'));

        let verbatim = Path::new(&format!(r"\\?\{inner}")).to_path_buf();
        let verbatim_arg =
            build_explorer_select_arg(&verbatim).expect("valid select arg for verbatim path");
        assert_eq!(verbatim_arg, arg);

        let _ = std::fs::remove_file(&file);
        let _ = std::fs::remove_dir(&dir);
    }
}
