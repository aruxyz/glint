export type SourceType =
  | "nvidia"
  | "amd_relive"
  | "obs"
  | "steam"
  | "medal"
  | "ascent"
  | "outplayed"
  | "steelseries"
  | "xbox"
  | "custom";
export type CollectionKind = "manual" | "smart";
export type ExportPreset =
  | "discord_10mb"
  | "discord_25mb"
  | "lossless_trim"
  | "vertical_blur_9_16"
  | "vertical_crop_9_16";
export type AspectMode = "original" | "stretch_16_9";

export interface WatchFolder {
  id: string;
  path: string;
  sourceType: SourceType;
  enabled: boolean;
  lastScannedAt: string | null;
}

export interface GameSummary {
  id: string;
  rawName: string;
  displayName: string;
  clipCount: number;
  totalSizeBytes: number;
}

export interface TagItem {
  id: string;
  name: string;
  color: string | null;
  clipCount: number;
}

export interface AudioTrack {
  id: string;
  clipId: string;
  streamIndex: number;
  trackOrder: number;
  label: string;
  codec: string;
  channels: number;
  sampleRate: number;
  bitrate: number | null;
}

export interface ClipSummary {
  id: string;
  filePath: string;
  fileName: string;
  fileSizeBytes: number;
  sourceType: SourceType;
  gameId: string | null;
  gameName: string;
  recordedAt: string;
  durationSec: number;
  width: number;
  height: number;
  fps: number;
  videoCodec: string;
  audioTrackCount: number;
  isFavorite: boolean;
  isPinned: boolean;
  title: string | null;
  thumbUrl: string;
  collectionCount: number;
  tags: string[];
  isMissing: boolean;
}

export interface ClipDetail {
  clip: ClipSummary;
  notes: string | null;
  audioTracks: AudioTrack[];
  collectionIds: string[];
}

