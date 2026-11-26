import { useCallback, useState } from "react";
import type { ContextMenuEntry } from "../components/ContextMenu";
import type {
  AspectMode,
  AudioTrackMix,
  ClipSummary,
  CollectionSummary,
} from "../lib/types";

export interface ConfirmState {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive: boolean;
  onConfirm: () => Promise<void>;
}

export interface SaveTrimModalState {
  open: boolean;
  clip: ClipSummary | null;
  startSec: number;
  endSec: number;
  audioMix: AudioTrackMix[];
  aspectMode: AspectMode;
  normalizeAudio: boolean;
}

export interface CollectionModalState {
  open: boolean;
  mode: "create" | "rename";
  target?: CollectionSummary;
}

export interface MergeModalState {
  open: boolean;
  clips: ClipSummary[];
  initialTitle: string;
}

export function useAppModals() {
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    entries: ContextMenuEntry[];
  } | null>(null);

  const [collectionModal, setCollectionModal] = useState<CollectionModalState>({
    open: false,
    mode: "create",
  });
  const [collectionPickerClipIds, setCollectionPickerClipIds] = useState<string[]>([]);

  const [saveTrimModal, setSaveTrimModal] = useState<SaveTrimModalState>({
    open: false,
    clip: null,
    startSec: 0,
    endSec: 0,
    audioMix: [],
    aspectMode: "original",
    normalizeAudio: false,
  });
  const [savingTrim, setSavingTrim] = useState(false);
  const [saveTrimError, setSaveTrimError] = useState<string | null>(null);

  const [mergeModal, setMergeModal] = useState<MergeModalState>({
    open: false,
    clips: [],
    initialTitle: "",
  });

  const [editClipTarget, setEditClipTarget] = useState<ClipSummary | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [modalBusy, setModalBusy] = useState(false);

  const openContextMenu = useCallback(
    (x: number, y: number, entries: ContextMenuEntry[]) => {
      setContextMenu({ x, y, entries });
    },
    []
  );

  const closeMergeModal = useCallback(() => {
    setMergeModal({ open: false, clips: [], initialTitle: "" });
  }, []);

  return {
    contextMenu,
    setContextMenu,
    openContextMenu,
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
    setMergeModal,
    closeMergeModal,
    editClipTarget,
    setEditClipTarget,
    confirmState,
    setConfirmState,
    modalBusy,
    setModalBusy,
  };
}
