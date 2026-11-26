import { useEffect, useMemo, useRef, useState } from "react";
import { Check, Film, Search, X } from "lucide-react";
import { usePresence } from "../../hooks/usePresence";
import { getThumbStreamUrl } from "../../lib/api";
import { formatDuration } from "../../lib/format";
import type { ClipSummary } from "../../lib/types";

interface EditorClipPickerModalProps {
  open: boolean;
  clips: ClipSummary[];
  streamerBaseUrl: string;
  streamerToken: string;
  onClose: () => void;
  onAddClips: (selectedClips: ClipSummary[]) => void;
}

export function EditorClipPickerModal({
  open,
  clips,
  streamerBaseUrl,
  streamerToken,
  onClose,
  onAddClips,
}: EditorClipPickerModalProps) {
  const [query, setQuery] = useState("");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const { present, isExiting } = usePresence(open, 140);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelectedIds([]);
    const timer = window.setTimeout(() => searchRef.current?.focus(), 20);
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", handleEsc, true);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("keydown", handleEsc, true);
    };
  }, [open, onClose]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clips;
    return clips.filter((c) => {
      const title = (c.title || c.fileName).toLowerCase();
      return title.includes(q) || c.gameName.toLowerCase().includes(q);
    });
  }, [clips, query]);

  if (!present) return null;

  const toggleId = (id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleConfirm = () => {
    const map = new Map(clips.map((c) => [c.id, c]));
    const picked = selectedIds
      .map((id) => map.get(id))
      .filter((c): c is ClipSummary => Boolean(c));
    if (picked.length > 0) {
      onAddClips(picked);
    }
    onClose();
  };

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30 p-4 ${
        isExiting ? "modal-backdrop-exit pointer-events-none" : "modal-backdrop-enter"
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-picker-title"
        className={`glass-dock w-full max-w-[540px] rounded-[16px] p-5 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2
              id="editor-picker-title"
              className="text-[16px] font-semibold text-[var(--text-primary)]"
            >
              Add Clips from Library
            </h2>
            <p className="mt-0.5 text-[12px] text-[var(--text-secondary)]">
              Select one or more clips to append to the timeline.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="btn-icon flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="relative mt-3.5">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 h-3.5 w-3.5 -translate-y-1/2 text-[var(--text-muted)]"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter library clips..."
            aria-label="Filter library clips"
            className="glint-input h-9 w-full rounded-[8px] pr-3 pl-8 text-[12px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div className="glint-scroll mt-3 max-h-[300px] space-y-1.5 overflow-y-auto rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2 shadow-[var(--border-card-specular)]">
          {filtered.length === 0 ? (
            <p className="py-6 text-center text-[12px] text-[var(--text-muted)]">
              {clips.length === 0
                ? "No clips loaded in your library yet."
                : "No clips match that filter."}
            </p>
          ) : (
            filtered.map((clip) => {
              const checked = selectedIds.includes(clip.id);
              const title = clip.title?.trim() || clip.fileName;
              const thumbSrc = streamerBaseUrl
                ? getThumbStreamUrl(streamerBaseUrl, streamerToken, clip.id, clip.thumbUrl)
                : "";

              return (
                <button
                  key={clip.id}
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  onClick={() => toggleId(clip.id)}
                  className={`nav-item-press flex w-full items-center gap-2.5 rounded-[8px] border px-2.5 py-2 text-left ${
                    checked
                      ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)]"
                      : "border-transparent hover:bg-slate-900/5"
                  }`}
                >
                  <span
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border ${
                      checked
                        ? "border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white"
                        : "border-[var(--border-control)] bg-[var(--surface-control)]"
                    }`}
                  >
                    {checked && <Check className="h-3 w-3" aria-hidden="true" />}
                  </span>

                  <div className="aspect-video w-14 shrink-0 overflow-hidden rounded-[6px] bg-[var(--surface-cinema-frame)]">
                    {thumbSrc ? (
                      <img src={thumbSrc} alt={title} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-400">
                        <Film className="h-3.5 w-3.5" aria-hidden="true" />
                      </div>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                      {title}
                    </p>
                    <p className="font-mono-tabular truncate text-[11px] text-[var(--text-secondary)]">
                      {clip.gameName || "Desktop"} · {formatDuration(clip.durationSec)}
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="font-mono-tabular text-[12px] text-[var(--text-secondary)]">
            {selectedIds.length} selected
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn-secondary h-9 px-4 text-[13px]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleConfirm}
              disabled={selectedIds.length === 0}
              className="btn-primary h-9 px-4 text-[13px]"
            >
              Add to Timeline
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
