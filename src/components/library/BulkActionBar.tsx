import { useEffect, useState } from "react";
import { Download, FolderMinus, FolderPlus, Layers, Trash2, X } from "lucide-react";
import { usePresence } from "../../hooks/usePresence";
import { isTauriRuntime } from "../../lib/api";
import type { CollectionSummary } from "../../lib/types";

interface BulkActionBarProps {
  selectedCount: number;
  activeCollection: CollectionSummary | null;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onBulkAddToCollection: () => void;
  onBulkRemoveFromCollection: (collection: CollectionSummary) => void;
  onBulkBatchExport: () => void;
  onBulkMerge: () => void;
  onBulkDelete: () => void;
}

export function BulkActionBar({
  selectedCount,
  activeCollection,
  onSelectAll,
  onClearSelection,
  onBulkAddToCollection,
  onBulkRemoveFromCollection,
  onBulkBatchExport,
  onBulkMerge,
  onBulkDelete,
}: BulkActionBarProps) {
  const inTauri = isTauriRuntime();
  const open = selectedCount > 0;
  const { present, isExiting } = usePresence(open, 120);
  const [displayCount, setDisplayCount] = useState(selectedCount);

  useEffect(() => {
    if (selectedCount > 0) {
      setDisplayCount(selectedCount);
    }
  }, [selectedCount]);

  if (!present) return null;

  return (
    <div
      role="region"
      aria-label="Bulk selection actions"
      className={`glass-hud absolute bottom-5 left-1/2 z-30 flex max-w-[calc(100%-32px)] -translate-x-1/2 flex-wrap items-center gap-2 rounded-[14px] px-3.5 py-2.5 ${
        isExiting ? "modal-exit pointer-events-none" : "popover-enter"
      }`}
    >
      <span className="font-mono-tabular px-1 text-[13px] font-semibold text-[var(--text-primary)]">
        {displayCount} selected
      </span>

      <button
        type="button"
        onClick={onSelectAll}
        className="btn-secondary h-8 px-2.5 text-[12px]"
      >
        Select All
      </button>

      <button
        type="button"
        onClick={onClearSelection}
        className="btn-secondary h-8 gap-1 px-2.5 text-[12px]"
      >
        <X className="h-3.5 w-3.5" aria-hidden="true" />
        Clear
      </button>

      <div className="mx-0.5 h-5 w-px bg-[var(--border-hairline)]" aria-hidden="true" />

      <button
        type="button"
        onClick={onBulkAddToCollection}
        className="btn-primary h-8 px-3 text-[12px]"
      >
        <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
        Add to Collection
      </button>

      {activeCollection?.kind === "manual" && (
        <button
          type="button"
          onClick={() => onBulkRemoveFromCollection(activeCollection)}
          className="btn-secondary h-8 px-3 text-[12px]"
        >
          <FolderMinus className="h-3.5 w-3.5" aria-hidden="true" />
          Remove from Collection
        </button>
      )}

      <button
        type="button"
        onClick={onBulkBatchExport}
        disabled={!inTauri}
        title={!inTauri ? "Batch export requires Glint desktop app" : "Export selected clips"}
        className="btn-secondary h-8 gap-1.5 px-3 text-[12px]"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        Batch Export
      </button>

      {displayCount >= 2 && (
        <button
          type="button"
          onClick={onBulkMerge}
          title="Merge to 1 Video"
          className="btn-secondary h-8 px-3 text-[12px]"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden="true" />
          Merge
        </button>
      )}

      <button
        type="button"
        onClick={onBulkDelete}
        className="btn-secondary h-8 px-3 text-[12px] text-[var(--status-error-fg)] hover:bg-[var(--status-error-bg)]"
      >
        <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        Delete
      </button>
    </div>
  );
}
