use std::path::{Path, PathBuf};

use serde_json::Value;

use crate::discovery::steam::detect_steam_recordings_folder;
use crate::models::{DetectNvidiaResult, DetectSource, DetectedRecorder, SourceType};
use crate::paths::normalize_windows_path;
use crate::win::registry::{detect_nvidia_folder, detect_obs_folder, read_hkcu_string_value};

pub fn expand_windows_env_vars(input: &str) -> String {
    let trimmed = input.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut out = String::with_capacity(trimmed.len());
    let chars: Vec<char> = trimmed.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '%' {
            if let Some(rel_end) = chars[i + 1..].iter().position(|&c| c == '%') {
                let end = i + 1 + rel_end;
                let var_name: String = chars[i + 1..end].iter().collect();
                if !var_name.is_empty() {
                    if let Some(val) = lookup_env_ci(&var_name) {
                        out.push_str(&val);
                        i = end + 1;
                        continue;
                    }
                }
            }
        }
        out.push(chars[i]);
        i += 1;
    }

    out.replace('/', "\\")
}

fn lookup_env_ci(name: &str) -> Option<String> {
    if let Ok(val) = std::env::var(name) {
        return Some(val);
    }
    std::env::vars()
        .find(|(k, _)| k.eq_ignore_ascii_case(name))
        .map(|(_, v)| v)
}

pub fn parse_medal_settings_json(raw: &str) -> Option<String> {
    let parsed: Value = serde_json::from_str(raw).ok()?;
    for pointer in ["/recorder/clipFolder", "/clips/clipsFolder"] {
        if let Some(s) = parsed.pointer(pointer).and_then(|v| v.as_str()) {
            let expanded = expand_windows_env_vars(s);
            if !expanded.is_empty() {
                return Some(expanded);
            }
        }
    }
    find_json_string_by_keys(&parsed, &["clipsFolder", "recFolder", "clipFolder"])
}

pub fn parse_generic_recorder_config_json(raw: &str, candidate_keys: &[&str]) -> Option<String> {
    let parsed: Value = serde_json::from_str(raw).ok()?;
    find_json_string_by_keys(&parsed, candidate_keys)
}

fn find_json_string_by_keys(value: &Value, candidate_keys: &[&str]) -> Option<String> {
    let obj = value.as_object()?;
    for &wanted in candidate_keys {
        if let Some((_, val)) = obj
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(wanted))
        {
            if let Some(raw_str) = val.as_str() {
                let expanded = expand_windows_env_vars(raw_str);
                if !expanded.is_empty() {
                    return Some(expanded);
                }
            }
        }
    }

    for (_, child) in obj {
        if child.is_object() {
            if let Some(found) = find_json_string_by_keys(child, candidate_keys) {
                return Some(found);
            }
        }
    }
    None
}

