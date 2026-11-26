# Glint IPC & Local Streamer Contract (v1.0)

Kontrak tunggal antara **Rust Backend (`src-tauri/src/**`)** dan **React Frontend (`src/**`)**.
Semua struct JSON Rust WAJIB memakai `#[serde(rename_all = "camelCase")]`.

---

## 1. Local HTTP Streamer Endpoints (Jalur 1)

Base URL dan session token diambil dari `get_bootstrap_state`:
- `streamerBaseUrl`: contoh `http://127.0.0.1:54321`
- `streamerToken`: random 64-char hex token per sesi

Semua endpoint mewajibkan `?token=<streamerToken>` (status `401` jika tidak cocok) dan mengembalikan header `Access-Control-Allow-Origin: *` agar Web Audio API / `<video>` berjalan mulus di WebView2.

1. `GET /video/{clipId}?token=...`
   - Mendukung HTTP `Range` (`206 Partial Content`, `Accept-Ranges: bytes`).
   - `.mp4` / `.mov` / `.webm`: dilayani langsung dari file asli (zero-copy).
   - `.mkv`: remux on-the-fly ke fragmented MP4 (`ffmpeg -i input -c:v copy -c:a aac -movflags frag_keyframe+empty_moov -f mp4 pipe:1`).
2. `GET /audio/{clipId}/{trackOrder}?token=...`
   - `trackOrder` berbasis 0 (`0`, `1`, `2`, ... sesuai urutan `AudioTrack.trackOrder`).
   - Mengekstrak dan menyimpan cache `.m4a` ringan di `%LOCALAPPDATA%\Glint\cache\audio\{clipId}_{trackOrder}.m4a`, lalu melayaninya dengan dukungan HTTP `Range`.
3. `GET /thumb/{clipId}?token=...`
   - Mengembalikan gambar thumbnail WebP/JPEG (`480px` lebar) dari cache `%LOCALAPPDATA%\Glint\cache\thumbs\{clipId}.jpg` (generate on-demand jika belum ada).
4. `GET /waveform/{clipId}/{trackOrder}?token=...`
   - Mengembalikan JSON `{ "peaks": number[] }` (160 sampai 200 nilai float `0.0..1.0` untuk visualisasi gelombang audio di trim bar).

---

## 2. TypeScript / Rust Shared Types (`camelCase`)

```ts
export type SourceType = "nvidia" | "obs" | "steam" | "custom";
export type CollectionKind = "manual" | "smart";
export type ExportPreset = "discord_10mb" | "discord_25mb" | "lossless_trim";
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

export interface SmartRuleCondition {
  field: "game" | "tag" | "title_or_filename" | "duration_sec" | "is_favorite" | "recorded_within_days";
  op: "equals" | "not_equals" | "contains" | "includes" | "lte" | "gte";
  value: string | number | boolean;
}

export interface SmartRules {
  match: "all" | "any";
  conditions: SmartRuleCondition[];
}

export interface CollectionSummary {
  id: string;
  name: string;
  kind: CollectionKind;
  icon: string | null;
  color: string | null;
  smartRules: SmartRules | null;
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
  ffmpegAvailable: boolean;
  stats: LibraryStats;
  settings: AppSettings;
}

export interface DetectNvidiaResult {
  found: boolean;
  path: string | null;
  source: "registry" | "default" | "none";
}

export interface ListClipsQuery {
  gameId?: string | null;
  collectionId?: string | null;
  tagNames?: string[] | null;
  search?: string | null;
  favoritesOnly?: boolean;
  minDurationSec?: number | null;
  maxDurationSec?: number | null;
  sortBy?: "recorded_desc" | "recorded_asc" | "size_desc" | "duration_desc";
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
  volume: number; // 0.0 to 2.0 (1.0 = 100%)
}

export interface StartExportRequest {
  clipId: string;
  preset: ExportPreset;
  startSec: number;
  endSec: number;
  audioMix: AudioTrackMix[];
  copyToClipboard: boolean;
  aspectMode?: AspectMode;
}

export interface SaveTrimmedClipRequest {
  clipId: string;
  startSec: number;
  endSec: number;
  title?: string | null;
  audioMix: AudioTrackMix[];
  collectionIds?: string[] | null;
  aspectMode?: AspectMode;
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
```

