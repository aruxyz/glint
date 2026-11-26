import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, FolderPlus, X } from "lucide-react";
import { useDialogModal } from "../hooks/useDialogModal";
import { usePresence } from "../hooks/usePresence";
import { api, isTauriRuntime } from "../lib/api";
import type { CollectionSummary } from "../lib/types";

interface CollectionPopoverProps {
  open: boolean;
  clipIds: string[];
  collections: CollectionSummary[];
  initialCollectionIds?: string[];
  onMembershipChanged: (affectedClipIds: string[]) => void;
  onCreateCollection: (name: string, addClipIds: string[]) => Promise<CollectionSummary>;
  onClose: () => void;
}

export function CollectionPopover({
  open,
  clipIds,
  collections,
  initialCollectionIds,
  onMembershipChanged,
  onCreateCollection,
  onClose,
}: CollectionPopoverProps) {
  const manualCollections = collections.filter((c) => c.kind === "manual");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [creating, setCreating] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [cachedClipIds, setCachedClipIds] = useState<string[]>(clipIds);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeOpen = open && clipIds.length > 0;
  const { present, isExiting } = usePresence(activeOpen, 130);

  useEffect(() => {
    if (clipIds.length > 0) {
      setCachedClipIds(clipIds);
    }
  }, [clipIds]);

  const effectiveClipIds = clipIds.length > 0 ? clipIds : cachedClipIds;
  const isBulk = effectiveClipIds.length > 1;
  const singleClipId = effectiveClipIds.length === 1 ? effectiveClipIds[0] : null;
  const clipIdsKey = effectiveClipIds.join(",");

  useEffect(() => {
    if (!activeOpen) return;
    if (isBulk) {
      setSelectedIds([]);
      setLoading(false);
      return;
    }
    if (initialCollectionIds) {
      setSelectedIds(initialCollectionIds);
      setLoading(false);
      return;
    }
    if (!isTauriRuntime() || !singleClipId) {
      setSelectedIds([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    api
      .getClipDetail(singleClipId)
      .then((detail) => setSelectedIds(detail.collectionIds))
      .catch(() => setSelectedIds([]))
      .finally(() => setLoading(false));
  }, [activeOpen, clipIdsKey, isBulk, singleClipId, initialCollectionIds]);

  useDialogModal({
    open: activeOpen,
    containerRef,
    onClose,
  });

  if (!present || effectiveClipIds.length === 0) return null;

  const toggleCollection = async (collectionId: string) => {
    if (pendingId) return;
    const isChecked = selectedIds.includes(collectionId);
    setPendingId(collectionId);
    try {
      await api.modifyCollectionClips({
        collectionId,
        addClipIds: isChecked ? null : effectiveClipIds,
        removeClipIds: isChecked ? effectiveClipIds : null,
      });
      setSelectedIds((prev) =>
        isChecked ? prev.filter((id) => id !== collectionId) : [...prev, collectionId]
      );
      onMembershipChanged(effectiveClipIds);
    } finally {
      setPendingId(null);
    }
  };

  const handleQuickCreate = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = quickName.trim();
    if (!trimmed || creating) return;
    setCreating(true);
    try {
      const created = await onCreateCollection(trimmed, effectiveClipIds);
      setSelectedIds((prev) =>
        prev.includes(created.id) ? prev : [...prev, created.id]
      );
      setQuickName("");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/20 p-4 ${
        isExiting ? "modal-backdrop-exit pointer-events-none" : "modal-backdrop-enter"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-to-collection-title"
        className={`glass-dock w-full max-w-[340px] rounded-[14px] p-4 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] pb-2.5">
          <h2
            id="add-to-collection-title"
            className="text-[14px] font-semibold text-[var(--text-primary)]"
          >
            {isBulk ? `Add ${effectiveClipIds.length} clips to Collection` : "Add to Collection"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close collection picker"
            className="btn-icon flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-2.5 max-h-[220px] space-y-1 overflow-y-auto pr-0.5">
          {loading ? (
            <p className="py-3 text-center text-[12px] text-[var(--text-muted)]">
              Loading collections...
            </p>
          ) : manualCollections.length === 0 ? (
            <p className="py-3 text-center text-[12px] text-[var(--text-muted)]">
              No collections yet. Create one below.
            </p>
          ) : (
            manualCollections.map((col) => {
              const checked = selectedIds.includes(col.id);
              return (
                <button
                  key={col.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  disabled={pendingId === col.id}
                  onClick={() => toggleCollection(col.id)}
                  className="nav-item-press flex w-full items-center justify-between gap-2.5 rounded-[8px] px-2.5 py-2 text-left text-[13px] text-[var(--text-primary)] hover:bg-slate-900/5"
                >
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
                        checked
                          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white"
                          : "border-[var(--border-control)] bg-[var(--surface-control)]"
                      }`}
                    >
                      {checked && <Check className="h-3 w-3" aria-hidden="true" />}
                    </span>
                    <span className="truncate font-medium">{col.name}</span>
                  </span>
                  <span className="font-mono-tabular shrink-0 text-[11px] text-[var(--text-muted)]">
                    {col.clipCount}
                  </span>
                </button>
              );
            })
          )}
        </div>

        <form
          onSubmit={handleQuickCreate}
          className="mt-3 flex items-center gap-1.5 border-t border-[var(--border-hairline)] pt-3"
        >
          <input
            type="text"
            value={quickName}
            onChange={(e) => setQuickName(e.target.value)}
            placeholder="Create new collection..."
            aria-label="New collection name"
            className="glint-input h-8 min-w-0 flex-1 rounded-[7px] px-2.5 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
          <button
            type="submit"
            disabled={!quickName.trim() || creating}
            className="btn-primary h-8 shrink-0 px-2.5 text-[12px]"
          >
            <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
            Add
          </button>
        </form>
      </div>
    </div>
  );
}
