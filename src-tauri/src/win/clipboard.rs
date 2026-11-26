use std::path::Path;

use crate::error::{AppError, AppResult};
use crate::paths::normalize_windows_path;

pub fn extract_dib_from_bmp(bmp_bytes: &[u8]) -> AppResult<&[u8]> {
    if bmp_bytes.len() <= 54 || &bmp_bytes[0..2] != b"BM" {
        return Err(AppError::InvalidInput(
            "Invalid BMP buffer for DIB clipboard".to_string(),
        ));
    }
    Ok(&bmp_bytes[14..])
}

#[cfg(target_os = "windows")]
pub fn copy_file_to_clipboard(file_path: &Path) -> AppResult<()> {
    use std::mem::size_of;
    use windows::Win32::Foundation::{FALSE, POINT, TRUE};
    use windows::Win32::UI::Shell::DROPFILES;

    const CF_HDROP: u32 = 15;

    let norm = normalize_windows_path(file_path);
    if !norm.exists() {
        return Err(AppError::NotFound(format!(
            "File not found for clipboard copy: {}",
            norm.display()
        )));
    }
    let abs = std::fs::canonicalize(&norm)
        .map(|p| normalize_windows_path(&p))
        .unwrap_or(norm);

    let wide_path: Vec<u16> = abs
        .to_string_lossy()
        .encode_utf16()
        .chain([0u16, 0u16])
        .collect();

    let header_size = size_of::<DROPFILES>();
    let path_bytes_len = wide_path.len() * size_of::<u16>();
    let mut payload = vec![0u8; header_size + path_bytes_len];

    let dropfiles = DROPFILES {
        pFiles: header_size as u32,
        pt: POINT { x: 0, y: 0 },
        fNC: FALSE,
        fWide: TRUE,
    };
    unsafe {
        std::ptr::copy_nonoverlapping(
            &dropfiles as *const DROPFILES as *const u8,
            payload.as_mut_ptr(),
            header_size,
        );
        std::ptr::copy_nonoverlapping(
            wide_path.as_ptr() as *const u8,
            payload.as_mut_ptr().add(header_size),
            path_bytes_len,
        );
    }

    put_clipboard_bytes(CF_HDROP, &payload)
}

#[cfg(target_os = "windows")]
pub fn copy_image_dib_to_clipboard(bmp_bytes: &[u8]) -> AppResult<()> {
    const CF_DIB: u32 = 8;
    let dib = extract_dib_from_bmp(bmp_bytes)?;
    put_clipboard_bytes(CF_DIB, dib)
}

#[cfg(target_os = "windows")]
fn put_clipboard_bytes(format: u32, payload: &[u8]) -> AppResult<()> {
    use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };

    unsafe {
        let hmem: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, payload.len())
            .map_err(|e| AppError::Windows(format!("GlobalAlloc failed: {e}")))?;

        let ptr = GlobalLock(hmem);
        if ptr.is_null() {
            let _ = GlobalFree(Some(hmem));
            return Err(AppError::Windows("GlobalLock returned null".to_string()));
        }

        std::ptr::copy_nonoverlapping(payload.as_ptr(), ptr as *mut u8, payload.len());
        let _ = GlobalUnlock(hmem);

        if let Err(e) = OpenClipboard(None) {
            let _ = GlobalFree(Some(hmem));
            return Err(AppError::Windows(format!("OpenClipboard failed: {e}")));
        }

        if let Err(e) = EmptyClipboard() {
            let _ = CloseClipboard();
            let _ = GlobalFree(Some(hmem));
            return Err(AppError::Windows(format!("EmptyClipboard failed: {e}")));
        }

        let handle = HANDLE(hmem.0);
        if let Err(e) = SetClipboardData(format, Some(handle)) {
            let _ = CloseClipboard();
            let _ = GlobalFree(Some(hmem));
            return Err(AppError::Windows(format!("SetClipboardData failed: {e}")));
        }

        let _ = CloseClipboard();
    }

    Ok(())
}

#[cfg(not(target_os = "windows"))]
pub fn copy_file_to_clipboard(_file_path: &Path) -> AppResult<()> {
    Err(AppError::Windows(
        "Clipboard CF_HDROP is only supported on Windows".to_string(),
    ))
}

#[cfg(not(target_os = "windows"))]
pub fn copy_image_dib_to_clipboard(bmp_bytes: &[u8]) -> AppResult<()> {
    let _ = extract_dib_from_bmp(bmp_bytes)?;
    Err(AppError::Windows(
        "Clipboard CF_DIB is only supported on Windows".to_string(),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_14_byte_bmp_header_and_rejects_invalid_buffers() {
        let mut fake_bmp = vec![0u8; 64];
        fake_bmp[0] = b'B';
        fake_bmp[1] = b'M';
        fake_bmp[14] = 40;
        let dib = extract_dib_from_bmp(&fake_bmp).expect("valid bmp");
        assert_eq!(dib.len(), 50);
        assert_eq!(dib[0], 40);

        assert!(extract_dib_from_bmp(&[0u8; 64]).is_err());
        assert!(extract_dib_from_bmp(b"BMshort").is_err());
    }
}