export interface CollectionSummary {
  id: string;
  name: string;
  kind: CollectionKind;
  icon: string | null;
  color: string | null;
  smartRules?: unknown | null;
  clipCount: number;
  totalSizeBytes: number;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface AppSettings {
  maxStorageGb: number;
  hardlinkBaseDir: string;
  exportOutputDir: string;
  autoCopyExportToClipboard: boolean;
  defaultAutoNext: boolean;
  minimizeToTray: boolean;
}

export interface LibraryStats {
  totalClips: number;
  totalFavorites: number;
  totalSizeBytes: number;
  gamesCount: number;
}

export interface BootstrapState {
  streamerBaseUrl: string;
  streamerToken: string;
  watchFolders: WatchFolder[];
  hasNvenc: boolean;
  hasAmf?: boolean;
  hasQsv?: boolean;
  hardwareEncoder?: string | null;
  ffmpegAvailable: boolean;
  stats: LibraryStats;
  settings: AppSettings;
}

export interface DetectedRecorder {
  id: string;
  label: string;
  sourceType: SourceType;
  found: boolean;
  path: string | null;
  source: "registry" | "default" | "none";
}

export interface DetectNvidiaResult {
  found: boolean;
  path: string | null;
  source: "registry" | "default" | "none";
}

export interface SetClipThumbnailResult {
  clipId: string;
  thumbUrl: string;
}

export interface CaptureFrameSnapshotRequest {
  clipId: string;
  timeSec: number;
  aspectMode?: AspectMode;
  copyToClipboard: boolean;
}

export interface CaptureFrameSnapshotResult {
  outputPath: string;
  fileName: string;
  copiedToClipboard: boolean;
}

export type ClipSortBy = "recorded_desc" | "recorded_asc" | "size_desc" | "duration_desc";

export interface ListClipsQuery {
  gameId?: string | null;
  collectionId?: string | null;
  tagNames?: string[] | null;
  search?: string | null;
  favoritesOnly?: boolean;
  minDurationSec?: number | null;
  maxDurationSec?: number | null;
  sortBy?: ClipSortBy;
  limit?: number;
  offset?: number;
}

export interface ListClipsResult {
  items: ClipSummary[];
  total: number;
  totalSizeBytes: number;
}

export interface AudioTrackMix {
  trackOrder: number;
  streamIndex: number;
  muted: boolean;
  volume: number;
}

export interface StartExportRequest {
  clipId: string;
  preset: ExportPreset;
  startSec: number;
  endSec: number;
  audioMix: AudioTrackMix[];
  copyToClipboard: boolean;
  aspectMode?: AspectMode;
  normalizeAudio?: boolean;
}

export interface SaveTrimmedClipRequest {
  clipId: string;
  startSec: number;
  endSec: number;
  title?: string | null;
  audioMix: AudioTrackMix[];
  collectionIds?: string[] | null;
  aspectMode?: AspectMode;
  normalizeAudio?: boolean;
}

export interface MergeClipsRequest {
  clipIds: string[];
  outputName?: string | null;
  aspectMode?: AspectMode;
  normalizeAudio?: boolean;
  copyToClipboard: boolean;
  addToLibrary: boolean;
}

export interface HardlinkExportResult {
  folderPath: string;
  linkedCount: number;
  skippedCount: number;
  crossDriveClips: number;
}

export interface StorageCleanupPreview {
  totalSizeBytes: number;
  maxStorageBytes: number;
  reclaimableBytes: number;
  candidates: ClipSummary[];
}

export interface StorageCleanupResult {
  removedCount: number;
  freedBytes: number;
}

export interface ScanProgressPayload {
  scanned: number;
  total: number;
  currentFile: string;
  done: boolean;
}

export interface ClipEventPayload {
  clipId: string;
}

export interface ExportProgressPayload {
  jobId: string;
  percent: number;
  etaSec: number | null;
  speed: string | null;
}

export interface ExportCompletedPayload {
  jobId: string;
  outputPath: string;
  outputSizeBytes: number;
  copiedToClipboard: boolean;
  encoderUsed: string;
}

export interface ExportFailedPayload {
  jobId: string;
  error: string;
}

export interface WaveformResponse {
  peaks: number[];
}

export type DurationFilterPreset = "any" | "under_30" | "30_to_120" | "over_120";

export type NavDestination =
  | { kind: "all" }
  | { kind: "favorites" }
  | { kind: "game"; gameId: string }
  | { kind: "collection"; collectionId: string };

export type EditorSpeed = 0.5 | 1 | 1.5 | 2;
export type EditorTransition = "cut" | "crossfade" | "fade";
export type EditorTransitionOut = "cut" | "fade";
export type EditorFraming = "fit" | "fill" | "stretch";
export type EditorExportPreset = "original" | "discord_10mb" | "discord_25mb";
export type EditorVerticalStyle = "blur" | "crop";
export type EditorWorkspaceTab = "segments" | "adjust" | "export";

export interface EditorSegment {
  id: string;
  clipId: string;
  clip: ClipSummary;
  startSec: number;
  endSec: number;
  speed: EditorSpeed;
  audioMix: AudioTrackMix[];
  masterVolume: number;
  masterMuted: boolean;
  transitionIn: EditorTransition;
  transitionInDurationSec: number;
  transitionOut: EditorTransitionOut;
  transitionOutDurationSec: number;
  vibrance: number;
  saturation: number;
  framing: EditorFraming;
}

export interface EditorExportOptions {
  preset: EditorExportPreset;
  vertical916: boolean;
  verticalStyle: EditorVerticalStyle;
  normalizeAudio: boolean;
  copyToClipboard: boolean;
  addToLibrary: boolean;
  outputName: string;
}

export interface EditorAudioLayer {
  id: string;
  filePath: string;
  title: string;
  durationSec: number;
  timelineOffsetSec: number;
  trimStartSec: number;
  trimEndSec: number;
  volume: number; // 0..200 (percent, default 100)
  muted: boolean;
  isMissing?: boolean;
}

export interface ProbedAudioFile {
  filePath: string;
  title: string;
  durationSec: number;
  codec: string;
  sampleRate: number;
  channels: number;
}

export interface EditorAudioLayerData {
  id: string;
  filePath: string;
  title: string;
  durationSec: number;
  timelineOffsetSec: number;
  trimStartSec: number;
  trimEndSec: number;
  volume: number;
  muted: boolean;
}

export interface MissingProjectAudioLayer {
  layerId: string;
  title: string;
  filePath: string;
  reason: "file_missing";
}

export interface EditorAudioLayerInput {
  filePath: string;
  timelineOffsetSec: number;
  trimStartSec: number;
  trimEndSec: number;
  volume: number;
  muted: boolean;
}

export interface StartEditorExportRequest {
  segments: Array<{
    clipId: string;
    startSec: number;
    endSec: number;
    speed: EditorSpeed;
    audioMix: AudioTrackMix[];
    masterVolume: number;
    masterMuted: boolean;
    transitionIn: EditorTransition;
    transitionInDurationSec: number;
    crossfadeDurationSec: number;
    transitionOut: EditorTransitionOut;
    transitionOutDurationSec: number;
    vibrance: number;
    saturation: number;
    framing: EditorFraming;
  }>;
  audioLayers: EditorAudioLayerInput[];
  preset: EditorExportPreset;
  verticalStyle: EditorVerticalStyle | "none";
  normalizeAudio: boolean;
  copyToClipboard: boolean;
  addToLibrary: boolean;
  outputName?: string | null;
}

export interface EditorProjectSummary {
  id: string;
  name: string;
  segmentCount: number;
  totalDurationSec: number;
  createdAt: string;
  updatedAt: string;
}

export interface EditorClipSnapshot {
  title: string | null;
  fileName: string;
  durationSec: number;
  gameName: string;
}

export interface EditorProjectSegmentData {
  id: string;
  clipId: string;
  startSec: number;
  endSec: number;
  speed: EditorSpeed;
  audioMix: AudioTrackMix[];
  masterVolume: number;
  masterMuted: boolean;
  transitionIn: EditorTransition;
  transitionInDurationSec?: number;
  transitionOut?: EditorTransitionOut;
  transitionOutDurationSec?: number;
  vibrance: number;
  saturation: number;
  framing: EditorFraming;
  clipSnapshot?: EditorClipSnapshot;
}

export interface EditorProjectPayload {
  version: 1 | 2;
  segments: EditorProjectSegmentData[];
  audioLayers?: EditorAudioLayerData[];
  exportOptions: EditorExportOptions;
}

export interface SaveEditorProjectRequest {
  id?: string | null;
  name: string;
  segmentCount: number;
  totalDurationSec: number;
  data: EditorProjectPayload;
}

export interface MissingProjectSegment {
  segmentIndex: number;
  clipId: string;
  title: string;
  fileName: string;
  reason: "deleted" | "file_missing";
}

export interface EditorProjectDetail {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  segments: EditorSegment[];
  audioLayers: EditorAudioLayer[];
  exportOptions: EditorExportOptions;
}

export interface LoadEditorProjectResult {
  project: EditorProjectDetail;
  missingSegments: MissingProjectSegment[];
  missingAudioLayers: MissingProjectAudioLayer[];
}
