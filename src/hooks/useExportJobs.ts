import { useCallback, useRef, useState, type Dispatch, type SetStateAction } from "react";
import type { ToastState } from "../components/ExportToast";
import { api, isTauriRuntime } from "../lib/api";
import { getEncoderLabel } from "../lib/encoder";
import { getWindowsDrive } from "../lib/format";
import type {
  AppSettings,
  AspectMode,
  AudioTrackMix,
  BootstrapState,
  ClipSummary,
  CollectionSummary,
  ExportPreset,
  MergeClipsRequest,
  StartEditorExportRequest,
} from "../lib/types";

export interface ActiveExportMeta {
  jobId: string;
  clip?: ClipSummary;
  fileName?: string;
  preset: ExportPreset | "montage" | "editor";
  startSec: number;
  endSec: number;
  audioMix: AudioTrackMix[];
  aspectMode: AspectMode;
  normalizeAudio: boolean;
  addToLibrary?: boolean;
}

interface UseExportJobsParams {
  bootstrap: BootstrapState | null;
  currentSettings: AppSettings;
  clips: ClipSummary[];
  setClips: Dispatch<SetStateAction<ClipSummary[]>>;
  setPlayerQueue: Dispatch<SetStateAction<ClipSummary[]>>;
  setActiveClip: Dispatch<SetStateAction<ClipSummary | null>>;
  clearSelection: () => void;
  closeMergeModal: () => void;
}

