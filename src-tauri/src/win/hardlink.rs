use std::collections::HashSet;
use std::path::Path;

use crate::db::ClipHardlinkSource;
use crate::error::{AppError, AppResult};
use crate::models::HardlinkExportResult;
use crate::paths::{normalize_windows_path, sanitize_filename_stem};

pub fn export_collection_hardlinks(
    collection_name: &str,
    clips: &[ClipHardlinkSource],
    target_dir: Option<&str>,
    default_base_dir: &Path,
) -> AppResult<HardlinkExportResult> {
    let default_base_norm = normalize_windows_path(default_base_dir);
    let target_folder = match target_dir {
        Some(custom) if !custom.trim().is_empty() => normalize_windows_path(Path::new(custom.trim())),
        _ => default_base_norm.join(slugify(collection_name)),
    };

    std::fs::create_dir_all(&target_folder)?;
    let target_folder_abs = std::fs::canonicalize(&target_folder)
        .map(|p| normalize_windows_path(&p))
        .unwrap_or_else(|_| target_folder.clone());
    let default_base_abs = std::fs::canonicalize(&default_base_norm)
        .map(|p| normalize_windows_path(&p))
        .unwrap_or(default_base_norm);

    let target_volume = get_volume_root(&target_folder_abs);
    let target_is_ntfs = is_ntfs_volume(&target_volume);
    let managed_folder = target_dir.is_none()
        && target_folder_abs != default_base_abs
        && target_folder_abs.starts_with(&default_base_abs);

    let mut linked_count = 0i64;
    let mut skipped_count = 0i64;
    let mut cross_drive_clips = 0i64;
    let mut used_names: HashSet<String> = HashSet::new();

    for clip in clips {
        let src_path = normalize_windows_path(Path::new(&clip.file_path));
        if !src_path.exists() {
            skipped_count += 1;
            continue;
        }

        let src_abs = std::fs::canonicalize(&src_path)
            .map(|p| normalize_windows_path(&p))
            .unwrap_or(src_path);
        let src_volume = get_volume_root(&src_abs);

        if !target_is_ntfs || !volumes_equal(&src_volume, &target_volume) {
            cross_drive_clips += 1;
            skipped_count += 1;
            continue;
        }

        let safe_name = sanitize_clip_filename(&clip.file_name);
        let dst_name = unique_filename(&safe_name, &clip.id, &mut used_names);
        let mut dst_path = target_folder_abs.join(&dst_name);

        if dst_path.exists() {
            if is_same_file(&src_abs, &dst_path) {
                linked_count += 1;
                continue;
            }
            if managed_folder && is_safe_managed_hardlink_replacement(&target_folder_abs, &dst_path)
            {
                let _ = std::fs::remove_file(&dst_path);
            } else {
                dst_path = resolve_non_colliding_hardlink_path(
                    &target_folder_abs,
                    &dst_name,
                    &clip.id,
                    &mut used_names,
                );
            }
        }

        match create_win_hardlink(&dst_path, &src_abs) {
            Ok(()) => linked_count += 1,
            Err(_) => skipped_count += 1,
        }
    }

    Ok(HardlinkExportResult {
        folder_path: target_folder_abs.to_string_lossy().to_string(),
        linked_count,
        skipped_count,
        cross_drive_clips,
    })
}

