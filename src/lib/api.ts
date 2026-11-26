import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type {
  AppSettings,
  BootstrapState,
  CaptureFrameSnapshotRequest,
  CaptureFrameSnapshotResult,
  ClipDetail,
  ClipEventPayload,
  CollectionKind,
  CollectionSummary,
  DetectedRecorder,
  DetectNvidiaResult,
  EditorProjectPayload,
  EditorProjectSegmentData,
  EditorProjectSummary,
  EditorSegment,
  ExportCompletedPayload,
  ExportFailedPayload,
  ExportProgressPayload,
  GameSummary,
  HardlinkExportResult,
  ListClipsQuery,
  ListClipsResult,
  LoadEditorProjectResult,
  MergeClipsRequest,
  MissingProjectAudioLayer,
  MissingProjectSegment,
  ProbedAudioFile,
  SaveEditorProjectRequest,
  SaveTrimmedClipRequest,
  ScanProgressPayload,
  SetClipThumbnailResult,
  SourceType,
  StartEditorExportRequest,
  StartExportRequest,
  StorageCleanupPreview,
  StorageCleanupResult,
  TagItem,
  WatchFolder,
} from "./types";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

// Browser preview fallback keeps the app interactive in vite dev without Tauri.
const browserState: {
  watchFolders: WatchFolder[];
  collections: CollectionSummary[];
  settings: AppSettings;
} = {
  watchFolders: [],
  collections: [],
  settings: {
    maxStorageGb: 0,
    hardlinkBaseDir: "",
    exportOutputDir: "",
    autoCopyExportToClipboard: true,
    defaultAutoNext: true,
    minimizeToTray: false,
  },
};

const browserAudioTitles = new Map<string, string>();
const BROWSER_EDITOR_PROJECTS_KEY = "glint_browser_editor_projects_v1";

interface StoredBrowserEditorProject {
  id: string;
  name: string;
  segmentCount: number;
  totalDurationSec: number;
  createdAt: string;
  updatedAt: string;
  data: EditorProjectPayload;
}

