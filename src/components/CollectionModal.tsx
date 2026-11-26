import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useDialogModal } from "../hooks/useDialogModal";
import { usePresence } from "../hooks/usePresence";

interface CollectionModalProps {
  open: boolean;
  mode: "create" | "rename";
  initialName?: string;
  busy?: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
}

export function CollectionModal({
  open,
  mode,
  initialName = "",
  busy = false,
  onSave,
  onClose,
}: CollectionModalProps) {
  const [name, setName] = useState(initialName);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { present, isExiting } = usePresence(open, 130);

  useEffect(() => {
    if (open) {
      setName(initialName);
    }
  }, [open, initialName]);

  useDialogModal({
    open,
    containerRef,
    initialFocusRef: inputRef,
    onClose: () => {
      if (!busy) onClose();
    },
  });

  if (!present) return null;

  const trimmed = name.trim();
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!trimmed || busy) return;
    onSave(trimmed);
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
        ref={containerRef as unknown as React.RefObject<HTMLFormElement>}
        onSubmit={handleSubmit}
        role="dialog"
        aria-modal="true"
        aria-labelledby="collection-modal-title"
        className={`glass-dock w-full max-w-[440px] rounded-[16px] p-6 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="collection-modal-title"
            className="text-[16px] font-semibold text-[var(--text-primary)]"
          >
            {mode === "create" ? "New Collection" : "Rename Collection"}
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

        <p className="mt-1.5 text-[13px] text-[var(--text-secondary)]">
          Group clips without moving original files.
        </p>

        <div className="mt-4">
          <label
            htmlFor="collection-name-input"
            className="block text-[12px] font-semibold text-[var(--text-primary)]"
          >
            Collection name
          </label>
          <input
            ref={inputRef}
            id="collection-name-input"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Best Clutches"
            maxLength={80}
            className="glint-input mt-1.5 h-9 w-full rounded-[8px] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

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
            disabled={!trimmed || busy}
            className="btn-primary h-9 px-4 text-[13px]"
          >
            {busy ? "Saving..." : mode === "create" ? "Create Collection" : "Save Name"}
          </button>
        </div>
      </form>
    </div>
  );
}