---

## 3. Tauri Commands (`invoke`)

Catatan penting Tauri v2: parameter Rust `fn foo(req: MyReq)` dipanggil dari TS sebagai `invoke("foo", { req })`, atau jika parameter tunggal pakai nama `input` / parameter flat. Untuk konsistensi 100%, gunakan persis signature berikut:

| Command Name | JS Invoke Arguments | Return Type |
| :--- | :--- | :--- |
| `get_bootstrap_state` | `{}` | `BootstrapState` |
| `detect_nvidia_folder` | `{}` | `DetectNvidiaResult` |
| `add_watch_folder` | `{ path: string, sourceType: SourceType }` | `WatchFolder` |
| `remove_watch_folder` | `{ folderId: string }` | `{ ok: boolean }` |
| `toggle_watch_folder` | `{ folderId: string, enabled: boolean }` | `WatchFolder` |
| `scan_watch_folders` | `{ folderId?: string \| null }` | `{ queuedCount: number }` |
| `list_games` | `{}` | `GameSummary[]` |
| `list_tags` | `{}` | `TagItem[]` |
| `list_clips` | `{ query: ListClipsQuery }` | `ListClipsResult` |
| `get_clip_detail` | `{ clipId: string }` | `ClipDetail` |
| `update_clip_meta` | `{ clipId: string, title?: string \| null, notes?: string \| null, isFavorite?: boolean \| null, isPinned?: boolean \| null, tagNames?: string[] \| null }` | `ClipDetail` |
| `delete_clips` | `{ clipIds: string[] }` | `{ removedCount: number, freedBytes: number }` |
| `list_collections` | `{}` | `CollectionSummary[]` |
| `create_collection` | `{ name: string, kind: CollectionKind, icon?: string \| null, color?: string \| null, smartRules?: SmartRules \| null }` | `CollectionSummary` |
| `update_collection` | `{ id: string, name?: string \| null, icon?: string \| null, color?: string \| null, smartRules?: SmartRules \| null }` | `CollectionSummary` |
| `delete_collection` | `{ id: string }` | `{ ok: boolean }` |
| `modify_collection_clips` | `{ collectionId: string, addClipIds?: string[] \| null, removeClipIds?: string[] \| null }` | `{ count: number }` |
| `export_collection_hardlinks` | `{ collectionId: string, targetDir?: string \| null }` | `HardlinkExportResult` |
| `start_export` | `{ request: StartExportRequest }` | `{ jobId: string }` |
| `save_trimmed_clip` | `{ request: SaveTrimmedClipRequest }` | `ClipDetail` |
| `cancel_export` | `{ jobId: string }` | `{ ok: boolean }` |
| `copy_file_to_clipboard` | `{ filePath: string }` | `{ ok: boolean }` |
| `open_in_explorer` | `{ filePath: string }` | `{ ok: boolean }` |
| `get_storage_cleanup_preview` | `{ maxGb: number }` | `StorageCleanupPreview` |
| `run_storage_cleanup` | `{ clipIds: string[] }` | `StorageCleanupResult` |
| `get_settings` | `{}` | `AppSettings` |
| `update_settings` | `{ settings: AppSettings }` | `AppSettings` |

---

## 4. Tauri Events (`listen`)

| Event Name | Payload (`camelCase`) |
| :--- | :--- |
| `scan:progress` | `{ scanned: number, total: number, currentFile: string, done: boolean }` |
| `clip:added` | `{ clipId: string }` |
| `clip:removed` | `{ clipId: string }` |
| `export:progress` | `{ jobId: string, percent: number, etaSec: number \| null, speed: string \| null }` |
| `export:completed` | `{ jobId: string, outputPath: string, outputSizeBytes: number, copiedToClipboard: boolean, encoderUsed: string }` |
| `export:failed` | `{ jobId: string, error: string }` |
