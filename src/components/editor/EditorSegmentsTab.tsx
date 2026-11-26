import { ArrowDown, ArrowUp, Check, Copy, Film, Plus, Sliders, Trash2 } from "lucide-react";
import { getThumbStreamUrl } from "../../lib/api";
import {
  getMaxCrossfadeSec,
  getMaxFadeInSec,
  getMaxFadeOutSec,
  getSegmentEffectiveDuration,
  MIN_TRANSITION_SEC,
} from "../../lib/editor";
import { formatTimecode } from "../../lib/format";
import type { EditorSegment } from "../../lib/types";

interface EditorSegmentsTabProps {
  segments: EditorSegment[];
  selectedSegmentIds: string[];
  primarySelectedSegmentId: string | null;
  streamerBaseUrl: string;
  streamerToken: string;
  isNarrow: boolean;
  onSelectSegment: (segmentId: string, mode?: "single" | "toggle" | "range") => void;
  onSelectAllSegments: () => void;
  onClearSegmentSelection: () => void;
  onMoveSegment: (index: number, delta: -1 | 1) => void;
  onDuplicateSegment: (index: number) => void;
  onRemoveSegment: (segmentId: string) => void;
  onBatchAdjustSelected: () => void;
  onRemoveSelectedSegments: () => void;
  onOpenClipPicker: () => void;
  onUpdateSegment: (
    segmentId: string,
    patch: Partial<EditorSegment>,
    options?: { recordHistory?: boolean }
  ) => void;
  onBeginTransaction: () => void;
  onCommitTransaction: () => void;
}