export function useExportJobs({
  bootstrap,
  currentSettings,
  clips,
  setClips,
  setPlayerQueue,
  setActiveClip,
  clearSelection,
  closeMergeModal,
}: UseExportJobsParams) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const [linkingCollectionId, setLinkingCollectionId] = useState<string | null>(null);
  const [mergingClips, setMergingClips] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);
  const activeExportMetaRef = useRef<ActiveExportMeta | null>(null);

  const encoderInfo = {
    hasNvenc: Boolean(bootstrap?.hasNvenc),
    hasAmf: Boolean(bootstrap?.hasAmf),
    hasQsv: Boolean(bootstrap?.hasQsv),
    hardwareEncoder: bootstrap?.hardwareEncoder,
  };

  const handleSetClipCover = useCallback(
    async (clip: ClipSummary, timeSec: number) => {
      try {
        const res = await api.setClipThumbnail(clip.id, timeSec);
        setClips((prev) =>
          prev.map((c) =>
            c.id === res.clipId ? { ...c, thumbUrl: res.thumbUrl } : c
          )
        );
        setPlayerQueue((prev) =>
          prev.map((c) =>
            c.id === res.clipId ? { ...c, thumbUrl: res.thumbUrl } : c
          )
        );
        setActiveClip((prev) =>
          prev && prev.id === res.clipId
            ? { ...prev, thumbUrl: res.thumbUrl }
            : prev
        );
        setToast({
          kind: "info",
          title: "Updated clip cover",
          detail: clip.title?.trim() || clip.fileName,
        });
      } catch (err) {
        setToast({
          kind: "export_error",
          message:
            err instanceof Error ? err.message : "Could not update clip cover.",
        });
      }
    },
    [setActiveClip, setClips, setPlayerQueue]
  );

  const handleSnapshotFrame = useCallback(
    async ({
      clip,
      timeSec,
      aspectMode,
      copyToClipboard,
    }: {
      clip: ClipSummary;
      timeSec: number;
      aspectMode: AspectMode;
      copyToClipboard: boolean;
    }) => {
      try {
        const res = await api.captureFrameSnapshot({
          clipId: clip.id,
          timeSec,
          aspectMode,
          copyToClipboard,
        });
        setToast({
          kind: "snapshot_saved",
          outputPath: res.outputPath,
          fileName: res.fileName,
          copiedToClipboard: res.copiedToClipboard,
        });
      } catch (err) {
        setToast({
          kind: "export_error",
          message:
            err instanceof Error
              ? err.message
              : "Could not capture frame snapshot.",
        });
      }
    },
    []
  );

  const handleStartExport = useCallback(
    async ({
      clip,
      preset,
      customPresetId,
      startSec,
      endSec,
      audioMix,
      copyToClipboard,
      aspectMode,
      normalizeAudio,
    }: {
      clip: ClipSummary;
      preset: ExportPreset;
      customPresetId?: string | null;
      startSec: number;
      endSec: number;
      audioMix: AudioTrackMix[];
      copyToClipboard: boolean;
      aspectMode: AspectMode;
      normalizeAudio: boolean;
    }) => {
      const res = await api.startExport({
        clipId: clip.id,
        preset,
        customPresetId: customPresetId ?? null,
        startSec,
        endSec,
        audioMix,
        copyToClipboard,
        aspectMode,
        normalizeAudio,
      });
      activeExportMetaRef.current = {
        jobId: res.jobId,
        clip,
        preset,
        startSec,
        endSec,
        audioMix,
        aspectMode,
        normalizeAudio,
      };
      setToast({
        kind: "export_progress",
        jobId: res.jobId,
        fileName: clip.title || clip.fileName,
        preset,
        percent: 0,
        etaSec: null,
        encoderLabel: getEncoderLabel(preset, encoderInfo, aspectMode, normalizeAudio),
      });
    },
    [encoderInfo.hasAmf, encoderInfo.hasNvenc, encoderInfo.hasQsv, encoderInfo.hardwareEncoder]
  );

  const handleMergeClipsSubmit = useCallback(
    async (request: MergeClipsRequest) => {
      setMergingClips(true);
      setMergeError(null);
      try {
        const res = await api.mergeClips(request);
        const displayName =
          request.outputName?.trim() ||
          `Merged montage (${request.clipIds.length} clips)`;
        const aspect = request.aspectMode ?? "original";
        const norm = Boolean(request.normalizeAudio);
        activeExportMetaRef.current = {
          jobId: res.jobId,
          fileName: displayName,
          preset: "montage",
          startSec: 0,
          endSec: 0,
          audioMix: [],
          aspectMode: aspect,
          normalizeAudio: norm,
          addToLibrary: request.addToLibrary,
        };
        closeMergeModal();
        clearSelection();
        setToast({
          kind: "export_progress",
          jobId: res.jobId,
          fileName: displayName,
          preset: "montage",
          percent: 0,
          etaSec: null,
          encoderLabel: getEncoderLabel("montage", encoderInfo, aspect, norm),
        });
      } catch (err) {
        setMergeError(
          err instanceof Error ? err.message : "Could not start clip merge."
        );
      } finally {
        setMergingClips(false);
      }
    },
    [
      clearSelection,
      closeMergeModal,
      encoderInfo.hasAmf,
      encoderInfo.hasNvenc,
      encoderInfo.hasQsv,
      encoderInfo.hardwareEncoder,
    ]
  );

  const handleStartEditorExport = useCallback(
    async (request: StartEditorExportRequest) => {
      try {
        const res = await api.startEditorExport(request);
        const displayName =
          request.outputName?.trim() ||
          `Editor (${request.segments.length} ${
            request.segments.length === 1 ? "segment" : "segments"
          })`;
        const norm = Boolean(request.normalizeAudio);
        const labelPreset =
          request.verticalStyle === "blur"
            ? "vertical_blur_9_16"
            : request.verticalStyle === "crop"
              ? "vertical_crop_9_16"
              : "editor";
        activeExportMetaRef.current = {
          jobId: res.jobId,
          fileName: displayName,
          preset: "editor",
          startSec: 0,
          endSec: 0,
          audioMix: [],
          aspectMode: "original",
          normalizeAudio: norm,
          addToLibrary: request.addToLibrary,
        };
        setToast({
          kind: "export_progress",
          jobId: res.jobId,
          fileName: displayName,
          preset: "editor",
          percent: 0,
          etaSec: null,
          encoderLabel: getEncoderLabel(labelPreset, encoderInfo, "original", norm),
        });
      } catch (err) {
        setToast({
          kind: "export_error",
          message:
            err instanceof Error ? err.message : "Could not start editor export.",
        });
      }
    },
    [
      encoderInfo.hasAmf,
      encoderInfo.hasNvenc,
      encoderInfo.hasQsv,
      encoderInfo.hardwareEncoder,
    ]
  );

  const handleOpenAsRealFolder = useCallback(
    async (collection: CollectionSummary) => {
      if (!isTauriRuntime()) {
        setToast({
          kind: "info",
          title: "NTFS Hardlinks require desktop runtime",
          detail: `Target collection: ${collection.name}`,
        });
        return;
      }
      setLinkingCollectionId(collection.id);
      setToast({
        kind: "info",
        title: `Creating hardlink folder for ${collection.name}...`,
      });
      try {
        const res = await api.exportCollectionHardlinks(collection.id, null);
        if (res.crossDriveClips > 0 && res.linkedCount === 0) {
          const clipDrive = getWindowsDrive(clips[0]?.filePath ?? "") || "clips drive";
          const exportDrive =
            getWindowsDrive(bootstrap?.settings.hardlinkBaseDir ?? "") || "another drive";
          setToast({
            kind: "hardlink_cross_drive",
            message: `Hardlinks require the export folder to be on the same NTFS drive as your clips (${clipDrive}). Export path is on ${exportDrive}.`,
          });
          return;
        }
        await api.openInExplorer(res.folderPath).catch(() => {});
        setToast({
          kind: "hardlink_success",
          collectionName: collection.name,
          folderPath: res.folderPath,
          linkedCount: res.linkedCount,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Could not create hardlinks.";
        if (/cross-drive|different drive|ntfs/i.test(msg)) {
          setToast({ kind: "hardlink_cross_drive", message: msg });
        } else {
          setToast({ kind: "export_error", message: msg });
        }
      } finally {
        setLinkingCollectionId(null);
      }
    },
    [bootstrap?.settings.hardlinkBaseDir, clips]
  );

  const handleCancelExport = useCallback(async (jobId: string) => {
    await api.cancelExport(jobId).catch(() => {});
    activeExportMetaRef.current = null;
    setToast(null);
  }, []);

  const handleCopyAgain = useCallback(async (filePath: string) => {
    await api.copyFileToClipboard(filePath).catch(() => {});
    setToast({
      kind: "info",
      title: "Copied to Windows Clipboard",
      detail: "Ready to paste with Ctrl+V.",
    });
  }, []);

  const handleShowInFolder = useCallback(async (filePath: string) => {
    await api.openInExplorer(filePath).catch(() => {});
  }, []);

  const handleRetryExport25Mb = useCallback(() => {
    const meta = activeExportMetaRef.current;
    if (!meta || !meta.clip) return;
    void handleStartExport({
      clip: meta.clip,
      preset: "discord_25mb",
      startSec: meta.startSec,
      endSec: meta.endSec,
      audioMix: meta.audioMix,
      copyToClipboard: currentSettings.autoCopyExportToClipboard,
      aspectMode: meta.aspectMode,
      normalizeAudio: meta.normalizeAudio,
    });
  }, [currentSettings.autoCopyExportToClipboard, handleStartExport]);

  return {
    toast,
    setToast,
    activeExportMetaRef,
    linkingCollectionId,
    mergingClips,
    mergeError,
    setMergeError,
    handleSetClipCover,
    handleSnapshotFrame,
    handleStartExport,
    handleStartEditorExport,
    handleMergeClipsSubmit,
    handleOpenAsRealFolder,
    handleCancelExport,
    handleCopyAgain,
    handleShowInFolder,
    handleRetryExport25Mb,
  };
}
