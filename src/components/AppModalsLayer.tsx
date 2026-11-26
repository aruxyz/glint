import type { Dispatch, SetStateAction } from "react";
import { ClipEditModal } from "./ClipEditModal";
import { CollectionModal } from "./CollectionModal";
import { CollectionPopover } from "./CollectionPopover";
import { ConfirmModal } from "./ConfirmModal";
import { ContextMenu, type ContextMenuEntry } from "./ContextMenu";
import { ExportToast, type ToastState } from "./ExportToast";
import { MergeClipsModal } from "./MergeClipsModal";
import { SaveClipModal } from "./SaveClipModal";
import type {
  CollectionModalState,
  ConfirmState,
  MergeModalState,
  SaveTrimModalState,
} from "../hooks/useAppModals";
import { api, isTauriRuntime } from "../lib/api";
import type {
  AppSettings,
  BootstrapState,
  ClipSummary,
  CollectionSummary,
  MergeClipsRequest,
  NavDestination,
  TagItem,
} from "../lib/types";

interface AppModalsLayerProps {
  bootstrap: BootstrapState | null;
  currentSettings: AppSettings;
  collections: CollectionSummary[];
  tags: TagItem[];
  activeClip: ClipSummary | null;
  setActiveClip: Dispatch<SetStateAction<ClipSummary | null>>;
  setClips: Dispatch<SetStateAction<ClipSummary[]>>;
  setPlayerQueue: Dispatch<SetStateAction<ClipSummary[]>>;
  setDestination: (dest: NavDestination) => void;
  setSettingsOpen: (open: boolean) => void;
  setSettingsTab: (tab: "folders" | "storage" | "export" | "shortcuts") => void;
  refreshMetadata: () => Promise<void>;
  loadClips: () => Promise<void>;
  contextMenu: { x: number; y: number; entries: ContextMenuEntry[] } | null;
  setContextMenu: (v: { x: number; y: number; entries: ContextMenuEntry[] } | null) => void;
  collectionModal: CollectionModalState;
  setCollectionModal: Dispatch<SetStateAction<CollectionModalState>>;
  collectionPickerClipIds: string[];
  setCollectionPickerClipIds: Dispatch<SetStateAction<string[]>>;
  saveTrimModal: SaveTrimModalState;
  setSaveTrimModal: Dispatch<SetStateAction<SaveTrimModalState>>;
  savingTrim: boolean;
  setSavingTrim: Dispatch<SetStateAction<boolean>>;
  saveTrimError: string | null;
  setSaveTrimError: Dispatch<SetStateAction<string | null>>;
  mergeModal: MergeModalState;
  closeMergeModal: () => void;
  mergingClips: boolean;
  mergeError: string | null;
  onMergeSubmit: (request: MergeClipsRequest) => Promise<void>;
  editClipTarget: ClipSummary | null;
  setEditClipTarget: Dispatch<SetStateAction<ClipSummary | null>>;
  confirmState: ConfirmState | null;
  setConfirmState: Dispatch<SetStateAction<ConfirmState | null>>;
  modalBusy: boolean;
  setModalBusy: Dispatch<SetStateAction<boolean>>;
  toast: ToastState | null;
  setToast: Dispatch<SetStateAction<ToastState | null>>;
  onCancelExport: (jobId: string) => void;
  onCopyAgain: (filePath: string) => void;
  onShowInFolder: (filePath: string) => void;
  onRetryExport25Mb: () => void;
  onOpenEditor: () => void;
}

