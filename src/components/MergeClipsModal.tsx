import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Film, Layers, X } from "lucide-react";
import { useDialogModal } from "../hooks/useDialogModal";
import { usePresence } from "../hooks/usePresence";
import { getThumbStreamUrl } from "../lib/api";
import { formatDuration } from "../lib/format";
import type { ClipSummary, MergeClipsRequest } from "../lib/types";

interface MergeClipsModalProps {
  open: boolean;
  clips: ClipSummary[];
  initialTitle?: string;
  streamerBaseUrl: string;
  streamerToken: string;
  defaultCopyToClipboard: boolean;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (request: MergeClipsRequest) => Promise<void>;
}

export function MergeClipsModal({
  open,
  clips,
  initialTitle = "",
  streamerBaseUrl,
  streamerToken,
  defaultCopyToClipboard,
  busy = false,
  error = null,
  onClose,
  onSubmit,
}: MergeClipsModalProps) {
  const [orderedClips, setOrderedClips] = useState<ClipSummary[]>(() => clips);
  const [outputName, setOutputName] = useState(() => initialTitle);
  const [stretch16x9, setStretch16x9] = useState(false);
  const [normalizeAudio, setNormalizeAudio] = useState(false);
  const [addToLibrary, setAddToLibrary] = useState(true);
  const [copyToClipboard, setCopyToClipboard] = useState(
    () => defaultCopyToClipboard
  );
  const [failedThumbIds, setFailedThumbIds] = useState<Set<string>>(() => new Set());

  const containerRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const { present, isExiting } = usePresence(open, 130);

  useEffect(() => {
    if (open) {
      setOrderedClips(clips);
      setOutputName(initialTitle);
      setStretch16x9(false);
      setNormalizeAudio(false);
      setAddToLibrary(true);
      setCopyToClipboard(defaultCopyToClipboard);
      setFailedThumbIds(new Set());
    }
  }, [open, clips, initialTitle, defaultCopyToClipboard]);

  useDialogModal({
    open,
    containerRef,
    initialFocusRef: nameInputRef,
    onClose: () => {
      if (!busy) onClose();
    },
  });

  const totalDurationSec = useMemo(
    () => orderedClips.reduce((sum, item) => sum + Math.max(0, item.durationSec || 0), 0),
    [orderedClips]
  );

  if (!present) return null;

  const moveClip = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= orderedClips.length) return;
    setOrderedClips((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(target, 0, item);
      return next;
    });
  };

  const removeClip = (clipId: string) => {
    if (orderedClips.length <= 2) return;
    setOrderedClips((prev) => prev.filter((item) => item.id !== clipId));
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || orderedClips.length < 2) return;
    await onSubmit({
      clipIds: orderedClips.map((c) => c.id),
      outputName: outputName.trim() ? outputName.trim() : null,
      aspectMode: stretch16x9 ? "stretch_16_9" : "original",
      normalizeAudio,
      copyToClipboard,
      addToLibrary,
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
        aria-labelledby="merge-clips-modal-title"
        className={`glass-dock w-full max-w-[520px] rounded-[16px] p-6 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[var(--accent-primary)]" aria-hidden="true" />
            <h2
              id="merge-clips-modal-title"
              className="text-[16px] font-semibold text-[var(--text-primary)]"
            >
              Merge Clips Montage
            </h2>
          </div>
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

        <p className="font-mono-tabular mt-1 text-[12px] font-medium text-[var(--text-secondary)]">
          {orderedClips.length} clips · Total duration {formatDuration(totalDurationSec)}
        </p>

        <div className="glint-scroll mt-3.5 max-h-[224px] space-y-1.5 overflow-y-auto rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2 shadow-[var(--border-card-specular)]">
          {orderedClips.map((item, idx) => {
            const title = item.title?.trim() || item.fileName;
            const thumbSrc = getThumbStreamUrl(
              streamerBaseUrl,
              streamerToken,
              item.id,
              item.thumbUrl
            );
            const showThumb = Boolean(thumbSrc) && !failedThumbIds.has(item.id);

            return (
              <div
                key={item.id}
                data-merge-clip-id={item.id}
                className="flex items-center gap-2.5 rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-control)] px-2.5 py-2"
              >
                <span className="font-mono-tabular w-4 shrink-0 text-[11px] font-semibold text-[var(--text-muted)]">
                  {idx + 1}
                </span>

                <div className="h-9 w-16 shrink-0 overflow-hidden rounded-[6px] bg-[var(--surface-cinema-frame)]">
                  {showThumb ? (
                    <img
                      src={thumbSrc}
                      alt={title}
                      onError={() =>
                        setFailedThumbIds((prev) => new Set(prev).add(item.id))
                      }
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center text-slate-400">
                      <Film className="h-4 w-4" aria-hidden="true" />
                    </div>
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium text-[var(--text-primary)]">
                    {title}
                  </p>
                  <p className="font-mono-tabular text-[11px] text-[var(--text-secondary)]">
                    {formatDuration(item.durationSec)} · {item.gameName}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => moveClip(idx, -1)}
                    disabled={idx === 0 || busy}
                    aria-label={`Move ${title} up`}
                    title="Move Up"
                    className="btn-secondary h-7 w-7 p-0"
                  >
                    <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveClip(idx, 1)}
                    disabled={idx === orderedClips.length - 1 || busy}
                    aria-label={`Move ${title} down`}
                    title="Move Down"
                    className="btn-secondary h-7 w-7 p-0"
                  >
                    <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeClip(item.id)}
                    disabled={orderedClips.length <= 2 || busy}
                    aria-label={`Remove ${title}`}
                    title={orderedClips.length <= 2 ? "At least 2 clips required" : "Remove clip"}
                    className="btn-secondary h-7 w-7 p-0 text-[var(--text-secondary)] hover:text-[var(--status-error-fg)]"
                  >
                    <X className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-4">
          <label
            htmlFor="merge-output-name"
            className="block text-[12px] font-semibold text-[var(--text-primary)]"
          >
            Output name (optional)
          </label>
          <input
            ref={nameInputRef}
            id="merge-output-name"
            type="text"
            value={outputName}
            onChange={(e) => setOutputName(e.target.value)}
            placeholder="e.g. Match Highlights"
            maxLength={120}
            className="glint-input mt-1.5 h-9 w-full rounded-[8px] px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div className="mt-3 space-y-0.5 rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2 shadow-[var(--border-card-specular)]">
          <label className="flex min-h-[34px] items-center gap-2.5 rounded-[6px] px-2 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-slate-900/5">
            <input
              type="checkbox"
              checked={stretch16x9}
              onChange={(e) => setStretch16x9(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
            />
            <span>Stretch non-16:9 clips to 16:9</span>
          </label>

          <label className="flex min-h-[34px] items-center gap-2.5 rounded-[6px] px-2 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-slate-900/5">
            <input
              type="checkbox"
              checked={normalizeAudio}
              onChange={(e) => setNormalizeAudio(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
            />
            <span>Normalize audio loudness</span>
          </label>

          <label className="flex min-h-[34px] items-center gap-2.5 rounded-[6px] px-2 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-slate-900/5">
            <input
              type="checkbox"
              checked={addToLibrary}
              onChange={(e) => setAddToLibrary(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
            />
            <span>Add merged video to Glint library</span>
          </label>

          <label className="flex min-h-[34px] items-center gap-2.5 rounded-[6px] px-2 text-[13px] font-medium text-[var(--text-primary)] transition-colors hover:bg-slate-900/5">
            <input
              type="checkbox"
              checked={copyToClipboard}
              onChange={(e) => setCopyToClipboard(e.target.checked)}
              disabled={busy}
              className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
            />
            <span>Copy to clipboard when done</span>
          </label>
        </div>

        {error && (
          <p className="mt-3 rounded-[8px] bg-[var(--status-error-bg)] px-3 py-2 text-[12px] font-medium text-[var(--status-error-fg)]">
            {error}
          </p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary h-9 px-3.5 text-[13px]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || orderedClips.length < 2}
            className="btn-primary h-9 px-4 text-[13px]"
          >
            {busy ? "Starting merge..." : `Merge ${orderedClips.length} Clips`}
          </button>
        </div>
      </form>
    </div>
  );
}
