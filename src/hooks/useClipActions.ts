import { useCallback, type Dispatch, type SetStateAction } from "react";
import type { ToastState } from "../components/ExportToast";
import type { ConfirmState, MergeModalState } from "./useAppModals";
import { CLIP_PAGE_SIZE } from "./useLibrary";
import { api, isTauriRuntime } from "../lib/api";
import type {
  AppSettings,
  ClipSummary,
  CollectionSummary,
  NavDestination,
  SourceType,
} from "../lib/types";

interface UseClipActionsParams {
  currentSettings: AppSettings;
  destination: NavDestination;
  clips: ClipSummary[];
  totalCount: number;
  activeClip: ClipSummary | null;
  playerQueue: ClipSummary[];
  selectedIds: Set<string>;
  setOnboardingDismissed: (v: boolean) => void;
  setScanning: (v: boolean) => void;
  setDestination: (dest: NavDestination) => void;
  setActiveClip: Dispatch<SetStateAction<ClipSummary | null>>;
  setPlayerQueue: Dispatch<SetStateAction<ClipSummary[]>>;
  setSelectedIds: Dispatch<SetStateAction<Set<string>>>;
  setConfirmState: Dispatch<SetStateAction<ConfirmState | null>>;
  setMergeModal: Dispatch<SetStateAction<MergeModalState>>;
  setMergeError: (err: string | null) => void;
  setToast: Dispatch<SetStateAction<ToastState | null>>;
  clearSelection: () => void;
  refreshMetadata: () => Promise<void>;
  loadClips: () => Promise<void>;
}