function readBrowserEditorProjects(): StoredBrowserEditorProject[] {
  try {
    const raw = window.localStorage.getItem(BROWSER_EDITOR_PROJECTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeBrowserEditorProjects(projects: StoredBrowserEditorProject[]): void {
  window.localStorage.setItem(BROWSER_EDITOR_PROJECTS_KEY, JSON.stringify(projects));
}

function rehydrateBrowserSegment(segData: EditorProjectSegmentData): EditorSegment {
  const snap = segData.clipSnapshot;
  const durationSec = Math.max(
    0.25,
    snap?.durationSec ?? segData.endSec ?? 10
  );
  const fileName = snap?.fileName || `${segData.clipId}.mp4`;
  return {
    id: segData.id || makeId("seg"),
    clipId: segData.clipId,
    clip: {
      id: segData.clipId,
      filePath: fileName,
      fileName,
      fileSizeBytes: 0,
      sourceType: "custom",
      gameId: null,
      gameName: snap?.gameName || "Clip",
      recordedAt: new Date().toISOString(),
      durationSec,
      width: 1920,
      height: 1080,
      fps: 60,
      videoCodec: "h264",
      audioTrackCount: Math.max(1, segData.audioMix?.length || 1),
      isFavorite: false,
      isPinned: false,
      title: snap?.title ?? null,
      thumbUrl: "",
      collectionCount: 0,
      tags: [],
      isMissing: false,
    },
    startSec: Math.max(0, Math.min(segData.startSec, durationSec - 0.25)),
    endSec: Math.max(
      Math.min(segData.startSec, durationSec - 0.25) + 0.25,
      Math.min(durationSec, segData.endSec)
    ),
    speed: segData.speed ?? 1,
    audioMix: Array.isArray(segData.audioMix)
      ? segData.audioMix.map((m) => ({ ...m }))
      : [{ trackOrder: 0, streamIndex: 0, muted: false, volume: 1 }],
    masterVolume: segData.masterVolume ?? 100,
    masterMuted: Boolean(segData.masterMuted),
    transitionIn: segData.transitionIn ?? "cut",
    transitionInDurationSec:
      typeof segData.transitionInDurationSec === "number"
        ? segData.transitionInDurationSec
        : segData.transitionIn === "crossfade"
          ? 0.35
          : 0,
    transitionOut: segData.transitionOut === "fade" ? "fade" : "cut",
    transitionOutDurationSec:
      typeof segData.transitionOutDurationSec === "number"
        ? segData.transitionOutDurationSec
        : 0,
    vibrance: segData.vibrance ?? 0,
    saturation: segData.saturation ?? 100,
    framing: segData.framing ?? "fit",
  };
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export const api = {
  async getBootstrapState(): Promise<BootstrapState> {
    if (!isTauriRuntime()) {
      return {
        streamerBaseUrl: "",
        streamerToken: "",
        watchFolders: [...browserState.watchFolders],
        hasNvenc: false,
        hasAmf: false,
        hasQsv: false,
        hardwareEncoder: null,
        ffmpegAvailable: false,
        stats: {
          totalClips: 0,
          totalFavorites: 0,
          totalSizeBytes: 0,
          gamesCount: 0,
        },
        settings: { ...browserState.settings },
      };
    }
    const boot = await invoke<BootstrapState>("get_bootstrap_state", {});
    return {
      ...boot,
      hasAmf: Boolean(boot.hasAmf),
      hasQsv: Boolean(boot.hasQsv),
      hardwareEncoder: boot.hardwareEncoder ?? null,
      settings: {
        ...boot.settings,
        minimizeToTray: Boolean(boot.settings?.minimizeToTray),
      },
    };
  },

  async detectAllRecorders(): Promise<DetectedRecorder[]> {
    if (!isTauriRuntime()) {
      const defaults: Array<{
        id: string;
        label: string;
        sourceType: SourceType;
      }> = [
        { id: "nvidia", label: "NVIDIA ShadowPlay", sourceType: "nvidia" },
        { id: "amd_relive", label: "AMD Radeon ReLive", sourceType: "amd_relive" },
        { id: "obs", label: "OBS Studio", sourceType: "obs" },
        { id: "steam", label: "Steam Game Recording", sourceType: "steam" },
        { id: "medal", label: "Medal.tv", sourceType: "medal" },
        { id: "ascent", label: "Ascent.gg", sourceType: "ascent" },
      ];
      return defaults.map((entry) => {
        const matched = browserState.watchFolders.find(
          (wf) => wf.sourceType === entry.sourceType
        );
        return {
          id: entry.id,
          label: entry.label,
          sourceType: entry.sourceType,
          found: Boolean(matched),
          path: matched?.path ?? null,
          source: matched ? "default" : "none",
        };
      });
    }

    try {
      const detected = await invoke<DetectedRecorder[]>("detect_all_recorders", {});
      if (Array.isArray(detected)) return detected;
    } catch {
      // Fallback to legacy individual detector commands on older runtimes.
    }

    const [nvRes, obsRes, steamRes] = await Promise.allSettled([
      api.detectNvidiaFolder(),
      api.detectObsFolder(),
      api.detectSteamRecordingsFolder(),
    ]);
    const nv =
      nvRes.status === "fulfilled"
        ? nvRes.value
        : { found: false, path: null, source: "none" as const };
    const obs =
      obsRes.status === "fulfilled"
        ? obsRes.value
        : { found: false, path: null, source: "none" as const };
    const steam =
      steamRes.status === "fulfilled"
        ? steamRes.value
        : { found: false, path: null, source: "none" as const };

    return [
      {
        id: "nvidia",
        label: "NVIDIA ShadowPlay",
        sourceType: "nvidia",
        found: nv.found,
        path: nv.path,
        source: nv.source,
      },
      {
        id: "obs",
        label: "OBS Studio",
        sourceType: "obs",
        found: obs.found,
        path: obs.path,
        source: obs.source,
      },
      {
        id: "steam",
        label: "Steam Game Recording",
        sourceType: "steam",
        found: steam.found,
        path: steam.path,
        source: steam.source,
      },
    ];
  },

  async detectNvidiaFolder(): Promise<DetectNvidiaResult> {
    if (!isTauriRuntime()) {
      return { found: false, path: null, source: "none" };
    }
    return invoke<DetectNvidiaResult>("detect_nvidia_folder", {});
  },

  async detectObsFolder(): Promise<DetectNvidiaResult> {
    if (!isTauriRuntime()) {
      return { found: false, path: null, source: "none" };
    }
    return invoke<DetectNvidiaResult>("detect_obs_folder", {});
  },

  async detectSteamRecordingsFolder(): Promise<DetectNvidiaResult> {
    if (!isTauriRuntime()) {
      return { found: false, path: null, source: "none" };
    }
    return invoke<DetectNvidiaResult>("detect_steam_recordings_folder", {});
  },

  async flushPendingClips(): Promise<{ queuedCount: number }> {
    if (!isTauriRuntime()) {
      return { queuedCount: 0 };
    }
    return invoke<{ queuedCount: number }>("flush_pending_clips", {});
  },

  async setClipThumbnail(
    clipId: string,
    timeSec: number
  ): Promise<SetClipThumbnailResult> {
    return invoke<SetClipThumbnailResult>("set_clip_thumbnail", {
      clipId,
      timeSec,
    });
  },

  async captureFrameSnapshot(
    request: CaptureFrameSnapshotRequest
  ): Promise<CaptureFrameSnapshotResult> {
    return invoke<CaptureFrameSnapshotResult>("capture_frame_snapshot", {
      clipId: request.clipId,
      timeSec: request.timeSec,
      aspectMode: request.aspectMode ?? "original",
      copyToClipboard: request.copyToClipboard,
    });
  },

  async addWatchFolder(path: string, sourceType: SourceType): Promise<WatchFolder> {
    if (!isTauriRuntime()) {
      const folder: WatchFolder = {
        id: makeId("wf"),
        path,
        sourceType,
        enabled: true,
        lastScannedAt: null,
      };
      browserState.watchFolders.push(folder);
      return folder;
    }
    return invoke<WatchFolder>("add_watch_folder", { path, sourceType });
  },

  async removeWatchFolder(folderId: string): Promise<{ ok: boolean }> {
    if (!isTauriRuntime()) {
      browserState.watchFolders = browserState.watchFolders.filter((f) => f.id !== folderId);
      return { ok: true };
    }
    return invoke<{ ok: boolean }>("remove_watch_folder", { folderId });
  },

  async toggleWatchFolder(folderId: string, enabled: boolean): Promise<WatchFolder> {
    if (!isTauriRuntime()) {
      const found = browserState.watchFolders.find((f) => f.id === folderId);
      if (!found) {
        throw new Error("Watch folder not found");
      }
      found.enabled = enabled;
      return { ...found };
    }
    return invoke<WatchFolder>("toggle_watch_folder", { folderId, enabled });
  },

  async scanWatchFolders(folderId?: string | null): Promise<{ queuedCount: number }> {
    if (!isTauriRuntime()) {
      return { queuedCount: 0 };
    }
    return invoke<{ queuedCount: number }>("scan_watch_folders", {
      folderId: folderId ?? null,
    });
  },

  async listGames(): Promise<GameSummary[]> {
    if (!isTauriRuntime()) return [];
    return invoke<GameSummary[]>("list_games", {});
  },

  async listTags(): Promise<TagItem[]> {
    if (!isTauriRuntime()) return [];
    return invoke<TagItem[]>("list_tags", {});
  },

  async listClips(query: ListClipsQuery): Promise<ListClipsResult> {
    if (!isTauriRuntime()) {
      return { items: [], total: 0, totalSizeBytes: 0 };
    }
    return invoke<ListClipsResult>("list_clips", { query });
  },

  async getClipDetail(clipId: string): Promise<ClipDetail> {
    return invoke<ClipDetail>("get_clip_detail", { clipId });
  },

  async updateClipMeta(params: {
    clipId: string;
    title?: string | null;
    notes?: string | null;
    isFavorite?: boolean | null;
    isPinned?: boolean | null;
    tagNames?: string[] | null;
  }): Promise<ClipDetail> {
    return invoke<ClipDetail>("update_clip_meta", {
      clipId: params.clipId,
      title: params.title ?? null,
      notes: params.notes ?? null,
      isFavorite: params.isFavorite ?? null,
      isPinned: params.isPinned ?? null,
      tagNames: params.tagNames ?? null,
    });
  },

  async deleteClips(clipIds: string[]): Promise<{ removedCount: number; freedBytes: number }> {
    if (!isTauriRuntime()) {
      return { removedCount: 0, freedBytes: 0 };
    }
    return invoke<{ removedCount: number; freedBytes: number }>("delete_clips", { clipIds });
  },

  async listCollections(): Promise<CollectionSummary[]> {
    if (!isTauriRuntime()) {
      return [...browserState.collections];
    }
    return invoke<CollectionSummary[]>("list_collections", {});
  },

  async createCollection(params: {
    name: string;
    kind: CollectionKind;
    icon?: string | null;
    color?: string | null;
  }): Promise<CollectionSummary> {
    if (!isTauriRuntime()) {
      const now = new Date().toISOString();
      const created: CollectionSummary = {
        id: makeId("col"),
        name: params.name,
        kind: params.kind,
        icon: params.icon ?? null,
        color: params.color ?? null,
        smartRules: null,
        clipCount: 0,
        totalSizeBytes: 0,
        sortOrder: browserState.collections.length,
        createdAt: now,
        updatedAt: now,
      };
      browserState.collections.push(created);
      return created;
    }
    return invoke<CollectionSummary>("create_collection", {
      name: params.name,
      kind: params.kind,
      icon: params.icon ?? null,
      color: params.color ?? null,
      smartRules: null,
    });
  },

  async updateCollection(params: {
    id: string;
    name?: string | null;
    icon?: string | null;
    color?: string | null;
  }): Promise<CollectionSummary> {
    if (!isTauriRuntime()) {
      const existing = browserState.collections.find((c) => c.id === params.id);
      if (!existing) throw new Error("Collection not found");
      if (params.name !== undefined && params.name !== null) existing.name = params.name;
      existing.updatedAt = new Date().toISOString();
      return { ...existing };
    }
    return invoke<CollectionSummary>("update_collection", {
      id: params.id,
      name: params.name ?? null,
      icon: params.icon ?? null,
      color: params.color ?? null,
      smartRules: null,
    });
  },

  async deleteCollection(id: string): Promise<{ ok: boolean }> {
    if (!isTauriRuntime()) {
      browserState.collections = browserState.collections.filter((c) => c.id !== id);
      return { ok: true };
    }
    return invoke<{ ok: boolean }>("delete_collection", { id });
  },

  async modifyCollectionClips(params: {
    collectionId: string;
    addClipIds?: string[] | null;
    removeClipIds?: string[] | null;
  }): Promise<{ count: number }> {
    if (!isTauriRuntime()) return { count: 0 };
    return invoke<{ count: number }>("modify_collection_clips", {
      collectionId: params.collectionId,
      addClipIds: params.addClipIds ?? null,
      removeClipIds: params.removeClipIds ?? null,
    });
  },

  async exportCollectionHardlinks(
    collectionId: string,
    targetDir?: string | null
  ): Promise<HardlinkExportResult> {
    return invoke<HardlinkExportResult>("export_collection_hardlinks", {
      collectionId,
      targetDir: targetDir ?? null,
    });
  },

  async startExport(request: StartExportRequest): Promise<{ jobId: string }> {
    return invoke<{ jobId: string }>("start_export", { request });
  },

  async startEditorExport(request: StartEditorExportRequest): Promise<{ jobId: string }> {
    return invoke<{ jobId: string }>("start_editor_export", { request });
  },

  async listEditorProjects(): Promise<EditorProjectSummary[]> {
    if (!isTauriRuntime()) {
      return readBrowserEditorProjects()
        .map(({ id, name, segmentCount, totalDurationSec, createdAt, updatedAt }) => ({
          id,
          name,
          segmentCount,
          totalDurationSec,
          createdAt,
          updatedAt,
        }))
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    }
    return invoke<EditorProjectSummary[]>("list_editor_projects", {});
  },

  async saveEditorProject(
    request: SaveEditorProjectRequest
  ): Promise<EditorProjectSummary> {
    if (!isTauriRuntime()) {
      const trimmedName = request.name.trim();
      if (!trimmedName) {
        throw new Error("Project name cannot be empty.");
      }
      if (trimmedName.length > 80) {
        throw new Error("Project name must be 80 characters or fewer.");
      }
      const projects = readBrowserEditorProjects();
      const now = new Date().toISOString();
      if (request.id) {
        const idx = projects.findIndex((p) => p.id === request.id);
        if (idx < 0) {
          throw new Error("Project not found.");
        }
        const updated: StoredBrowserEditorProject = {
          ...projects[idx],
          name: trimmedName,
          segmentCount: request.segmentCount,
          totalDurationSec: request.totalDurationSec,
          updatedAt: now,
          data: request.data,
        };
        projects[idx] = updated;
        writeBrowserEditorProjects(projects);
        return {
          id: updated.id,
          name: updated.name,
          segmentCount: updated.segmentCount,
          totalDurationSec: updated.totalDurationSec,
          createdAt: updated.createdAt,
          updatedAt: updated.updatedAt,
        };
      }
      const created: StoredBrowserEditorProject = {
        id: makeId("proj"),
        name: trimmedName,
        segmentCount: request.segmentCount,
        totalDurationSec: request.totalDurationSec,
        createdAt: now,
        updatedAt: now,
        data: request.data,
      };
      projects.unshift(created);
      writeBrowserEditorProjects(projects);
      return {
        id: created.id,
        name: created.name,
        segmentCount: created.segmentCount,
        totalDurationSec: created.totalDurationSec,
        createdAt: created.createdAt,
        updatedAt: created.updatedAt,
      };
    }
    return invoke<EditorProjectSummary>("save_editor_project", { request });
  },

  async loadEditorProject(projectId: string): Promise<LoadEditorProjectResult> {
    if (!isTauriRuntime()) {
      const projects = readBrowserEditorProjects();
      const found = projects.find((p) => p.id === projectId);
      if (!found) {
        throw new Error("Project not found.");
      }
      const missingSegments: MissingProjectSegment[] = [];
      const missingAudioLayers: MissingProjectAudioLayer[] = [];
      const segments: EditorSegment[] = found.data.segments.map((segData) =>
        rehydrateBrowserSegment(segData)
      );
      if (segments.length > 0 && segments[0].transitionIn !== "cut") {
        segments[0] = { ...segments[0], transitionIn: "cut" };
      }
      const audioLayers = Array.isArray(found.data.audioLayers)
        ? found.data.audioLayers.map((layer) => ({ ...layer, isMissing: false }))
        : [];
      return {
        project: {
          id: found.id,
          name: found.name,
          createdAt: found.createdAt,
          updatedAt: found.updatedAt,
          segments,
          audioLayers,
          exportOptions: found.data.exportOptions,
        },
        missingSegments,
        missingAudioLayers,
      };
    }
    return invoke<LoadEditorProjectResult>("load_editor_project", { projectId });
  },

  async deleteEditorProject(projectId: string): Promise<void> {
    if (!isTauriRuntime()) {
      const projects = readBrowserEditorProjects().filter((p) => p.id !== projectId);
      writeBrowserEditorProjects(projects);
      return;
    }
    await invoke<void>("delete_editor_project", { projectId });
  },

  async mergeClips(request: MergeClipsRequest): Promise<{ jobId: string }> {
    if (!isTauriRuntime()) {
      return { jobId: makeId("merge") };
    }
    return invoke<{ jobId: string }>("merge_clips", { request });
  },

  async saveTrimmedClip(request: SaveTrimmedClipRequest): Promise<ClipDetail> {
    if (!isTauriRuntime()) {
      const dur = Math.max(0.1, request.endSec - request.startSec);
      const id = makeId("clip");
      const fileName = request.title?.trim()
        ? `${request.title.trim()}.mp4`
        : "trimmed_clip.mp4";
      return {
        clip: {
          id,
          filePath: fileName,
          fileName,
          fileSizeBytes: 0,
          sourceType: "custom",
          gameId: null,
          gameName: "Clip",
          recordedAt: new Date().toISOString(),
          durationSec: dur,
          width: 1920,
          height: 1080,
          fps: 60,
          videoCodec: "h264",
          audioTrackCount: request.audioMix.length || 1,
          isFavorite: false,
          isPinned: false,
          title: request.title?.trim() || null,
          thumbUrl: "",
          collectionCount: request.collectionIds?.length ?? 0,
          tags: [],
          isMissing: false,
        },
        notes: null,
        audioTracks: [],
        collectionIds: request.collectionIds ?? [],
      };
    }
    return invoke<ClipDetail>("save_trimmed_clip", { request });
  },

  async cancelExport(jobId: string): Promise<{ ok: boolean }> {
    if (!isTauriRuntime()) return { ok: true };
    return invoke<{ ok: boolean }>("cancel_export", { jobId });
  },

  async copyFileToClipboard(filePath: string): Promise<{ ok: boolean }> {
    return invoke<{ ok: boolean }>("copy_file_to_clipboard", { filePath });
  },

  async openInExplorer(filePath: string): Promise<{ ok: boolean }> {
    return invoke<{ ok: boolean }>("open_in_explorer", { filePath });
  },

  async getStorageCleanupPreview(maxGb: number): Promise<StorageCleanupPreview> {
    if (!isTauriRuntime()) {
      return {
        totalSizeBytes: 0,
        maxStorageBytes: maxGb * 1024 * 1024 * 1024,
        reclaimableBytes: 0,
        candidates: [],
      };
    }
    return invoke<StorageCleanupPreview>("get_storage_cleanup_preview", { maxGb });
  },

  async runStorageCleanup(clipIds: string[]): Promise<StorageCleanupResult> {
    if (!isTauriRuntime()) {
      return { removedCount: 0, freedBytes: 0 };
    }
    return invoke<StorageCleanupResult>("run_storage_cleanup", { clipIds });
  },

  async getSettings(): Promise<AppSettings> {
    if (!isTauriRuntime()) {
      return { ...browserState.settings };
    }
    const s = await invoke<AppSettings>("get_settings", {});
    return {
      ...s,
      minimizeToTray: Boolean(s.minimizeToTray),
    };
  },

  async updateSettings(settings: AppSettings): Promise<AppSettings> {
    if (!isTauriRuntime()) {
      browserState.settings = { ...settings };
      return { ...browserState.settings };
    }
    return invoke<AppSettings>("update_settings", { settings });
  },

  async pickDirectory(title = "Choose folder"): Promise<string | null> {
    if (!isTauriRuntime()) {
      return null;
    }
    const selected = await openDialog({
      directory: true,
      multiple: false,
      title,
    });
    return typeof selected === "string" ? selected : null;
  },

  async pickAudioFile(): Promise<string | null> {
    if (!isTauriRuntime()) {
      return new Promise<string | null>((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = ".mp3,.wav,.aac,.m4a,.flac,audio/*";
        let settled = false;
        const finish = (val: string | null) => {
          if (settled) return;
          settled = true;
          resolve(val);
        };
        input.addEventListener("change", () => {
          const file = input.files?.[0];
          if (!file) {
            finish(null);
            return;
          }
          const url = URL.createObjectURL(file);
          browserAudioTitles.set(url, file.name.replace(/\.[^.]+$/, ""));
          finish(url);
        });
        input.addEventListener("cancel", () => finish(null));
        input.click();
      });
    }
    return invoke<string | null>("pick_audio_file", {});
  },

  async probeAudioFile(filePath: string): Promise<ProbedAudioFile> {
    if (!isTauriRuntime()) {
      const fallbackTitle =
        browserAudioTitles.get(filePath) ||
        filePath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "") ||
        "Music Track";
      const durationSec = await new Promise<number>((resolve) => {
        const audio = new Audio();
        audio.preload = "metadata";
        const cleanup = () => {
          audio.onloadedmetadata = null;
          audio.onerror = null;
        };
        audio.onloadedmetadata = () => {
          const dur = Number.isFinite(audio.duration) && audio.duration > 0.25 ? audio.duration : 30;
          cleanup();
          resolve(dur);
        };
        audio.onerror = () => {
          cleanup();
          resolve(30);
        };
        audio.src = filePath;
      });
      return {
        filePath,
        title: fallbackTitle,
        durationSec,
        codec: "mp3",
        sampleRate: 48000,
        channels: 2,
      };
    }
    return invoke<ProbedAudioFile>("probe_audio_file", { filePath });
  },
};

export interface AppEventHandlers {
  onScanProgress?: (payload: ScanProgressPayload) => void;
  onClipAdded?: (payload: ClipEventPayload) => void;
  onClipRemoved?: (payload: ClipEventPayload) => void;
  onExportProgress?: (payload: ExportProgressPayload) => void;
  onExportCompleted?: (payload: ExportCompletedPayload) => void;
  onExportFailed?: (payload: ExportFailedPayload) => void;
}

export async function subscribeAppEvents(handlers: AppEventHandlers): Promise<() => void> {
  if (!isTauriRuntime()) {
    return () => {};
  }
  const unlisteners: UnlistenFn[] = [];
  if (handlers.onScanProgress) {
    unlisteners.push(
      await listen<ScanProgressPayload>("scan:progress", (e) => handlers.onScanProgress?.(e.payload))
    );
  }
  if (handlers.onClipAdded) {
    unlisteners.push(
      await listen<ClipEventPayload>("clip:added", (e) => handlers.onClipAdded?.(e.payload))
    );
  }
  if (handlers.onClipRemoved) {
    unlisteners.push(
      await listen<ClipEventPayload>("clip:removed", (e) => handlers.onClipRemoved?.(e.payload))
    );
  }
  if (handlers.onExportProgress) {
    unlisteners.push(
      await listen<ExportProgressPayload>("export:progress", (e) =>
        handlers.onExportProgress?.(e.payload)
      )
    );
  }
  if (handlers.onExportCompleted) {
    unlisteners.push(
      await listen<ExportCompletedPayload>("export:completed", (e) =>
        handlers.onExportCompleted?.(e.payload)
      )
    );
  }
  if (handlers.onExportFailed) {
    unlisteners.push(
      await listen<ExportFailedPayload>("export:failed", (e) =>
        handlers.onExportFailed?.(e.payload)
      )
    );
  }
  return () => {
    for (const unlisten of unlisteners) {
      unlisten();
    }
  };
}

export function buildStreamerUrl(
  baseUrl: string,
  token: string,
  pathOrUrl: string
): string {
  if (!pathOrUrl && !baseUrl) return "";
  if (/^https?:\/\//i.test(pathOrUrl)) {
    if (!token || pathOrUrl.includes("token=")) return pathOrUrl;
    const joiner = pathOrUrl.includes("?") ? "&" : "?";
    return `${pathOrUrl}${joiner}token=${encodeURIComponent(token)}`;
  }
  const cleanBase = baseUrl.replace(/\/+$/, "");
  const cleanPath = pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`;
  if (!token) return `${cleanBase}${cleanPath}`;
  const joiner = cleanPath.includes("?") ? "&" : "?";
  return `${cleanBase}${cleanPath}${joiner}token=${encodeURIComponent(token)}`;
}

export function getVideoStreamUrl(baseUrl: string, token: string, clipId: string): string {
  return buildStreamerUrl(baseUrl, token, `/video/${encodeURIComponent(clipId)}`);
}

export function getAudioStreamUrl(
  baseUrl: string,
  token: string,
  clipId: string,
  trackOrder: number
): string {
  return buildStreamerUrl(baseUrl, token, `/audio/${encodeURIComponent(clipId)}/${trackOrder}`);
}

export function getThumbStreamUrl(
  baseUrl: string,
  token: string,
  clipId: string,
  thumbUrl?: string
): string {
  if (thumbUrl) {
    return buildStreamerUrl(baseUrl, token, thumbUrl);
  }
  return buildStreamerUrl(baseUrl, token, `/thumb/${encodeURIComponent(clipId)}`);
}

export function getWaveformUrl(
  baseUrl: string,
  token: string,
  clipId: string,
  trackOrder = 0
): string {
  return buildStreamerUrl(baseUrl, token, `/waveform/${encodeURIComponent(clipId)}/${trackOrder}`);
}

export function getLocalAudioStreamUrl(
  baseUrl: string,
  token: string,
  filePath: string
): string {
  if (!filePath) return "";
  if (
    filePath.startsWith("blob:") ||
    filePath.startsWith("data:") ||
    /^https?:\/\//i.test(filePath)
  ) {
    return filePath;
  }
  return buildStreamerUrl(baseUrl, token, `/local-audio?path=${encodeURIComponent(filePath)}`);
}