pub fn slugify(name: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in name.chars() {
        if ch.is_ascii_alphanumeric() {
            out.push(ch.to_ascii_lowercase());
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    let trimmed = out.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "collection".to_string()
    } else {
        trimmed
    }
}

fn unique_filename(original: &str, clip_id: &str, used: &mut HashSet<String>) -> String {
    let lower = original.to_ascii_lowercase();
    if used.insert(lower) {
        return original.to_string();
    }
    let candidate = suffixed_filename(original, clip_id);
    used.insert(candidate.to_ascii_lowercase());
    candidate
}

fn suffixed_filename(original: &str, clip_id: &str) -> String {
    let short: String = clip_id.chars().filter(|c| c.is_alphanumeric()).take(6).collect();
    let p = Path::new(original);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("clip");
    match p.extension().and_then(|e| e.to_str()) {
        Some(ext) => format!("{stem}_{short}.{ext}"),
        None => format!("{stem}_{short}"),
    }
}

fn volumes_equal(a: &str, b: &str) -> bool {
    !a.is_empty() && a.eq_ignore_ascii_case(b)
}

#[cfg(target_os = "windows")]
fn get_volume_root(path: &Path) -> String {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetVolumePathNameW;

    let wide_path: Vec<u16> = path
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut buf = vec![0u16; 260];
    let ok = unsafe { GetVolumePathNameW(PCWSTR(wide_path.as_ptr()), &mut buf) };
    if ok.is_ok() {
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        return String::from_utf16_lossy(&buf[..len]);
    }
    let raw = path.to_string_lossy();
    if raw.len() >= 3 && raw.as_bytes()[1] == b':' {
        format!("{}:\\", &raw[0..1])
    } else {
        String::new()
    }
}

#[cfg(not(target_os = "windows"))]
fn get_volume_root(_path: &Path) -> String {
    "/".to_string()
}

#[cfg(target_os = "windows")]
fn is_ntfs_volume(volume_root: &str) -> bool {
    use windows::core::PCWSTR;
    use windows::Win32::Storage::FileSystem::GetVolumeInformationW;

    if volume_root.is_empty() {
        return false;
    }
    let wide_root: Vec<u16> = volume_root
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let mut fs_name = vec![0u16; 64];
    let ok = unsafe {
        GetVolumeInformationW(
            PCWSTR(wide_root.as_ptr()),
            None,
            None,
            None,
            None,
            Some(&mut fs_name),
        )
    };
    if ok.is_err() {
        return false;
    }
    let len = fs_name.iter().position(|&c| c == 0).unwrap_or(fs_name.len());
    let fs = String::from_utf16_lossy(&fs_name[..len]);
    fs.eq_ignore_ascii_case("NTFS")
}

#[cfg(not(target_os = "windows"))]
fn is_ntfs_volume(_volume_root: &str) -> bool {
    true
}

#[cfg(target_os = "windows")]
fn create_win_hardlink(new_link: &Path, existing_file: &Path) -> AppResult<()> {
    #[link(name = "kernel32")]
    extern "system" {
        fn CreateHardLinkW(
            lp_file_name: *const u16,
            lp_existing_file_name: *const u16,
            lp_security_attributes: *const std::ffi::c_void,
        ) -> i32;
    }

    let new_w: Vec<u16> = new_link
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let existing_w: Vec<u16> = existing_file
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let ok = unsafe { CreateHardLinkW(new_w.as_ptr(), existing_w.as_ptr(), std::ptr::null()) };
    if ok == 0 {
        let err = std::io::Error::last_os_error();
        return Err(AppError::Windows(format!("CreateHardLinkW failed: {err}")));
    }
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn create_win_hardlink(new_link: &Path, existing_file: &Path) -> AppResult<()> {
    std::fs::hard_link(existing_file, new_link).map_err(Into::into)
}

fn sanitize_clip_filename(raw_name: &str) -> String {
    let p = Path::new(raw_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("clip");
    let safe_stem = sanitize_filename_stem(stem, "clip");
    match p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.trim())
        .filter(|e| !e.is_empty() && e.chars().all(|c| c.is_ascii_alphanumeric()))
    {
        Some(ext) => format!("{safe_stem}.{ext}"),
        None => safe_stem,
    }
}

fn resolve_non_colliding_hardlink_path(
    target_folder_abs: &Path,
    base_name: &str,
    clip_id: &str,
    used_names: &mut HashSet<String>,
) -> std::path::PathBuf {
    let alt_name = suffixed_filename(base_name, clip_id);
    let alt_path = target_folder_abs.join(&alt_name);
    if !alt_path.exists() && used_names.insert(alt_name.to_ascii_lowercase()) {
        return alt_path;
    }

    let p = Path::new(&alt_name);
    let stem = p.file_stem().and_then(|s| s.to_str()).unwrap_or("clip");
    let ext = p.extension().and_then(|e| e.to_str());
    for idx in 1..=1000u32 {
        let candidate_name = match ext {
            Some(e) => format!("{stem}_{idx}.{e}"),
            None => format!("{stem}_{idx}"),
        };
        let candidate_path = target_folder_abs.join(&candidate_name);
        if !candidate_path.exists() && used_names.insert(candidate_name.to_ascii_lowercase()) {
            return candidate_path;
        }
    }
    alt_path
}

fn is_safe_managed_hardlink_replacement(target_folder_abs: &Path, dst_path: &Path) -> bool {
    let Ok(dst_canon) = std::fs::canonicalize(dst_path).map(|p| normalize_windows_path(&p)) else {
        return false;
    };
    if !dst_canon.starts_with(target_folder_abs) {
        return false;
    }
    // Only unlink when at least one other hardlink still preserves the underlying file data.
    hardlink_count(&dst_canon).is_some_and(|n| n > 1)
}

#[cfg(target_os = "windows")]
fn hardlink_count(path: &Path) -> Option<u32> {
    use std::os::windows::io::AsRawHandle;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Storage::FileSystem::{
        GetFileInformationByHandle, BY_HANDLE_FILE_INFORMATION,
    };

    let file = std::fs::File::open(path).ok()?;
    let handle = HANDLE(file.as_raw_handle());
    let mut info = BY_HANDLE_FILE_INFORMATION::default();
    let res = unsafe { GetFileInformationByHandle(handle, &mut info) };
    res.ok().map(|()| info.nNumberOfLinks)
}

#[cfg(not(target_os = "windows"))]
fn hardlink_count(_path: &Path) -> Option<u32> {
    None
}

fn is_same_file(a: &Path, b: &Path) -> bool {
    let Ok(fa) = std::fs::metadata(a) else {
        return false;
    };
    let Ok(fb) = std::fs::metadata(b) else {
        return false;
    };
    fa.len() == fb.len()
        && fa.modified().ok() == fb.modified().ok()
        && get_volume_root(a).eq_ignore_ascii_case(&get_volume_root(b))
}

#[cfg(test)]
mod tests {
    use super::*;
    use uuid::Uuid;

    #[test]
    fn never_deletes_sole_copy_file_in_managed_hardlink_folder() {
        let root = std::env::temp_dir().join(format!("glint_hl_{}", Uuid::new_v4()));
        let src_dir = root.join("src");
        let base_dir = root.join("linked-folders");
        let col_dir = base_dir.join("my-clips");
        std::fs::create_dir_all(&src_dir).expect("src_dir");
        std::fs::create_dir_all(&col_dir).expect("col_dir");

        let src_file = src_dir.join("ace.mp4");
        std::fs::write(&src_file, b"new clip payload").expect("write src");

        // Pre-existing standalone file (nlink == 1) with colliding name inside managed folder.
        let sole_existing = col_dir.join("ace.mp4");
        std::fs::write(&sole_existing, b"irreplaceable original data").expect("write sole");

        let res = export_collection_hardlinks(
            "My Clips",
            &[ClipHardlinkSource {
                id: "clip9999".to_string(),
                file_path: src_file.to_string_lossy().to_string(),
                file_name: "ace.mp4".to_string(),
            }],
            None,
            &base_dir,
        )
        .expect("export hardlinks");

        assert_eq!(res.linked_count, 1);
        assert_eq!(
            std::fs::read(&sole_existing).expect("sole file preserved"),
            b"irreplaceable original data"
        );
        assert!(col_dir.join("ace_clip99.mp4").exists());

        let _ = std::fs::remove_dir_all(&root);
    }
}
