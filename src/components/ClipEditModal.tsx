import { useEffect, useRef, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { useDialogModal } from "../hooks/useDialogModal";
import { usePresence } from "../hooks/usePresence";
import type { ClipSummary, TagItem } from "../lib/types";

interface ClipEditModalProps {
  open: boolean;
  clip: ClipSummary | null;
  availableTags: TagItem[];
  busy?: boolean;
  onSave: (payload: {
    clipId: string;
    title: string;
    tagNames: string[];
  }) => void;
  onClose: () => void;
}

export function ClipEditModal({
  open,
  clip,
  availableTags,
  busy = false,
  onSave,
  onClose,
}: ClipEditModalProps) {
  const [title, setTitle] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagDraft, setTagDraft] = useState("");
  const [cachedClip, setCachedClip] = useState<ClipSummary | null>(clip);

  const containerRef = useRef<HTMLFormElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const activeOpen = open && clip !== null;
  const { present, isExiting } = usePresence(activeOpen, 130);

  useEffect(() => {
    if (open && clip) {
      setCachedClip(clip);
      setTitle(clip.title ?? "");
      setTags([...clip.tags]);
      setTagDraft("");
    }
  }, [open, clip]);

  useDialogModal({
    open: activeOpen,
    containerRef,
    initialFocusRef: titleInputRef,
    onClose: () => {
      if (!busy) onClose();
    },
  });

  const activeClip = clip ?? cachedClip;
  if (!present || !activeClip) return null;

  const addTag = (raw: string) => {
    const clean = raw.trim();
    if (!clean) return;
    if (!tags.some((t) => t.toLowerCase() === clean.toLowerCase())) {
      setTags((prev) => [...prev, clean]);
    }
    setTagDraft("");
  };

  const removeTag = (tagToRemove: string) => {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const pendingTag = tagDraft.trim();
    const finalTags =
      pendingTag && !tags.some((t) => t.toLowerCase() === pendingTag.toLowerCase())
        ? [...tags, pendingTag]
        : tags;
    onSave({
      clipId: activeClip.id,
      // Empty string instructs the Rust backend to clear the custom title back to NULL.
      title: title.trim(),
      tagNames: finalTags,
    });
  };

  const unusedSuggestions = availableTags.filter(
    (t) => !tags.some((selected) => selected.toLowerCase() === t.name.toLowerCase())
  );

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
        aria-labelledby="clip-edit-title"
        className={`glass-dock w-full max-w-[460px] rounded-[16px] p-6 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <h2
            id="clip-edit-title"
            className="text-[16px] font-semibold text-[var(--text-primary)]"
          >
            Edit Title & Tags
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

        <p className="mt-1 truncate text-[12px] text-[var(--text-muted)]">
          File: {activeClip.fileName}
        </p>

        <div className="mt-4">
          <label
            htmlFor="clip-title-input"
            className="block text-[12px] font-semibold text-[var(--text-primary)]"
          >
            Display title
          </label>
          <input
            ref={titleInputRef}
            id="clip-title-input"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={activeClip.fileName}
            maxLength={120}
            className="glint-input mt-1.5 h-9 w-full rounded-[8px] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
        </div>

        <div className="mt-4">
          <label
            htmlFor="clip-tag-input"
            className="block text-[12px] font-semibold text-[var(--text-primary)]"
          >
            Tags
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="clip-tag-input"
              type="text"
              value={tagDraft}
              onChange={(e) => setTagDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addTag(tagDraft);
                }
              }}
              placeholder="Add tag and press Enter"
              className="glint-input h-9 flex-1 rounded-[8px] px-3 text-[13px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => addTag(tagDraft)}
              disabled={!tagDraft.trim()}
              className="btn-secondary h-9 px-3 text-[12px]"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
              Add
            </button>
          </div>

          {tags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-1 rounded-full bg-[var(--accent-tint-bg)] px-2.5 py-0.5 text-[12px] font-medium text-[var(--accent-text)]"
                >
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    aria-label={`Remove tag ${tag}`}
                    className="rounded-full p-0.5 hover:bg-blue-900/10"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {unusedSuggestions.length > 0 && (
            <div className="mt-3">
              <span className="text-[11px] font-medium text-[var(--text-muted)]">
                Existing tags:
              </span>
              <div className="mt-1 flex flex-wrap gap-1">
                {unusedSuggestions.slice(0, 10).map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => addTag(t.name)}
                    className="rounded-full border border-[var(--border-hairline)] bg-[var(--surface-control)] px-2 py-0.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--border-control)] hover:bg-[var(--surface-control-hover)] hover:text-[var(--text-primary)]"
                  >
                    + {t.name}
                  </button>
                ))}
              </div>
            </div>
          )}
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
            disabled={busy}
            className="btn-primary h-9 px-4 text-[13px]"
          >
            {busy ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </form>
    </div>
  );
}