export function AppModalsLayer({
  bootstrap,
  currentSettings,
  collections,
  tags,
  activeClip,
  setActiveClip,
  setClips,
  setPlayerQueue,
  setDestination,
  setSettingsOpen,
  setSettingsTab,
  refreshMetadata,
  loadClips,
  contextMenu,
  setContextMenu,
  collectionModal,
  setCollectionModal,
  collectionPickerClipIds,
  setCollectionPickerClipIds,
  saveTrimModal,
  setSaveTrimModal,
  savingTrim,
  setSavingTrim,
  saveTrimError,
  setSaveTrimError,
  mergeModal,
  closeMergeModal,
  mergingClips,
  mergeError,
  onMergeSubmit,
  editClipTarget,
  setEditClipTarget,
  confirmState,
  setConfirmState,
  modalBusy,
  setModalBusy,
  toast,
  setToast,
  onCancelExport,
  onCopyAgain,
  onShowInFolder,
  onRetryExport25Mb,
  onOpenEditor,
}: AppModalsLayerProps) {
  return (
    <>
      <ContextMenu
        open={contextMenu !== null}
        x={contextMenu?.x ?? 0}
        y={contextMenu?.y ?? 0}
        entries={contextMenu?.entries ?? []}
        onClose={() => setContextMenu(null)}
      />

      <CollectionModal
        open={collectionModal.open}
        mode={collectionModal.mode}
        initialName={collectionModal.target?.name ?? ""}
        busy={modalBusy}
        onClose={() => setCollectionModal({ open: false, mode: "create" })}
        onSave={async (name) => {
          setModalBusy(true);
          try {
            if (collectionModal.mode === "create") {
              const created = await api.createCollection({
                name,
                kind: "manual",
              });
              await refreshMetadata();
              setDestination({ kind: "collection", collectionId: created.id });
            } else if (collectionModal.target) {
              await api.updateCollection({
                id: collectionModal.target.id,
                name,
              });
              await refreshMetadata();
            }
            setCollectionModal({ open: false, mode: "create" });
          } finally {
            setModalBusy(false);
          }
        }}
      />

      <CollectionPopover
        open={collectionPickerClipIds.length > 0}
        clipIds={collectionPickerClipIds}
        collections={collections}
        onMembershipChanged={async (affectedIds) => {
          await refreshMetadata();
          await loadClips();
          if (activeClip && affectedIds.includes(activeClip.id) && isTauriRuntime()) {
            api
              .getClipDetail(activeClip.id)
              .then((detail) => setActiveClip(detail.clip))
              .catch(() => {});
          }
        }}
        onCreateCollection={async (name, addClipIds) => {
          const created = await api.createCollection({ name, kind: "manual" });
          await api.modifyCollectionClips({
            collectionId: created.id,
            addClipIds,
          });
          await refreshMetadata();
          await loadClips();
          if (activeClip && addClipIds.includes(activeClip.id) && isTauriRuntime()) {
            api
              .getClipDetail(activeClip.id)
              .then((detail) => setActiveClip(detail.clip))
              .catch(() => {});
          }
          return created;
        }}
        onClose={() => setCollectionPickerClipIds([])}
      />

      <SaveClipModal
        open={saveTrimModal.open}
        startSec={saveTrimModal.startSec}
        endSec={saveTrimModal.endSec}
        aspectMode={saveTrimModal.aspectMode}
        normalizeAudio={saveTrimModal.normalizeAudio}
        collections={collections}
        busy={savingTrim}
        error={saveTrimError}
        onCreateCollection={async (name) => {
          const created = await api.createCollection({ name, kind: "manual" });
          await refreshMetadata();
          return created;
        }}
        onSave={async ({ title, collectionIds }) => {
          if (!saveTrimModal.clip) return;
          setSavingTrim(true);
          setSaveTrimError(null);
          try {
            const detail = await api.saveTrimmedClip({
              clipId: saveTrimModal.clip.id,
              startSec: saveTrimModal.startSec,
              endSec: saveTrimModal.endSec,
              title,
              audioMix: saveTrimModal.audioMix,
              collectionIds: collectionIds.length > 0 ? collectionIds : null,
              aspectMode: saveTrimModal.aspectMode,
              normalizeAudio: saveTrimModal.normalizeAudio,
            });
            setSaveTrimModal((prev) => ({ ...prev, open: false }));
            await refreshMetadata();
            await loadClips();
            setToast({
              kind: "clip_saved",
              clip: detail.clip,
              collectionCount: detail.collectionIds.length,
            });
          } catch (err) {
            setSaveTrimError(
              err instanceof Error ? err.message : "Failed to save trimmed clip."
            );
          } finally {
            setSavingTrim(false);
          }
        }}
        onClose={() => {
          if (!savingTrim) {
            setSaveTrimModal((prev) => ({ ...prev, open: false }));
          }
        }}
      />

      <MergeClipsModal
        open={mergeModal.open}
        clips={mergeModal.clips}
        initialTitle={mergeModal.initialTitle}
        streamerBaseUrl={bootstrap?.streamerBaseUrl ?? ""}
        streamerToken={bootstrap?.streamerToken ?? ""}
        defaultCopyToClipboard={currentSettings.autoCopyExportToClipboard}
        busy={mergingClips}
        error={mergeError}
        onClose={() => {
          if (!mergingClips) {
            closeMergeModal();
          }
        }}
        onSubmit={onMergeSubmit}
      />

      <ClipEditModal
        open={editClipTarget !== null}
        clip={editClipTarget}
        availableTags={tags}
        busy={modalBusy}
        onClose={() => setEditClipTarget(null)}
        onSave={async ({ clipId, title, tagNames }) => {
          setModalBusy(true);
          try {
            if (isTauriRuntime()) {
              const updated = await api.updateClipMeta({
                clipId,
                title,
                tagNames,
              });
              setClips((prev) =>
                prev.map((c) => (c.id === clipId ? updated.clip : c))
              );
              setPlayerQueue((prev) =>
                prev.map((c) => (c.id === clipId ? updated.clip : c))
              );
              if (activeClip?.id === clipId) {
                setActiveClip(updated.clip);
              }
            }
            await refreshMetadata();
            setEditClipTarget(null);
          } finally {
            setModalBusy(false);
          }
        }}
      />

      <ConfirmModal
        open={Boolean(confirmState?.open)}
        title={confirmState?.title ?? ""}
        description={confirmState?.description ?? ""}
        confirmLabel={confirmState?.confirmLabel ?? "Confirm"}
        destructive={confirmState?.destructive}
        busy={modalBusy}
        onCancel={() => setConfirmState(null)}
        onConfirm={async () => {
          if (!confirmState) return;
          setModalBusy(true);
          try {
            await confirmState.onConfirm();
            setConfirmState(null);
          } finally {
            setModalBusy(false);
          }
        }}
      />

      <ExportToast
        toast={toast}
        onDismiss={() => setToast(null)}
        onCancelExport={onCancelExport}
        onCopyAgain={onCopyAgain}
        onShowInFolder={onShowInFolder}
        onRetryExport25Mb={onRetryExport25Mb}
        onOpenSavedClip={(savedClip) => {
          setSettingsOpen(false);
          setActiveClip(savedClip);
        }}
        onOpenEditor={onOpenEditor}
        onOpenSettingsExport={() => {
          setToast(null);
          setSettingsTab("export");
          setSettingsOpen(true);
        }}
      />
    </>
  );
}