export function useClipActions({
  currentSettings,
  destination,
  clips,
  totalCount,
  activeClip,
  playerQueue,
  selectedIds,
  setOnboardingDismissed,
  setScanning,
  setDestination,
  setActiveClip,
  setPlayerQueue,
  setSelectedIds,
  setConfirmState,
  setMergeModal,
  setMergeError,
  setToast,
  clearSelection,
  refreshMetadata,
  loadClips,
}: UseClipActionsParams) {
  const handleOnboardingComplete = useCallback(
    async (
      watchPath: string,
      hardlinkDir: string,
      sourceType: SourceType = "nvidia"
    ) => {
      await api.addWatchFolder(watchPath, sourceType);
      if (hardlinkDir && hardlinkDir !== currentSettings.hardlinkBaseDir) {
        await api.updateSettings({
          ...currentSettings,
          hardlinkBaseDir: hardlinkDir,
        });
      }
      setOnboardingDismissed(true);
      setScanning(true);
      await api.scanWatchFolders(null).catch(() => {});
      await refreshMetadata();
      setScanning(false);
      await loadClips();
    },
    [
      currentSettings,
      loadClips,
      refreshMetadata,
      setOnboardingDismissed,
      setScanning,
    ]
  );

  const handleRevealFile = useCallback(
    async (clip: ClipSummary) => {
      if (!isTauriRuntime()) {
        setToast({
          kind: "info",
          title: "Desktop runtime required",
          detail: clip.filePath,
        });
        return;
      }
      try {
        await api.openInExplorer(clip.filePath);
      } catch (err) {
        setToast({
          kind: "info",
          title: "Could not reveal file",
          detail: err instanceof Error ? err.message : clip.filePath,
        });
      }
    },
    [setToast]
  );

  const handleDeleteClip = useCallback(
    (clip: ClipSummary) => {
      setConfirmState({
        open: true,
        title: "Move clip to Recycle Bin?",
        description: `"${clip.title || clip.fileName}" will be moved to the Windows Recycle Bin and removed from your Glint library.`,
        confirmLabel: "Move to Recycle Bin",
        destructive: true,
        onConfirm: async () => {
          await api.deleteClips([clip.id]);
          const currentQueue = playerQueue.length > 0 ? playerQueue : clips;
          const remainingQueue = currentQueue.filter((c) => c.id !== clip.id);
          setPlayerQueue(remainingQueue);
          if (activeClip?.id === clip.id) {
            const oldIdx = currentQueue.findIndex((c) => c.id === clip.id);
            const nextClip =
              remainingQueue[oldIdx] ?? remainingQueue[oldIdx - 1] ?? null;
            setActiveClip(nextClip);
          }
          setSelectedIds((prev) => {
            if (!prev.has(clip.id)) return prev;
            const next = new Set(prev);
            next.delete(clip.id);
            return next;
          });
          await refreshMetadata();
          await loadClips();
        },
      });
    },
    [
      activeClip?.id,
      clips,
      loadClips,
      playerQueue,
      refreshMetadata,
      setActiveClip,
      setConfirmState,
      setPlayerQueue,
      setSelectedIds,
    ]
  );

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setConfirmState({
      open: true,
      title: `Move ${ids.length} ${ids.length === 1 ? "clip" : "clips"} to Recycle Bin?`,
      description: `${ids.length} selected ${ids.length === 1 ? "clip" : "clips"} will be moved to the Windows Recycle Bin and removed from your Glint library.`,
      confirmLabel: "Move to Recycle Bin",
      destructive: true,
      onConfirm: async () => {
        await api.deleteClips(ids);
        clearSelection();
        await refreshMetadata();
        await loadClips();
      },
    });
  }, [clearSelection, loadClips, refreshMetadata, selectedIds, setConfirmState]);

  const handleBulkRemoveFromCollection = useCallback(
    async (collection: CollectionSummary) => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      await api.modifyCollectionClips({
        collectionId: collection.id,
        removeClipIds: ids,
      });
      clearSelection();
      await refreshMetadata();
      await loadClips();
      setToast({
        kind: "info",
        title: `Removed ${ids.length} ${ids.length === 1 ? "clip" : "clips"} from ${collection.name}`,
      });
    },
    [clearSelection, loadClips, refreshMetadata, selectedIds, setToast]
  );

  const handleRemoveSingleFromCollection = useCallback(
    async (clip: ClipSummary, collection: CollectionSummary) => {
      await api.modifyCollectionClips({
        collectionId: collection.id,
        removeClipIds: [clip.id],
      });
      await refreshMetadata();
      await loadClips();
      setToast({
        kind: "info",
        title: `Removed "${clip.title || clip.fileName}" from ${collection.name}`,
      });
    },
    [loadClips, refreshMetadata, setToast]
  );

  const handleDeleteCollectionConfirm = useCallback(
    (col: CollectionSummary) => {
      setConfirmState({
        open: true,
        title: `Delete "${col.name}"?`,
        description:
          "Only the virtual folder is removed. Your original video files remain untouched.",
        confirmLabel: "Delete Folder",
        destructive: true,
        onConfirm: async () => {
          await api.deleteCollection(col.id);
          if (
            destination.kind === "collection" &&
            destination.collectionId === col.id
          ) {
            setDestination({ kind: "all" });
          }
          await refreshMetadata();
        },
      });
    },
    [destination, refreshMetadata, setConfirmState, setDestination]
  );

  const handleOpenBulkMerge = useCallback(() => {
    const selectedClips = clips.filter((c) => selectedIds.has(c.id));
    if (selectedClips.length < 2) return;
    setMergeError(null);
    setMergeModal({
      open: true,
      clips: selectedClips,
      initialTitle: "",
    });
  }, [clips, selectedIds, setMergeError, setMergeModal]);

  const handleOpenMergeCollection = useCallback(
    async (col: CollectionSummary) => {
      let targetClips: ClipSummary[] = [];
      if (
        destination.kind === "collection" &&
        destination.collectionId === col.id &&
        clips.length >= 2 &&
        clips.length >= totalCount
      ) {
        targetClips = clips;
      } else {
        let offset = 0;
        let total = Infinity;
        while (offset < total) {
          const res = await api.listClips({
            collectionId: col.id,
            sortBy: "recorded_asc",
            limit: CLIP_PAGE_SIZE,
            offset,
          });
          total = res.total;
          if (res.items.length === 0) break;
          targetClips.push(...res.items);
          offset += res.items.length;
        }
      }
      if (targetClips.length < 2) {
        setToast({
          kind: "info",
          title: "Need at least 2 clips to merge",
          detail: `${col.name} has fewer than 2 clips.`,
        });
        return;
      }
      setMergeError(null);
      setMergeModal({
        open: true,
        clips: targetClips,
        initialTitle: col.name,
      });
    },
    [clips, destination, setMergeError, setMergeModal, setToast, totalCount]
  );

  const handleScanNow = useCallback(
    async (folderId?: string | null) => {
      setScanning(true);
      try {
        await api.scanWatchFolders(folderId ?? null);
        await refreshMetadata();
        await loadClips();
      } finally {
        setScanning(false);
      }
    },
    [loadClips, refreshMetadata, setScanning]
  );

  return {
    handleOnboardingComplete,
    handleRevealFile,
    handleDeleteClip,
    handleBulkDelete,
    handleBulkRemoveFromCollection,
    handleRemoveSingleFromCollection,
    handleDeleteCollectionConfirm,
    handleOpenBulkMerge,
    handleOpenMergeCollection,
    handleScanNow,
  };
}