export function EditorSegmentsTab({
  segments,
  selectedSegmentIds,
  primarySelectedSegmentId,
  streamerBaseUrl,
  streamerToken,
  isNarrow,
  onSelectSegment,
  onSelectAllSegments,
  onClearSegmentSelection,
  onMoveSegment,
  onDuplicateSegment,
  onRemoveSegment,
  onBatchAdjustSelected,
  onRemoveSelectedSegments,
  onOpenClipPicker,
  onUpdateSegment,
  onBeginTransaction,
  onCommitTransaction,
}: EditorSegmentsTabProps) {
  const allSelected = segments.length > 0 && selectedSegmentIds.length === segments.length;
  const isMultiSelect = selectedSegmentIds.length > 1;
  const primaryIdx = segments.findIndex((s) => s.id === primarySelectedSegmentId);
  const primarySeg = primaryIdx >= 0 ? segments[primaryIdx] : null;
  const maxInSec =
    primaryIdx === 0
      ? getMaxFadeInSec(segments)
      : primaryIdx > 0
        ? getMaxCrossfadeSec(segments, primaryIdx)
        : 0;
  const maxOutSec =
    primaryIdx >= 0 && primaryIdx === segments.length - 1 ? getMaxFadeOutSec(segments) : 0;
  const primaryInDur =
    primarySeg &&
    ((primaryIdx === 0 && primarySeg.transitionIn === "fade") ||
      (primaryIdx > 0 && primarySeg.transitionIn === "crossfade"))
      ? primarySeg.transitionInDurationSec
      : 0;
  const primaryOutDur =
    primarySeg && primaryIdx === segments.length - 1 && primarySeg.transitionOut === "fade"
      ? primarySeg.transitionOutDurationSec
      : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border-hairline)] px-3.5 py-2.5">
        <span className="text-[12px] font-semibold text-[var(--text-secondary)]">
          Timeline Order
        </span>
        <div className="flex items-center gap-1.5">
          {segments.length > 0 && (
            <>
              <button
                type="button"
                data-testid="editor-select-all-btn"
                onClick={allSelected ? onClearSegmentSelection : onSelectAllSegments}
                className={`btn-secondary ${isNarrow ? "min-h-[44px] px-3" : "h-7 px-2"} text-[11px]`}
              >
                {allSelected ? "Deselect" : "Select All"}
              </button>
              <button
                type="button"
                onClick={onOpenClipPicker}
                className={`btn-secondary ${isNarrow ? "min-h-[44px] px-3" : "h-7 px-2.5"} text-[11px]`}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                Add from Library
              </button>
            </>
          )}
        </div>
      </div>

      {segments.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-5 text-center">
          <p className="text-[12px] leading-5 text-[var(--text-muted)]">
            Select clips on the left or click + Add Clips.
          </p>
        </div>
      ) : (
        <div className="glint-scroll flex-1 space-y-2 overflow-y-auto p-3">
          {segments.map((seg, idx) => {
            const selected = selectedSegmentIds.includes(seg.id);
            const isPrimary = seg.id === primarySelectedSegmentId;
            const title = seg.clip.title?.trim() || seg.clip.fileName;
            const effectiveDur = getSegmentEffectiveDuration(seg);
            const thumbSrc = streamerBaseUrl
              ? getThumbStreamUrl(streamerBaseUrl, streamerToken, seg.clip.id, seg.clip.thumbUrl)
              : "";
            const hasColorEdit = seg.vibrance !== 0 || seg.saturation !== 100;
            const hasFramingEdit = seg.framing !== "fit";

            return (
              <div
                key={seg.id}
                data-editor-segment-row={seg.id}
                data-selected={selected ? "true" : "false"}
                onClick={(e) => {
                  if (e.ctrlKey || e.metaKey) {
                    onSelectSegment(seg.id, "toggle");
                  } else if (e.shiftKey) {
                    onSelectSegment(seg.id, "range");
                  } else {
                    onSelectSegment(seg.id, "single");
                  }
                }}
                className={`group flex cursor-pointer flex-col gap-1.5 rounded-[10px] border p-2.5 transition-[background-color,border-color,box-shadow] duration-[120ms] ease-[var(--ease-fluent)] ${
                  selected
                    ? isPrimary
                      ? "border-[var(--accent-primary)] bg-[rgba(239,246,255,0.9)] ring-1 ring-[var(--accent-primary)]"
                      : "border-[var(--accent-primary)] bg-[rgba(239,246,255,0.78)]"
                    : "border-[var(--border-hairline)] bg-[var(--surface-card)] shadow-[var(--border-card-specular),var(--shadow-card-rest)] hover:bg-[var(--surface-card-hover)]"
                }`}
              >
                <div className="flex min-w-0 items-center gap-1.5">
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={selected}
                    aria-label={`Select ${title}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectSegment(seg.id, "toggle");
                    }}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-[5px] transition-opacity duration-[120ms] ${
                      isMultiSelect || selected
                        ? "opacity-100"
                        : "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100"
                    }`}
                  >
                    <span
                      className={`flex h-4 w-4 items-center justify-center rounded-[4px] border ${
                        selected
                          ? "border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white"
                          : "border-[var(--border-control)] bg-white/80"
                      }`}
                    >
                      {selected && <Check className="h-3 w-3 stroke-[2.5]" aria-hidden="true" />}
                    </span>
                  </button>

                  <span className="font-mono-tabular w-3.5 shrink-0 text-center text-[11px] font-semibold text-[var(--text-muted)]">
                    {idx + 1}
                  </span>

                  <div className="aspect-video w-11 shrink-0 overflow-hidden rounded-[6px] bg-[var(--surface-cinema-frame)]">
                    {thumbSrc ? (
                      <img
                        src={thumbSrc}
                        alt={title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-slate-400">
                        <Film className="h-3.5 w-3.5" aria-hidden="true" />
                      </div>
                    )}
                  </div>

                  <p
                    data-testid="editor-segment-title"
                    title={title}
                    className="min-w-0 flex-1 truncate text-[12px] font-semibold text-[var(--text-primary)]"
                  >
                    {title}
                  </p>

                  <span className="font-mono-tabular shrink-0 text-[11px] font-medium text-[var(--text-secondary)]">
                    {effectiveDur.toFixed(1)}s
                  </span>
                </div>

                <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 pl-7">
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                    <span className="font-mono-tabular whitespace-nowrap text-[11px] text-[var(--text-secondary)]">
                      {formatTimecode(seg.startSec)} - {formatTimecode(seg.endSec)}
                    </span>
                    {seg.speed !== 1 && (
                      <span className="font-mono-tabular rounded bg-[var(--accent-tint-bg)] px-1.5 py-0.2 text-[10px] font-semibold text-[var(--accent-text)]">
                        {seg.speed}x
                      </span>
                    )}
                    {seg.transitionIn === "crossfade" && idx > 0 && (
                      <span className="font-mono-tabular rounded bg-[var(--accent-tint-bg)] px-1.5 py-0.2 text-[10px] font-semibold text-[var(--accent-text)]">
                        Crossfade {seg.transitionInDurationSec.toFixed(2)}s
                      </span>
                    )}
                    {seg.transitionIn === "fade" && idx === 0 && (
                      <span className="font-mono-tabular rounded bg-[var(--accent-tint-bg)] px-1.5 py-0.2 text-[10px] font-semibold text-[var(--accent-text)]">
                        Fade In {seg.transitionInDurationSec.toFixed(2)}s
                      </span>
                    )}
                    {seg.transitionOut === "fade" && idx === segments.length - 1 && (
                      <span className="font-mono-tabular rounded bg-[var(--accent-tint-bg)] px-1.5 py-0.2 text-[10px] font-semibold text-[var(--accent-text)]">
                        Fade Out {seg.transitionOutDurationSec.toFixed(2)}s
                      </span>
                    )}
                    {hasColorEdit && (
                      <span className="rounded bg-[var(--accent-tint-bg)] px-1.5 py-0.2 text-[10px] font-semibold text-[var(--accent-text)]">
                        Color
                      </span>
                    )}
                    {hasFramingEdit && (
                      <span className="rounded bg-[var(--accent-tint-bg)] px-1.5 py-0.2 text-[10px] font-semibold uppercase text-[var(--accent-text)]">
                        {seg.framing}
                      </span>
                    )}
                  </div>

                  <div
                    onClick={(e) => e.stopPropagation()}
                    className={`flex shrink-0 items-center gap-0.5 transition-opacity duration-[120ms] ${
                      isNarrow || selected
                        ? "opacity-100"
                        : "opacity-80 group-focus-within:opacity-100 group-hover:opacity-100"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => onMoveSegment(idx, -1)}
                      disabled={idx === 0}
                      aria-label={`Move ${title} up`}
                      title="Move up"
                      className="btn-icon flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)] disabled:opacity-35"
                    >
                      <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveSegment(idx, 1)}
                      disabled={idx === segments.length - 1}
                      aria-label={`Move ${title} down`}
                      title="Move down"
                      className="btn-icon flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)] disabled:opacity-35"
                    >
                      <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDuplicateSegment(idx)}
                      aria-label={`Duplicate ${title}`}
                      title="Duplicate"
                      className="btn-icon flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
                    >
                      <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onRemoveSegment(seg.id)}
                      aria-label={`Remove ${title}`}
                      title="Remove segment"
                      className="btn-icon flex h-6 w-6 items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-[var(--status-error-bg)] hover:text-[var(--status-error-fg)]"
                    >
                      <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {primarySeg && (maxInSec >= MIN_TRANSITION_SEC || maxOutSec >= MIN_TRANSITION_SEC) && (
        <div
          data-testid="editor-segments-transition-controls"
          className="space-y-2 border-t border-[var(--border-hairline)] bg-white/40 px-3.5 py-2.5"
        >
          <p className="text-[11px] font-semibold text-[var(--text-secondary)]">
            Transitions ({primarySeg.clip.title?.trim() || primarySeg.clip.fileName})
          </p>

          {maxInSec >= MIN_TRANSITION_SEC && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-medium text-[var(--text-secondary)]">
                  {primaryIdx === 0 ? "Fade In" : "Crossfade In"}
                </span>
                <span className="font-mono-tabular font-semibold text-[var(--text-primary)]">
                  {primaryInDur >= MIN_TRANSITION_SEC ? `${primaryInDur.toFixed(2)}s` : "Cut"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {[0, 0.35, 0.75, 1.0].map((preset) => {
                  if (preset > maxInSec) return null;
                  const active =
                    preset === 0
                      ? primaryInDur < MIN_TRANSITION_SEC
                      : Math.abs(primaryInDur - preset) < 0.02;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        onUpdateSegment(primarySeg.id, {
                          transitionIn: preset === 0 ? "cut" : primaryIdx === 0 ? "fade" : "crossfade",
                          transitionInDurationSec: preset,
                        })
                      }
                      className={`rounded-full px-2 text-[10px] font-semibold ${
                        isNarrow ? "min-h-[44px]" : "h-6"
                      } ${
                        active
                          ? "bg-[var(--accent-primary)] text-white"
                          : "border border-[var(--border-hairline)] bg-white/75 text-[var(--text-secondary)] hover:bg-white"
                      }`}
                    >
                      {preset === 0 ? "Cut" : `${preset.toFixed(2)}s`}
                    </button>
                  );
                })}
                <input
                  type="range"
                  min={0}
                  max={maxInSec}
                  step={0.05}
                  value={primaryInDur}
                  onPointerDown={onBeginTransaction}
                  onPointerUp={onCommitTransaction}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const dur = val >= MIN_TRANSITION_SEC ? Number(val.toFixed(2)) : 0;
                    onUpdateSegment(
                      primarySeg.id,
                      {
                        transitionIn: dur > 0 ? (primaryIdx === 0 ? "fade" : "crossfade") : "cut",
                        transitionInDurationSec: dur,
                      },
                      { recordHistory: false }
                    );
                  }}
                  aria-label={primaryIdx === 0 ? "Fade In duration" : "Crossfade In duration"}
                  className="ml-auto h-1.5 w-24 accent-[var(--accent-primary)]"
                />
              </div>
            </div>
          )}

          {maxOutSec >= MIN_TRANSITION_SEC && (
            <div className="space-y-1">
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="font-medium text-[var(--text-secondary)]">Fade Out</span>
                <span className="font-mono-tabular font-semibold text-[var(--text-primary)]">
                  {primaryOutDur >= MIN_TRANSITION_SEC ? `${primaryOutDur.toFixed(2)}s` : "Cut"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {[0, 0.35, 0.75, 1.0].map((preset) => {
                  if (preset > maxOutSec) return null;
                  const active =
                    preset === 0
                      ? primaryOutDur < MIN_TRANSITION_SEC
                      : Math.abs(primaryOutDur - preset) < 0.02;
                  return (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        onUpdateSegment(primarySeg.id, {
                          transitionOut: preset === 0 ? "cut" : "fade",
                          transitionOutDurationSec: preset,
                        })
                      }
                      className={`rounded-full px-2 text-[10px] font-semibold ${
                        isNarrow ? "min-h-[44px]" : "h-6"
                      } ${
                        active
                          ? "bg-[var(--accent-primary)] text-white"
                          : "border border-[var(--border-hairline)] bg-white/75 text-[var(--text-secondary)] hover:bg-white"
                      }`}
                    >
                      {preset === 0 ? "Cut" : `${preset.toFixed(2)}s`}
                    </button>
                  );
                })}
                <input
                  type="range"
                  min={0}
                  max={maxOutSec}
                  step={0.05}
                  value={primaryOutDur}
                  onPointerDown={onBeginTransaction}
                  onPointerUp={onCommitTransaction}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    const dur = val >= MIN_TRANSITION_SEC ? Number(val.toFixed(2)) : 0;
                    onUpdateSegment(
                      primarySeg.id,
                      {
                        transitionOut: dur > 0 ? "fade" : "cut",
                        transitionOutDurationSec: dur,
                      },
                      { recordHistory: false }
                    );
                  }}
                  aria-label="Fade Out duration"
                  className="ml-auto h-1.5 w-24 accent-[var(--accent-primary)]"
                />
              </div>
            </div>
          )}
        </div>
      )}

      {isMultiSelect && (
        <div
          data-testid="editor-segments-batch-footer"
          className="glass-toolbar flex items-center justify-between gap-2 border-t border-b-0 border-[var(--border-hairline)] px-3 py-2"
        >
          <span className="font-mono-tabular text-[11px] font-semibold text-[var(--text-primary)]">
            {selectedSegmentIds.length} selected
          </span>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={onBatchAdjustSelected}
              className="btn-secondary h-7 gap-1 px-2 text-[11px]"
            >
              <Sliders className="h-3 w-3" aria-hidden="true" />
              Batch Adjust
            </button>
            <button
              type="button"
              onClick={onRemoveSelectedSegments}
              className="btn-danger h-7 px-2 text-[11px]"
            >
              Remove
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
