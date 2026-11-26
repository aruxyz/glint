use std::path::PathBuf;

use crate::models::{DetectNvidiaResult, DetectSource};

pub fn detect_nvidia_folder() -> DetectNvidiaResult {
    if let Some(reg_path) = read_nvidia_registry_path() {
        let candidate = PathBuf::from(&reg_path);
        if candidate.exists() && candidate.is_dir() {
            return DetectNvidiaResult {
                found: true,
                path: Some(reg_path),
                source: DetectSource::Registry,
            };
        }
    }

    if let Some(user_profile) = std::env::var_os("USERPROFILE") {
        let fallback = PathBuf::from(user_profile).join("Videos").join("NVIDIA");
        if fallback.exists() && fallback.is_dir() {
            return DetectNvidiaResult {
                found: true,
                path: Some(fallback.to_string_lossy().to_string()),
                source: DetectSource::Default,
            };
        }
    }

    DetectNvidiaResult {
        found: false,
        path: None,
        source: DetectSource::None,
    }
}

pub fn detect_obs_folder() -> DetectNvidiaResult {
    if let Some(app_data) = std::env::var_os("APPDATA") {
        let profiles_dir = PathBuf::from(app_data)
            .join("obs-studio")
            .join("basic")
            .join("profiles");
        if let Ok(entries) = std::fs::read_dir(&profiles_dir) {
            let mut dirs: Vec<PathBuf> = entries
                .flatten()
                .map(|e| e.path())
                .filter(|p| p.is_dir())
                .collect();
            dirs.sort();
            for profile_dir in dirs {
                let ini_path = profile_dir.join("basic.ini");
                if let Ok(content) = std::fs::read_to_string(&ini_path) {
                    if let Some(rec_path) = parse_obs_basic_ini_rec_path(&content) {
                        let candidate = PathBuf::from(&rec_path);
                        if candidate.exists() && candidate.is_dir() {
                            return DetectNvidiaResult {
                                found: true,
                                path: Some(rec_path),
                                source: DetectSource::Default,
                            };
                        }
                    }
                }
            }
        }
    }

    DetectNvidiaResult {
        found: false,
        path: None,
        source: DetectSource::None,
    }
}

pub fn parse_obs_basic_ini_rec_path(ini_content: &str) -> Option<String> {
    let mut section = String::new();
    let mut output_mode = String::new();
    let mut simple_path: Option<String> = None;
    let mut adv_path: Option<String> = None;

    for raw_line in ini_content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with(';') || line.starts_with('#') {
            continue;
        }
        if line.starts_with('[') && line.ends_with(']') {
            section = line[1..line.len() - 1].trim().to_string();
            continue;
        }
        let Some((k, v)) = line.split_once('=') else {
            continue;
        };
        let key = k.trim();
        let val = v.trim();
        if val.is_empty() {
            continue;
        }
        match section.as_str() {
            "Output" if key.eq_ignore_ascii_case("Mode") => {
                output_mode = val.to_ascii_lowercase();
            }
            "SimpleOutput" if key.eq_ignore_ascii_case("FilePath") => {
                simple_path = Some(val.to_string());
            }
            "AdvOut" if key.eq_ignore_ascii_case("RecFilePath") => {
                adv_path = Some(val.to_string());
            }
            _ => {}
        }
    }

    if output_mode == "advanced" {
        adv_path.or(simple_path)
    } else {
        simple_path.or(adv_path)
    }
}

pub fn decode_utf16le_bytes(bytes: &[u8]) -> Option<String> {
    if bytes.len() < 2 {
        return None;
    }
    let mut u16_units = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.chunks_exact(2) {
        let unit = u16::from_le_bytes([chunk[0], chunk[1]]);
        if unit == 0 {
            break;
        }
        u16_units.push(unit);
    }
    let decoded = String::from_utf16_lossy(&u16_units).trim().to_string();
    if decoded.is_empty() {
        None
    } else {
        Some(decoded)
    }
}

#[cfg(target_os = "windows")]
pub fn read_hkcu_string_value(subkey_path: &str, value_name: &str) -> Option<String> {
    use windows::core::PCWSTR;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ,
        REG_BINARY, REG_EXPAND_SZ, REG_SZ, REG_VALUE_TYPE,
    };

    let subkey: Vec<u16> = subkey_path
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let value_name_w: Vec<u16> = value_name
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();

    let mut hkey = HKEY::default();
    let open_res = unsafe {
        RegOpenKeyExW(
            HKEY_CURRENT_USER,
            PCWSTR(subkey.as_ptr()),
            Some(0),
            KEY_READ,
            &mut hkey,
        )
    };
    if open_res.is_err() {
        return None;
    }

    let mut reg_type = REG_VALUE_TYPE::default();
    let mut size: u32 = 0;
    let query_size = unsafe {
        RegQueryValueExW(
            hkey,
            PCWSTR(value_name_w.as_ptr()),
            None,
            Some(&mut reg_type),
            None,
            Some(&mut size),
        )
    };

    if query_size.is_err() || size == 0 {
        unsafe {
            let _ = RegCloseKey(hkey);
        }
        return None;
    }

    let mut buf = vec![0u8; size as usize];
    let query_data = unsafe {
        RegQueryValueExW(
            hkey,
            PCWSTR(value_name_w.as_ptr()),
            None,
            Some(&mut reg_type),
            Some(buf.as_mut_ptr()),
            Some(&mut size),
        )
    };
    unsafe {
        let _ = RegCloseKey(hkey);
    }

    if query_data.is_err() {
        return None;
    }

    if reg_type == REG_BINARY || reg_type == REG_SZ || reg_type == REG_EXPAND_SZ {
        decode_utf16le_bytes(&buf[..(size as usize).min(buf.len())])
    } else {
        None
    }
}

#[cfg(not(target_os = "windows"))]
pub fn read_hkcu_string_value(_subkey_path: &str, _value_name: &str) -> Option<String> {
    None
}

fn read_nvidia_registry_path() -> Option<String> {
    read_hkcu_string_value(
        r"Software\NVIDIA Corporation\Global\ShadowPlay\NVSPCAPS",
        "DefaultPathW",
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decodes_utf16le_null_terminated_path() {
        let expected = r"C:\Users\bebas\Videos\NVIDIA";
        let mut raw: Vec<u8> = expected
            .encode_utf16()
            .flat_map(|u| u.to_le_bytes())
            .collect();
        raw.extend_from_slice(&[0, 0, 99, 0]);
        assert_eq!(decode_utf16le_bytes(&raw).as_deref(), Some(expected));
    }

    #[test]
    fn empty_registry_bytes_return_none() {
        assert_eq!(decode_utf16le_bytes(&[0, 0]), None);
        assert_eq!(decode_utf16le_bytes(&[]), None);
    }

    #[test]
    fn parses_obs_basic_ini_recording_paths() {
        let adv_ini = "[Output]\nMode=Advanced\n[SimpleOutput]\nFilePath=C:\\Simple\n[AdvOut]\nRecFilePath=D:\\OBS\\Clips\n";
        assert_eq!(
            parse_obs_basic_ini_rec_path(adv_ini).as_deref(),
            Some(r"D:\OBS\Clips")
        );

        let simple_ini = "[Output]\nMode=Simple\n[SimpleOutput]\nFilePath=C:\\Users\\test\\Videos\n[AdvOut]\nRecFilePath=D:\\Unused\n";
        assert_eq!(
            parse_obs_basic_ini_rec_path(simple_ini).as_deref(),
            Some(r"C:\Users\test\Videos")
        );
    }
}
