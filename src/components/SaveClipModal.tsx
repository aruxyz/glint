import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, FolderPlus, X } from "lucide-react";
import { useDialogModal } from "../hooks/useDialogModal";
import { usePresence } from "../hooks/usePresence";
import { formatTimecode } from "../lib/format";
import type { AspectMode, CollectionSummary } from "../lib/types";

interface SaveClipModalProps {
  open: boolean;
  startSec: number;
  endSec: number;
  aspectMode: AspectMode;
  normalizeAudio?: boolean;
  collections: CollectionSummary[];
  busy?: boolean;
  error?: string | null;
  onCreateCollection: (name: string) => Promise<CollectionSummary>;
  onSave: (payload: { title: string | null; collectionIds: string[] }) => Promise<void>;
  onClose: () => void;
}

export function SaveClipModal({
  open,
  startSec,
  endSec,
  aspectMode,
  normalizeAudio = false,
  collections,
  busy = false,
  error = null,
  onCreateCollection,
  onSave,
  onClose,
}: SaveClipModalProps) {
  const [title, setTitle] = useState("");
  const [selectedCollectionIds, setSelectedCollectionIds] = useState<string[]>([]);
  const [quickName, setQuickName] = useState("");
  const [creatingCol, setCreatingCol] = useState(false);

  const containerRef = useRef<HTMLFormElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const { present, isExiting } = usePresence(open, 130);

  const manualCollections = collections.filter((c) => c.kind === "manual");

  useEffect(() => {
    if (open) {
      setTitle("");
      setSelectedCollectionIds([]);
      setQuickName("");
    }
  }, [open]);

  useDialogModal({
    open,
    containerRef,
    initialFocusRef: titleInputRef,
    onClose: () => {
      if (!busy) onClose();
    },
  });

  if (!present) return null;

  const selectedDuration = Math.max(0, endSec - startSec);

  const toggleCollection = (id: string) => {
    setSelectedCollectionIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleQuickCreate = async () => {
    const trimmed = quickName.trim();
    if (!trimmed || creatingCol || busy) return;
    setCreatingCol(true);
    try {
      const created = await onCreateCollection(trimmed);
      setSelectedCollectionIds((prev) =>
        prev.includes(created.id) ? prev : [...prev, created.id]
      );
      setQuickName("");
    } finally {
      setCreatingCol(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || selectedDuration < 0.2) return;
    await onSave({
      title: title.trim() ? title.trim() : null,
      collectionIds: selectedCollectionIds,
    });
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 ${
        isExiting ? "modal-backdrop-exit pointer-events-none" : "modal-backdrop-enter"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        ref={containerRef}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-clip-modal-title"
        className={`glass-dock w-full max-w-[440px] rounded-[16px] p-6 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="save-clip-modal-title"
            className="text-[16px] font-semibold text-[var(--text-primary)]"
          >
            Save Selection as Clip
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close modal"
            className="btn-icon flex h-8 w-8 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p className="font-mono-tabular text-[12px] font-medium text-[var(--text-secondary)]">
            {formatTimecode(startSec)} to {formatTimecode(endSec)} · {selectedDuration.toFixed(2)}s
          </p>
          {aspectMode === "stretch_16_9" && (
            <span className="rounded-[6px] bg-[var(--accent-tint-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-text)]">
              Stretch 16:9
            </span>
          )}
          {normalizeAudio && (
            <span className="rounded-[6px] bg-[var(--accent-tint-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--accent-text)]">
              Normalize
            </span>
          )}
        </div>

        <div className="mt-4">
          <label
            htmlFor="save-clip-title"
            className="block text-[12px] font-semibold text-[var(--text-primary)]"
          >
            Clip title (optional)
          </label>
          <input
            ref={titleInputRef}
            id="save-clip-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Optional title, e.g. Mid clutch"
            maxLength={120}
            className="glint-input mt-1.5 h-9 w-full rounded-[8px] px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div className="mt-4">
          <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
            Add to Collections (optional)
          </span>
          <div className="mt-1.5 max-h-[168px] space-y-1 overflow-y-auto rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-1.5 shadow-[var(--border-card-specular)]">
            {manualCollections.length === 0 ? (
              <p className="px-2 py-2 text-[12px] text-[var(--text-muted)]">
                No collections yet. Create one below.
              </p>
            ) : (
              manualCollections.map((col) => {
                const checked = selectedCollectionIds.includes(col.id);
                return (
                  <button
                    key={col.id}
                    type="button"
                    role="checkbox"
                    aria-checked={checked}
                    disabled={busy}
                    onClick={() => toggleCollection(col.id)}
                    className="nav-item-press flex w-full items-center justify-between gap-2.5 rounded-[7px] px-2.5 py-1.5 text-left text-[13px] text-[var(--text-primary)] hover:bg-slate-900/5"
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

          <div className="mt-2 flex items-center gap-1.5">
            <input
              type="text"
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleQuickCreate();
                }
              }}
              placeholder="New collection..."
              aria-label="New collection name"
              className="glint-input h-8 min-w-0 flex-1 rounded-[7px] px-2.5 text-[12px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
            <button
              type="button"
              onClick={handleQuickCreate}
              disabled={!quickName.trim() || creatingCol || busy}
              className="btn-secondary h-8 shrink-0 px-2.5 text-[12px]"
            >
              <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
              Add
            </button>
          </div>
        </div>

        {error && (
          <div
            role="alert"
            className="mt-3 rounded-[8px] bg-[var(--status-error-bg)] px-3 py-2 text-[12px] font-medium text-[var(--status-error-fg)]"
          >
            {error}
          </div>
        )}

        <div className="mt-6 flex items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary h-9 px-4 text-[13px]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || selectedDuration < 0.2}
            className="btn-primary h-9 px-4 text-[13px]"
          >
            {busy ? "Saving clip..." : "Save Clip"}
          </button>
        </div>
      </form>
    </div>
  );
}
