import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { useDialogModal } from "../../hooks/useDialogModal";
import { usePresence } from "../../hooks/usePresence";
import { formatDuration } from "../../lib/format";

interface SaveProjectModalProps {
  open: boolean;
  mode: "save" | "save_as";
  initialName: string;
  segmentCount: number;
  totalDurationSec: number;
  busy?: boolean;
  error?: string | null;
  onSave: (name: string) => Promise<void> | void;
  onClose: () => void;
}

export function SaveProjectModal({
  open,
  mode,
  initialName,
  segmentCount,
  totalDurationSec,
  busy = false,
  error = null,
  onSave,
  onClose,
}: SaveProjectModalProps) {
  const [name, setName] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { present, isExiting } = usePresence(open, 140);

  useEffect(() => {
    if (!open) return;
    setName(initialName);
    const timer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 20);
    return () => window.clearTimeout(timer);
  }, [initialName, open]);

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
    void onSave(trimmed);
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
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-project-modal-title"
        className={`glass-dock w-full max-w-[440px] rounded-[16px] p-6 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="save-project-modal-title"
              className="text-[16px] font-semibold text-[var(--text-primary)]"
            >
              {mode === "save_as" ? "Save Project As" : "Save Project"}
            </h2>
            <p className="mt-0.5 text-[13px] text-[var(--text-secondary)]">
              Save timeline segments, adjustments, and export settings.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close modal"
            className="btn-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-4">
          <label
            htmlFor="editor-project-name-input"
            className="block text-[12px] font-semibold text-[var(--text-primary)]"
          >
            Project name
          </label>
          <input
            ref={inputRef}
            id="editor-project-name-input"
            type="text"
            maxLength={80}
            value={name}
            disabled={busy}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Valorant Ranked Highlights"
            className="glint-input mt-1.5 h-9 w-full rounded-[8px] px-3 text-[13px] text-[var(--text-primary)]"
          />

          <p className="font-mono-tabular mt-2.5 text-[12px] text-[var(--text-secondary)]">
            {segmentCount} {segmentCount === 1 ? "segment" : "segments"} · {formatDuration(totalDurationSec)}
          </p>

          {error && (
            <div
              role="alert"
              className="mt-3 rounded-[8px] border border-[var(--status-error-fg)]/20 bg-[var(--status-error-bg)] px-3 py-2 text-[12px] text-[var(--status-error-fg)]"
            >
              {error}
            </div>
          )}

          <div className="mt-5 flex items-center justify-end gap-2.5">
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
              {busy ? "Saving..." : "Save Project"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
