import {
  BookmarkPlus,
  Camera,
  FolderOpen,
  FolderPlus,
  Image as ImageIcon,
  ListPlus,
  Pencil,
  Play,
  Star,
  Trash2,
} from "lucide-react";
import type { ContextMenuEntry } from "../ContextMenu";
import { isTauriRuntime } from "../../lib/api";
import type { ClipSummary } from "../../lib/types";

export function buildQueueContextMenuEntries(params: {
  item: ClipSummary;
  activeClipId: string;
  onSelectClip: (clip: ClipSummary) => void;
  onOpenCollectionPicker: (clip: ClipSummary) => void;
  onToggleFavorite: (clip: ClipSummary) => void;
  onEditClip: (clip: ClipSummary) => void;
  onRevealFile: (clip: ClipSummary) => void;
  onDeleteClip: (clip: ClipSummary) => void;
}): ContextMenuEntry[] {
  const {
    item,
    activeClipId,
    onSelectClip,
    onOpenCollectionPicker,
    onToggleFavorite,
    onEditClip,
    onRevealFile,
    onDeleteClip,
  } = params;

  return [
    ...(item.id !== activeClipId
      ? [
          {
            id: "queue-play",
            label: "Play Clip",
            icon: Play,
            onSelect: () => onSelectClip(item),
          } satisfies ContextMenuEntry,
        ]
      : []),
    {
      id: "queue-collection",
      label: "Add to Collection",
      icon: FolderPlus,
      onSelect: () => onOpenCollectionPicker(item),
    },
    {
      id: "queue-favorite",
      label: item.isFavorite ? "Remove Favorite" : "Favorite",
      icon: Star,
      onSelect: () => onToggleFavorite(item),
    },
    {
      id: "queue-edit",
      label: "Edit Title & Tags",
      icon: Pencil,
      onSelect: () => onEditClip(item),
    },
    {
      id: "queue-reveal",
      label: "Reveal Original File",
      icon: FolderOpen,
      onSelect: () => onRevealFile(item),
    },
    { id: "queue-sep", type: "separator" },
    {
      id: "queue-delete",
      label: "Delete Clip",
      icon: Trash2,
      danger: true,
      onSelect: () => onDeleteClip(item),
    },
  ];
}

export function buildPlayerStageContextMenuEntries(params: {
  clip: ClipSummary;
  canSaveSelection: boolean;
  settingCover: boolean;
  takingSnapshot: boolean;
  onOpenCollectionPicker: (clip: ClipSummary) => void;
  onOpenSaveTrim: () => void;
  onSendToEditor: () => void;
  onSetCover: () => void;
  onSnapshot: () => void;
  onToggleFavorite: (clip: ClipSummary) => void;
  onEditClip: (clip: ClipSummary) => void;
  onRevealFile: (clip: ClipSummary) => void;
  onDeleteClip: (clip: ClipSummary) => void;
}): ContextMenuEntry[] {
  const {
    clip,
    canSaveSelection,
    settingCover,
    takingSnapshot,
    onOpenCollectionPicker,
    onOpenSaveTrim,
    onSendToEditor,
    onSetCover,
    onSnapshot,
    onToggleFavorite,
    onEditClip,
    onRevealFile,
    onDeleteClip,
  } = params;

  const inTauri = isTauriRuntime();

  return [
    {
      id: "player-collection",
      label:
        clip.collectionCount > 0
          ? `Add to Collection (${clip.collectionCount})`
          : "Add to Collection",
      icon: FolderPlus,
      onSelect: () => onOpenCollectionPicker(clip),
    },
    {
      id: "player-save-trim",
      label: "Save Selection as Clip",
      icon: BookmarkPlus,
      disabled: !canSaveSelection,
      onSelect: onOpenSaveTrim,
    },
    {
      id: "player-send-to-editor",
      label: "Send to Editor",
      icon: ListPlus,
      disabled: !canSaveSelection,
      onSelect: onSendToEditor,
    },
    {
      id: "player-set-cover",
      label: "Set Frame as Cover",
      icon: ImageIcon,
      disabled: settingCover || !inTauri,
      onSelect: onSetCover,
    },
    {
      id: "player-snapshot",
      label: "Snapshot Frame (PNG)",
      icon: Camera,
      disabled: takingSnapshot || !inTauri,
      onSelect: onSnapshot,
    },
    { id: "player-sep-1", type: "separator" },
    {
      id: "player-favorite",
      label: clip.isFavorite ? "Remove Favorite" : "Favorite",
      icon: Star,
      onSelect: () => onToggleFavorite(clip),
    },
    {
      id: "player-edit",
      label: "Edit Title & Tags",
      icon: Pencil,
      onSelect: () => onEditClip(clip),
    },
    {
      id: "player-reveal",
      label: "Reveal Original File",
      icon: FolderOpen,
      onSelect: () => onRevealFile(clip),
    },
    { id: "player-sep-2", type: "separator" },
    {
      id: "player-delete",
      label: "Delete Clip",
      icon: Trash2,
      danger: true,
      onSelect: () => onDeleteClip(clip),
    },
  ];
}
