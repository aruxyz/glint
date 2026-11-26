use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SourceType {
    #[serde(rename = "nvidia")]
    Nvidia,
    #[serde(rename = "amd_relive")]
    AmdRelive,
    #[serde(rename = "obs")]
    Obs,
    #[serde(rename = "steam")]
    Steam,
    #[serde(rename = "medal")]
    Medal,
    #[serde(rename = "ascent")]
    Ascent,
    #[serde(rename = "outplayed")]
    Outplayed,
    #[serde(rename = "steelseries")]
    SteelSeries,
    #[serde(rename = "xbox")]
    Xbox,
    #[serde(rename = "custom")]
    Custom,
}

impl SourceType {
    pub fn as_str(self) -> &'static str {
        match self {
            SourceType::Nvidia => "nvidia",
            SourceType::AmdRelive => "amd_relive",
            SourceType::Obs => "obs",
            SourceType::Steam => "steam",
            SourceType::Medal => "medal",
            SourceType::Ascent => "ascent",
            SourceType::Outplayed => "outplayed",
            SourceType::SteelSeries => "steelseries",
            SourceType::Xbox => "xbox",
            SourceType::Custom => "custom",
        }
    }

    pub fn from_str_lossy(value: &str) -> Self {
        match value {
            "nvidia" => SourceType::Nvidia,
            "amd_relive" => SourceType::AmdRelive,
            "obs" => SourceType::Obs,
            "steam" => SourceType::Steam,
            "medal" => SourceType::Medal,
            "ascent" => SourceType::Ascent,
            "outplayed" => SourceType::Outplayed,
            "steelseries" => SourceType::SteelSeries,
            "xbox" => SourceType::Xbox,
            _ => SourceType::Custom,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum CollectionKind {
    #[serde(rename = "manual")]
    Manual,
    #[serde(rename = "smart")]
    Smart,
}

impl CollectionKind {
    pub fn as_str(self) -> &'static str {
        match self {
            CollectionKind::Manual => "manual",
            CollectionKind::Smart => "smart",
        }
    }

    pub fn from_str_lossy(value: &str) -> Self {
        match value {
            "smart" => CollectionKind::Smart,
            _ => CollectionKind::Manual,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ExportPreset {
    #[serde(rename = "discord_10mb")]
    Discord10mb,
    #[serde(rename = "discord_25mb")]
    Discord25mb,
    #[serde(rename = "lossless_trim")]
    LosslessTrim,
    #[serde(rename = "vertical_blur_9_16")]
    VerticalBlur916,
    #[serde(rename = "vertical_crop_9_16")]
    VerticalCrop916,
}

impl ExportPreset {
    pub fn as_str(self) -> &'static str {
        match self {
            ExportPreset::Discord10mb => "discord_10mb",
            ExportPreset::Discord25mb => "discord_25mb",
            ExportPreset::LosslessTrim => "lossless_trim",
            ExportPreset::VerticalBlur916 => "vertical_blur_9_16",
            ExportPreset::VerticalCrop916 => "vertical_crop_9_16",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchFolder {
    pub id: String,
    pub path: String,
    pub source_type: SourceType,
    pub enabled: bool,
    pub last_scanned_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GameSummary {
    pub id: String,
    pub raw_name: String,
    pub display_name: String,
    pub clip_count: i64,
    pub total_size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TagItem {
    pub id: String,
    pub name: String,
    pub color: Option<String>,
    pub clip_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrack {
    pub id: String,
    pub clip_id: String,
    pub stream_index: i32,
    pub track_order: i32,
    pub label: String,
    pub codec: String,
    pub channels: i32,
    pub sample_rate: i32,
    pub bitrate: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipSummary {
    pub id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size_bytes: i64,
    pub source_type: SourceType,
    pub game_id: Option<String>,
    pub game_name: String,
    pub recorded_at: String,
    pub duration_sec: f64,
    pub width: i32,
    pub height: i32,
    pub fps: f64,
    pub video_codec: String,
    pub audio_track_count: i32,
    pub is_favorite: bool,
    pub is_pinned: bool,
    pub title: Option<String>,
    pub thumb_url: String,
    pub collection_count: i64,
    pub tags: Vec<String>,
    pub is_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipDetail {
    pub clip: ClipSummary,
    pub notes: Option<String>,
    pub audio_tracks: Vec<AudioTrack>,
    pub collection_ids: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SmartField {
    #[serde(rename = "game")]
    Game,
    #[serde(rename = "tag")]
    Tag,
    #[serde(rename = "title_or_filename")]
    TitleOrFilename,
    #[serde(rename = "duration_sec")]
    DurationSec,
    #[serde(rename = "is_favorite")]
    IsFavorite,
    #[serde(rename = "recorded_within_days")]
    RecordedWithinDays,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SmartOp {
    #[serde(rename = "equals")]
    Equals,
    #[serde(rename = "not_equals")]
    NotEquals,
    #[serde(rename = "contains")]
    Contains,
    #[serde(rename = "includes")]
    Includes,
    #[serde(rename = "lte")]
    Lte,
    #[serde(rename = "gte")]
    Gte,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum SmartMatch {
    #[serde(rename = "all")]
    All,
    #[serde(rename = "any")]
    Any,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartRuleCondition {
    pub field: SmartField,
    pub op: SmartOp,
    pub value: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SmartRules {
    #[serde(rename = "match")]
    pub match_mode: SmartMatch,
    pub conditions: Vec<SmartRuleCondition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CollectionSummary {
    pub id: String,
    pub name: String,
    pub kind: CollectionKind,
    pub icon: Option<String>,
    pub color: Option<String>,
    pub smart_rules: Option<SmartRules>,
    pub clip_count: i64,
    pub total_size_bytes: i64,
    pub sort_order: i32,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub max_storage_gb: f64,
    pub hardlink_base_dir: String,
    pub export_output_dir: String,
    pub auto_copy_export_to_clipboard: bool,
    pub default_auto_next: bool,
    #[serde(default)]
    pub minimize_to_tray: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryStats {
    pub total_clips: i64,
    pub total_favorites: i64,
    pub total_size_bytes: i64,
    pub games_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BootstrapState {
    pub streamer_base_url: String,
    pub streamer_token: String,
    pub watch_folders: Vec<WatchFolder>,
    pub has_nvenc: bool,
    pub has_amf: bool,
    pub has_qsv: bool,
    pub hardware_encoder: Option<String>,
    pub ffmpeg_available: bool,
    pub stats: LibraryStats,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum DetectSource {
    #[serde(rename = "registry")]
    Registry,
    #[serde(rename = "default")]
    Default,
    #[serde(rename = "none")]
    None,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectNvidiaResult {
    pub found: bool,
    pub path: Option<String>,
    pub source: DetectSource,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedRecorder {
    pub id: String,
    pub label: String,
    pub source_type: SourceType,
    pub found: bool,
    pub path: Option<String>,
    pub source: DetectSource,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum ClipSortBy {
    #[serde(rename = "recorded_desc")]
    RecordedDesc,
    #[serde(rename = "recorded_asc")]
    RecordedAsc,
    #[serde(rename = "size_desc")]
    SizeDesc,
    #[serde(rename = "duration_desc")]
    DurationDesc,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListClipsQuery {
    pub game_id: Option<String>,
    pub collection_id: Option<String>,
    pub tag_names: Option<Vec<String>>,
    pub search: Option<String>,
    pub favorites_only: Option<bool>,
    #[serde(default)]
    pub min_duration_sec: Option<f64>,
    pub max_duration_sec: Option<f64>,
    pub sort_by: Option<ClipSortBy>,
    pub limit: Option<i64>,
    pub offset: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListClipsResult {
    pub items: Vec<ClipSummary>,
    pub total: i64,
    pub total_size_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioTrackMix {
    pub track_order: i32,
    pub stream_index: i32,
    pub muted: bool,
    pub volume: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AspectMode {
    #[default]
    Original,
    #[serde(rename = "stretch_16_9")]
    Stretch169,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartExportRequest {
    pub clip_id: String,
    pub preset: ExportPreset,
    pub start_sec: f64,
    pub end_sec: f64,
    pub audio_mix: Vec<AudioTrackMix>,
    pub copy_to_clipboard: bool,
    #[serde(default)]
    pub aspect_mode: AspectMode,
    #[serde(default)]
    pub normalize_audio: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveTrimmedClipRequest {
    pub clip_id: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub title: Option<String>,
    #[serde(default)]
    pub audio_mix: Vec<AudioTrackMix>,
    pub collection_ids: Option<Vec<String>>,
    #[serde(default)]
    pub aspect_mode: AspectMode,
    #[serde(default)]
    pub normalize_audio: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeClipsRequest {
    pub clip_ids: Vec<String>,
    pub output_name: Option<String>,
    #[serde(default)]
    pub aspect_mode: AspectMode,
    #[serde(default)]
    pub normalize_audio: bool,
    #[serde(default)]
    pub copy_to_clipboard: bool,
    #[serde(default)]
    pub add_to_library: bool,
}

fn default_editor_vibrance() -> f64 {
    0.0
}

fn default_editor_saturation() -> f64 {
    100.0
}

fn default_editor_framing() -> String {
    "fit".to_string()
}

fn default_transition_cut() -> String {
    "cut".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorSegmentInput {
    pub clip_id: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub speed: f64,
    #[serde(default)]
    pub audio_mix: Vec<AudioTrackMix>,
    pub master_volume: f64,
    #[serde(default)]
    pub master_muted: bool,
    pub transition_in: String,
    #[serde(default)]
    pub crossfade_duration_sec: f64,
    #[serde(default)]
    pub transition_in_duration_sec: Option<f64>,
    #[serde(default = "default_transition_cut")]
    pub transition_out: String,
    #[serde(default)]
    pub transition_out_duration_sec: f64,
    #[serde(default = "default_editor_vibrance")]
    pub vibrance: f64,
    #[serde(default = "default_editor_saturation")]
    pub saturation: f64,
    #[serde(default = "default_editor_framing")]
    pub framing: String,
}

fn default_audio_volume() -> f64 {
    100.0
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbedAudioFile {
    pub file_path: String,
    pub title: String,
    pub duration_sec: f64,
    pub codec: String,
    pub sample_rate: i32,
    pub channels: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorAudioLayerInput {
    pub file_path: String,
    #[serde(default)]
    pub timeline_offset_sec: f64,
    #[serde(default)]
    pub trim_start_sec: f64,
    pub trim_end_sec: f64,
    #[serde(default = "default_audio_volume")]
    pub volume: f64,
    #[serde(default)]
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorAudioLayerData {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub duration_sec: f64,
    #[serde(default)]
    pub timeline_offset_sec: f64,
    #[serde(default)]
    pub trim_start_sec: f64,
    pub trim_end_sec: f64,
    #[serde(default = "default_audio_volume")]
    pub volume: f64,
    #[serde(default)]
    pub muted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorAudioLayer {
    pub id: String,
    pub file_path: String,
    pub title: String,
    pub duration_sec: f64,
    pub timeline_offset_sec: f64,
    pub trim_start_sec: f64,
    pub trim_end_sec: f64,
    pub volume: f64,
    pub muted: bool,
    #[serde(default)]
    pub is_missing: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingProjectAudioLayer {
    pub layer_id: String,
    pub title: String,
    pub file_path: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartEditorExportRequest {
    pub segments: Vec<EditorSegmentInput>,
    #[serde(default)]
    pub audio_layers: Vec<EditorAudioLayerInput>,
    pub preset: String,
    pub vertical_style: String,
    #[serde(default)]
    pub normalize_audio: bool,
    #[serde(default)]
    pub copy_to_clipboard: bool,
    #[serde(default)]
    pub add_to_library: bool,
    #[serde(default)]
    pub output_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HardlinkExportResult {
    pub folder_path: String,
    pub linked_count: i64,
    pub skipped_count: i64,
    pub cross_drive_clips: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCleanupPreview {
    pub total_size_bytes: i64,
    pub max_storage_bytes: i64,
    pub reclaimable_bytes: i64,
    pub candidates: Vec<ClipSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageCleanupResult {
    pub removed_count: i64,
    pub freed_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OkResult {
    pub ok: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueuedCountResult {
    pub queued_count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeleteClipsResult {
    pub removed_count: i64,
    pub freed_bytes: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModifyCollectionClipsResult {
    pub count: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartExportResult {
    pub job_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanProgressEvent {
    pub scanned: i64,
    pub total: i64,
    pub current_file: String,
    pub done: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipIdEvent {
    pub clip_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgressEvent {
    pub job_id: String,
    pub percent: f64,
    pub eta_sec: Option<f64>,
    pub speed: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportCompletedEvent {
    pub job_id: String,
    pub output_path: String,
    pub output_size_bytes: i64,
    pub copied_to_clipboard: bool,
    pub encoder_used: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFailedEvent {
    pub job_id: String,
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WaveformResponse {
    pub peaks: Vec<f32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetThumbnailResult {
    pub clip_id: String,
    pub thumb_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotResult {
    pub output_path: String,
    pub file_name: String,
    pub copied_to_clipboard: bool,
}

fn default_editor_project_version() -> u32 {
    1
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorProjectSummary {
    pub id: String,
    pub name: String,
    pub segment_count: i64,
    pub total_duration_sec: f64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorClipSnapshot {
    pub title: Option<String>,
    pub file_name: String,
    pub duration_sec: f64,
    pub game_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorExportOptions {
    pub preset: String,
    pub vertical916: bool,
    pub vertical_style: String,
    #[serde(default)]
    pub normalize_audio: bool,
    #[serde(default)]
    pub copy_to_clipboard: bool,
    #[serde(default)]
    pub add_to_library: bool,
    #[serde(default)]
    pub output_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorProjectSegmentData {
    pub id: String,
    pub clip_id: String,
    pub start_sec: f64,
    pub end_sec: f64,
    pub speed: f64,
    #[serde(default)]
    pub audio_mix: Vec<AudioTrackMix>,
    pub master_volume: f64,
    #[serde(default)]
    pub master_muted: bool,
    pub transition_in: String,
    #[serde(default)]
    pub transition_in_duration_sec: Option<f64>,
    #[serde(default = "default_transition_cut")]
    pub transition_out: String,
    #[serde(default)]
    pub transition_out_duration_sec: f64,
    #[serde(default = "default_editor_vibrance")]
    pub vibrance: f64,
    #[serde(default = "default_editor_saturation")]
    pub saturation: f64,
    #[serde(default = "default_editor_framing")]
    pub framing: String,
    #[serde(default)]
    pub clip_snapshot: Option<EditorClipSnapshot>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorProjectPayload {
    #[serde(default = "default_editor_project_version")]
    pub version: u32,
    #[serde(default)]
    pub segments: Vec<EditorProjectSegmentData>,
    #[serde(default)]
    pub audio_layers: Vec<EditorAudioLayerData>,
    pub export_options: EditorExportOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveEditorProjectRequest {
    pub id: Option<String>,
    pub name: String,
    pub segment_count: i64,
    pub total_duration_sec: f64,
    pub data: EditorProjectPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MissingProjectSegment {
    pub segment_index: usize,
    pub clip_id: String,
    pub title: String,
    pub file_name: String,
    pub reason: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorProjectSegment {
    pub id: String,
    pub clip_id: String,
    pub clip: ClipSummary,
    pub start_sec: f64,
    pub end_sec: f64,
    pub speed: f64,
    pub audio_mix: Vec<AudioTrackMix>,
    pub master_volume: f64,
    pub master_muted: bool,
    pub transition_in: String,
    pub transition_in_duration_sec: f64,
    pub transition_out: String,
    pub transition_out_duration_sec: f64,
    pub vibrance: f64,
    pub saturation: f64,
    pub framing: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EditorProjectDetail {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub updated_at: String,
    pub segments: Vec<EditorProjectSegment>,
    pub audio_layers: Vec<EditorAudioLayer>,
    pub export_options: EditorExportOptions,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadEditorProjectResult {
    pub project: EditorProjectDetail,
    pub missing_segments: Vec<MissingProjectSegment>,
    pub missing_audio_layers: Vec<MissingProjectAudioLayer>,
}

#[cfg(test)]
mod tests {
    use super::{AppSettings, EditorSegmentInput};

    #[test]
    fn app_settings_minimize_to_tray_defaults_to_false() {
        let json = r#"{
            "maxStorageGb": 200.0,
            "hardlinkBaseDir": "C:\\Clips\\Hardlinks",
            "exportOutputDir": "C:\\Clips\\Exports",
            "autoCopyExportToClipboard": true,
            "defaultAutoNext": false
        }"#;

        let parsed: AppSettings = serde_json::from_str(json).expect("deserialize AppSettings");
        assert!(!parsed.minimize_to_tray);

        let serialized = serde_json::to_string(&parsed).expect("serialize AppSettings");
        assert!(serialized.contains("\"minimizeToTray\":false"));
    }

    #[test]
    fn editor_segment_input_v1_json_uses_v2_defaults() {
        let json = r#"{
            "clipId": "clip-1",
            "startSec": 0.5,
            "endSec": 3.5,
            "speed": 1.0,
            "masterVolume": 100.0,
            "transitionIn": "cut"
        }"#;

        let parsed: EditorSegmentInput =
            serde_json::from_str(json).expect("deserialize v1 EditorSegmentInput");
        assert!((parsed.vibrance - 0.0).abs() < f64::EPSILON);
        assert!((parsed.saturation - 100.0).abs() < f64::EPSILON);
        assert_eq!(parsed.framing, "fit");
        assert!(parsed.transition_in_duration_sec.is_none());
        assert_eq!(parsed.transition_out, "cut");
        assert!((parsed.transition_out_duration_sec - 0.0).abs() < f64::EPSILON);
    }
}