fn normalized_dir_key(path: &Path) -> String {
    normalize_windows_path(path)
        .to_string_lossy()
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn is_bare_user_videos_or_profile(path: &Path) -> bool {
    let key = normalized_dir_key(path);
    if key.is_empty() || key.ends_with(':') {
        return true;
    }
    if let Some(user_profile) = lookup_env_ci("USERPROFILE") {
        let profile_path = PathBuf::from(user_profile);
        let videos_path = profile_path.join("Videos");
        if key == normalized_dir_key(&profile_path) || key == normalized_dir_key(&videos_path) {
            return true;
        }
    }
    false
}

pub fn is_safe_existing_recorder_dir(path: &Path) -> bool {
    path.is_dir() && !is_bare_user_videos_or_profile(path)
}

fn sanitize_detect_result(
    id: &str,
    label: &str,
    source_type: SourceType,
    res: DetectNvidiaResult,
) -> DetectedRecorder {
    if res.found {
        if let Some(raw) = res.path {
            let candidate = normalize_windows_path(Path::new(&raw));
            if is_safe_existing_recorder_dir(&candidate) {
                return DetectedRecorder {
                    id: id.to_string(),
                    label: label.to_string(),
                    source_type,
                    found: true,
                    path: Some(candidate.to_string_lossy().to_string()),
                    source: res.source,
                };
            }
        }
    }

    DetectedRecorder {
        id: id.to_string(),
        label: label.to_string(),
        source_type,
        found: false,
        path: None,
        source: DetectSource::None,
    }
}

fn detect_from_candidates(
    id: &str,
    label: &str,
    source_type: SourceType,
    candidates: Vec<(PathBuf, DetectSource)>,
) -> DetectedRecorder {
    for (path, source) in candidates {
        let norm = normalize_windows_path(&path);
        if is_safe_existing_recorder_dir(&norm) {
            return DetectedRecorder {
                id: id.to_string(),
                label: label.to_string(),
                source_type,
                found: true,
                path: Some(norm.to_string_lossy().to_string()),
                source,
            };
        }
    }

    DetectedRecorder {
        id: id.to_string(),
        label: label.to_string(),
        source_type,
        found: false,
        path: None,
        source: DetectSource::None,
    }
}

fn user_profile_dir() -> Option<PathBuf> {
    lookup_env_ci("USERPROFILE").map(PathBuf::from)
}

fn app_data_dir() -> Option<PathBuf> {
    lookup_env_ci("APPDATA").map(PathBuf::from)
}

fn local_app_data_dir() -> Option<PathBuf> {
    lookup_env_ci("LOCALAPPDATA").map(PathBuf::from)
}

pub fn detect_amd_relive_recorder() -> DetectedRecorder {
    let mut candidates = Vec::new();
    for val_name in ["SaveFolder", "DVRPath"] {
        if let Some(raw) = read_hkcu_string_value(r"Software\AMD\DVR", val_name) {
            let expanded = expand_windows_env_vars(&raw);
            if !expanded.is_empty() {
                candidates.push((PathBuf::from(expanded), DetectSource::Registry));
            }
        }
    }

    if let Some(profile) = user_profile_dir() {
        let videos = profile.join("Videos");
        candidates.push((videos.join("Radeon ReLive"), DetectSource::Default));
        candidates.push((videos.join("AMD"), DetectSource::Default));
        candidates.push((videos.join("AMD Software"), DetectSource::Default));
    }

    detect_from_candidates("amd_relive", "AMD Radeon ReLive", SourceType::AmdRelive, candidates)
}

pub fn detect_medal_recorder() -> DetectedRecorder {
    let mut candidates = Vec::new();
    if let Some(appdata) = app_data_dir() {
        let settings_path = appdata.join("Medal").join("store").join("settings.json");
        if let Ok(content) = std::fs::read_to_string(&settings_path) {
            if let Some(folder) = parse_medal_settings_json(&content) {
                candidates.push((PathBuf::from(folder), DetectSource::Default));
            }
        }
    }

    candidates.push((PathBuf::from(r"C:\Medal\Clips"), DetectSource::Default));
    candidates.push((PathBuf::from(r"C:\Medal"), DetectSource::Default));
    if let Some(profile) = user_profile_dir() {
        let videos = profile.join("Videos");
        candidates.push((videos.join("Medal").join("Clips"), DetectSource::Default));
        candidates.push((videos.join("Medal"), DetectSource::Default));
    }

    detect_from_candidates("medal", "Medal.tv", SourceType::Medal, candidates)
}

pub fn detect_ascent_recorder() -> DetectedRecorder {
    const ASCENT_KEYS: &[&str] = &[
        "clipsFolder",
        "recordingPath",
        "savePath",
        "outputPath",
        "clipPath",
        "videoFolder",
    ];
    let mut candidates = Vec::new();

    let mut config_dirs = Vec::new();
    if let Some(appdata) = app_data_dir() {
        config_dirs.push(appdata.join("Ascent"));
        config_dirs.push(appdata.join("ascent"));
        config_dirs.push(appdata.join("ascent-gg"));
    }
    if let Some(local) = local_app_data_dir() {
        config_dirs.push(local.join("Ascent"));
        config_dirs.push(local.join("ascent"));
    }

    for dir in config_dirs {
        for file_name in ["settings.json", "config.json"] {
            let cfg_path = dir.join(file_name);
            if let Ok(content) = std::fs::read_to_string(&cfg_path) {
                if let Some(folder) = parse_generic_recorder_config_json(&content, ASCENT_KEYS) {
                    candidates.push((PathBuf::from(folder), DetectSource::Default));
                }
            }
        }
    }

    if let Some(profile) = user_profile_dir() {
        let videos = profile.join("Videos");
        candidates.push((videos.join("Ascent"), DetectSource::Default));
        candidates.push((videos.join("Ascent.gg"), DetectSource::Default));
        candidates.push((videos.join("AscentGG"), DetectSource::Default));
    }
    candidates.push((PathBuf::from(r"C:\Ascent\Clips"), DetectSource::Default));

    detect_from_candidates("ascent", "Ascent.gg", SourceType::Ascent, candidates)
}

pub fn detect_outplayed_recorder() -> DetectedRecorder {
    let mut candidates = Vec::new();
    if let Some(profile) = user_profile_dir() {
        let videos = profile.join("Videos");
        candidates.push((videos.join("Overwolf").join("Outplayed"), DetectSource::Default));
        candidates.push((videos.join("Outplayed"), DetectSource::Default));
    }
    detect_from_candidates(
        "outplayed",
        "Outplayed (Overwolf)",
        SourceType::Outplayed,
        candidates,
    )
}

pub fn detect_steelseries_recorder() -> DetectedRecorder {
    let mut candidates = Vec::new();
    if let Some(profile) = user_profile_dir() {
        candidates.push((
            profile
                .join("Documents")
                .join("SteelSeries")
                .join("GG")
                .join("Moments")
                .join("Storage"),
            DetectSource::Default,
        ));
        let videos = profile.join("Videos");
        candidates.push((videos.join("SteelSeries").join("Moments"), DetectSource::Default));
        candidates.push((videos.join("Moments"), DetectSource::Default));
    }
    detect_from_candidates(
        "steelseries",
        "SteelSeries Moments",
        SourceType::SteelSeries,
        candidates,
    )
}

pub fn detect_xbox_recorder() -> DetectedRecorder {
    let mut candidates = Vec::new();
    if let Some(raw) = read_hkcu_string_value(
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders",
        "{ED2C7938-0B10-4FFF-858B-F12E5718E37E}",
    ) {
        let expanded = expand_windows_env_vars(&raw);
        if !expanded.is_empty() {
            candidates.push((PathBuf::from(expanded), DetectSource::Registry));
        }
    }

    if let Some(profile) = user_profile_dir() {
        candidates.push((profile.join("Videos").join("Captures"), DetectSource::Default));
    }

    detect_from_candidates("xbox", "Xbox Game Bar", SourceType::Xbox, candidates)
}

pub fn detect_all_recorders() -> Vec<DetectedRecorder> {
    vec![
        sanitize_detect_result(
            "nvidia",
            "NVIDIA ShadowPlay",
            SourceType::Nvidia,
            detect_nvidia_folder(),
        ),
        detect_amd_relive_recorder(),
        sanitize_detect_result("obs", "OBS Studio", SourceType::Obs, detect_obs_folder()),
        sanitize_detect_result(
            "steam",
            "Steam Game Recording",
            SourceType::Steam,
            detect_steam_recordings_folder(),
        ),
        detect_medal_recorder(),
        detect_ascent_recorder(),
        detect_outplayed_recorder(),
        detect_steelseries_recorder(),
        detect_xbox_recorder(),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn expands_windows_environment_variables() {
        let profile = lookup_env_ci("USERPROFILE").expect("USERPROFILE set on Windows");
        let expanded = expand_windows_env_vars(r"%USERPROFILE%\Videos\Captures");
        assert_eq!(expanded, format!("{profile}\\Videos\\Captures"));

        let untouched = expand_windows_env_vars(r"%GLINT_MISSING_ENV_VAR_XYZ%\Clips");
        assert_eq!(untouched, r"%GLINT_MISSING_ENV_VAR_XYZ%\Clips");
    }

    #[test]
    fn parses_medal_settings_json_variants() {
        let nested_recorder = r#"{
            "app": { "theme": "dark" },
            "recorder": { "clipFolder": "D:\\Medal\\Clips" }
        }"#;
        assert_eq!(
            parse_medal_settings_json(nested_recorder).as_deref(),
            Some(r"D:\Medal\Clips")
        );

        let nested_clips = r#"{
            "clips": { "clipsFolder": "%USERPROFILE%\\Videos\\Medal" }
        }"#;
        let parsed = parse_medal_settings_json(nested_clips).expect("nested clipsFolder");
        assert!(parsed.ends_with(r"\Videos\Medal"));

        let top_level = r#"{ "recFolder": "E:/Clips/Medal" }"#;
        assert_eq!(
            parse_medal_settings_json(top_level).as_deref(),
            Some(r"E:\Clips\Medal")
        );
    }

    #[test]
    fn parses_ascent_generic_recorder_config_json() {
        let cfg = r#"{
            "general": { "startOnBoot": true },
            "capture": { "recordingPath": "D:\\Ascent\\Recordings" }
        }"#;
        let res = parse_generic_recorder_config_json(
            cfg,
            &[
                "clipsFolder",
                "recordingPath",
                "savePath",
                "outputPath",
                "clipPath",
                "videoFolder",
            ],
        );
        assert_eq!(res.as_deref(), Some(r"D:\Ascent\Recordings"));

        assert_eq!(
            parse_generic_recorder_config_json("{invalid json", &["clipsFolder"]),
            None
        );
    }

    #[test]
    fn rejects_bare_user_videos_root() {
        if let Some(profile) = user_profile_dir() {
            assert!(is_bare_user_videos_or_profile(&profile.join("Videos")));
            assert!(is_bare_user_videos_or_profile(&profile));
        }
    }
}
