import { useEffect, useRef, useState } from "react";
import { ArrowLeft, RotateCcw, Scissors, Volume2, VolumeX } from "lucide-react";
import { TrimBar } from "../TrimBar";
import { api, isTauriRuntime } from "../../lib/api";
import {
  canEnableCrossfade,
  clampSaturation,
  clampVibrance,
  createDefaultAudioMix,
  EDITOR_MIN_TRIM_SEC,
  getSegmentEffectiveDuration,
} from "../../lib/editor";
import { formatTimecode } from "../../lib/format";
import type {
  AudioTrack,
  AudioTrackMix,
  EditorFraming,
  EditorSegment,
  EditorSpeed,
  EditorTransition,
} from "../../lib/types";

const SPEED_OPTIONS: ReadonlyArray<EditorSpeed> = [0.5, 1, 1.5, 2];

const FRAMING_OPTIONS: ReadonlyArray<{
  value: EditorFraming;
  label: string;
  title: string;
}> = [
  { value: "fit", label: "Fit", title: "Keep original aspect ratio (letterbox)" },
  { value: "fill", label: "Fill", title: "Fill frame without black bars (cropped)" },
  { value: "stretch", label: "Stretch", title: "Stretch video to fill full frame" },
];

interface EditorAdjustTabProps {
  segments: EditorSegment[];
  selectedSegments: EditorSegment[];
  primarySelectedSegment: EditorSegment | null;
  selectedIndex: number;
  localClipTimeSec: number;
  streamerBaseUrl: string;
  streamerToken: string;
  onSeekLocalClip: (clipTimeSec: number) => void;
  onUpdateSegment: (
    segmentId: string,
    patch: Partial<EditorSegment>,
    options?: { recordHistory?: boolean }
  ) => void;
  onUpdateSegments: (
    segmentIds: string[],
    patch: Partial<EditorSegment>,
    options?: { recordHistory?: boolean }
  ) => void;
  onBeginTransaction: () => void;
  onCommitTransaction: () => void;
  onSwitchToSegments: () => void;
  onClearMultiSelection: () => void;
}

function areAllEqual<T>(items: EditorSegment[], getter: (seg: EditorSegment) => T): boolean {
  if (items.length <= 1) return true;
  const first = getter(items[0]);
  return items.every((item) => getter(item) === first);
}

export function EditorAdjustTab({
  segments,
  selectedSegments,
  primarySelectedSegment,
  selectedIndex,
  localClipTimeSec,
  streamerBaseUrl,
  streamerToken,
  onSeekLocalClip,
  onUpdateSegment,
  onUpdateSegments,
  onBeginTransaction,
  onCommitTransaction,
  onSwitchToSegments,
  onClearMultiSelection,
}: EditorAdjustTabProps) {
  const trackCacheRef = useRef<Map<string, AudioTrack[]>>(new Map());
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const sliderDraggingRef = useRef(false);
  const trimBarDraggingRef = useRef(false);

  const selectedSegment = primarySelectedSegment ?? selectedSegments[0] ?? null;
  const isBatch = selectedSegments.length > 1;
  const targetIds = selectedSegments.map((s) => s.id);

  useEffect(() => {
    const finishSliderDrag = () => {
      if (!sliderDraggingRef.current) return;
      sliderDraggingRef.current = false;
      onCommitTransaction();
    };
    window.addEventListener("pointerup", finishSliderDrag);
    window.addEventListener("pointercancel", finishSliderDrag);
    return () => {
      window.removeEventListener("pointerup", finishSliderDrag);
      window.removeEventListener("pointercancel", finishSliderDrag);
    };
  }, [onCommitTransaction]);

  useEffect(() => {
    if (!selectedSegment || isBatch) {
      setTracks([]);
      return;
    }

    const clip = selectedSegment.clip;
    const fallbackTracks: AudioTrack[] = Array.from(
      { length: Math.max(1, clip.audioTrackCount || 1) },
      (_, idx) => ({
        id: `${clip.id}-track-${idx}`,
        clipId: clip.id,
        streamIndex: idx,
        trackOrder: idx,
        label: idx === 0 ? "Track 1 · Game Audio" : `Track ${idx + 1}`,
        codec: "aac",
        channels: 2,
        sampleRate: 48000,
        bitrate: null,
      })
    );

    const cached = trackCacheRef.current.get(clip.id);
    if (cached) {
      setTracks(cached);
      return;
    }

    setTracks(fallbackTracks);
    if (!isTauriRuntime()) return;

    let active = true;
    api
      .getClipDetail(clip.id)
      .then((detail) => {
        if (!active) return;
        const resolved =
          detail.audioTracks.length > 0 ? detail.audioTracks : fallbackTracks;
        trackCacheRef.current.set(clip.id, resolved);
        setTracks(resolved);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [isBatch, selectedSegment?.clip.id, selectedSegment?.clip.audioTrackCount]);

  if (!selectedSegment) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center p-6 text-center">
        <p className="text-[13px] font-medium text-[var(--text-secondary)]">
          Select a segment to edit trim, speed, color, framing, or audio.
        </p>
        {segments.length > 0 && (
          <button
            type="button"
            onClick={onSwitchToSegments}
            className="btn-secondary mt-3 h-8 px-3 text-[12px]"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            View Segments
          </button>
        )}
      </div>
    );
  }

  const applyPatch = (
    patch: Partial<EditorSegment>,
    options?: { recordHistory?: boolean }
  ) => {
    if (isBatch) {
      onUpdateSegments(targetIds, patch, options);
    } else {
      onUpdateSegment(selectedSegment.id, patch, options);
    }
  };

  const handleSliderPointerDown = () => {
    if (!sliderDraggingRef.current) {
      sliderDraggingRef.current = true;
      onBeginTransaction();
    }
  };

  const speedMixed = isBatch && !areAllEqual(selectedSegments, (s) => s.speed);
  const vibranceMixed = isBatch && !areAllEqual(selectedSegments, (s) => s.vibrance);
  const saturationMixed = isBatch && !areAllEqual(selectedSegments, (s) => s.saturation);
  const framingMixed = isBatch && !areAllEqual(selectedSegments, (s) => s.framing);
  const masterVolMixed = isBatch && !areAllEqual(selectedSegments, (s) => s.masterVolume);
  const masterMutedMixed = isBatch && !areAllEqual(selectedSegments, (s) => s.masterMuted);

  const allColorDefault = selectedSegments.every(
    (s) => s.vibrance === 0 && s.saturation === 100
  );

  const clip = selectedSegment.clip;
  const clipDur = Math.max(EDITOR_MIN_TRIM_SEC, clip.durationSec || EDITOR_MIN_TRIM_SEC);
  const effectiveDur = getSegmentEffectiveDuration(selectedSegment);
  const crossfadeGuard = canEnableCrossfade(segments, selectedIndex);

  const normalizedMixes: AudioTrackMix[] =
    tracks.length > 0
      ? tracks.map((t) => {
          const existing = selectedSegment.audioMix.find(
            (m) => m.trackOrder === t.trackOrder
          );
          return (
            existing ?? {
              trackOrder: t.trackOrder,
              streamIndex: t.streamIndex,
              muted: false,
              volume: 1,
            }
          );
        })
      : selectedSegment.audioMix;

  const isMultiTrack = !isBatch && tracks.length > 1;

  const updateTrackMix = (
    trackOrder: number,
    next: Partial<AudioTrackMix>,
    options?: { recordHistory?: boolean }
  ) => {
    const updated = normalizedMixes.map((m) =>
      m.trackOrder === trackOrder ? { ...m, ...next } : m
    );
    onUpdateSegment(selectedSegment.id, { audioMix: updated }, options);
  };

  const handleSetIn = () => {
    const nextStart = Math.max(
      0,
      Math.min(localClipTimeSec, selectedSegment.endSec - EDITOR_MIN_TRIM_SEC)
    );
    onUpdateSegment(selectedSegment.id, { startSec: nextStart });
  };

  const handleSetOut = () => {
    const nextEnd = Math.min(
      clipDur,
      Math.max(localClipTimeSec, selectedSegment.startSec + EDITOR_MIN_TRIM_SEC)
    );
    onUpdateSegment(selectedSegment.id, { endSec: nextEnd });
  };

  const handleResetAudio = () => {
    if (isBatch) {
      applyPatch({ masterVolume: 100, masterMuted: false });
      return;
    }
    onUpdateSegment(selectedSegment.id, {
      audioMix: createDefaultAudioMix(tracks.length || clip.audioTrackCount),
      masterVolume: 100,
      masterMuted: false,
    });
  };

  const formatVibranceReadout = (val: number) => {
    if (val > 0) return `+${val}`;
    return `${val}`;
  };

  return (
    <div className="glint-scroll flex-1 space-y-4 overflow-y-auto p-3.5">
      {isBatch && (
        <div
          data-testid="editor-batch-banner"
          className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--accent-primary)]/30 bg-[var(--accent-tint-bg)] px-3 py-2"
        >
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[12px] font-semibold text-[var(--accent-text)]">
              Batch Adjust
            </span>
            <span className="font-mono-tabular rounded bg-white/70 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent-text)]">
              {selectedSegments.length} segments
            </span>
          </div>
          <button
            type="button"
            onClick={onClearMultiSelection}
            className="btn-icon text-[11px] font-semibold text-[var(--accent-text)] underline"
          >
            Single
          </button>
        </div>
      )}

      {!isBatch && (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-[var(--text-primary)]">
              Trim Range
            </span>
            <div className="flex items-center gap-2">
              <span className="font-mono-tabular text-[11px] text-[var(--text-secondary)]">
                {effectiveDur.toFixed(2)}s out
              </span>
              <button
                type="button"
                onClick={() =>
                  onUpdateSegment(selectedSegment.id, { startSec: 0, endSec: clipDur })
                }
                title="Reset segment trim"
                className="btn-icon inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-[var(--accent-text)] hover:bg-[var(--accent-tint-bg)]"
              >
                <RotateCcw className="h-3 w-3" aria-hidden="true" />
                Reset
              </button>
            </div>
          </div>

          <TrimBar
            clip={clip}
            streamerBaseUrl={streamerBaseUrl}
            streamerToken={streamerToken}
            duration={clipDur}
            currentTime={localClipTimeSec}
            startSec={selectedSegment.startSec}
            endSec={selectedSegment.endSec}
            onSeek={onSeekLocalClip}
            onChangeTrim={(nextStart, nextEnd) =>
              onUpdateSegment(
                selectedSegment.id,
                {
                  startSec: nextStart,
                  endSec: nextEnd,
                },
                { recordHistory: !trimBarDraggingRef.current }
              )
            }
            onResetTrim={() =>
              onUpdateSegment(selectedSegment.id, { startSec: 0, endSec: clipDur })
            }
            onTrimDragStart={() => {
              trimBarDraggingRef.current = true;
              onBeginTransaction();
            }}
            onTrimDragEnd={() => {
              trimBarDraggingRef.current = false;
              onCommitTransaction();
            }}
            compact
          />

          <div className="flex items-center justify-between gap-2 pt-0.5">
            <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
              Playhead: {formatTimecode(localClipTimeSec)}
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleSetIn}
                className="btn-secondary h-7 px-2 text-[11px]"
              >
                <Scissors className="h-3 w-3" aria-hidden="true" />
                Set In
              </button>
              <button
                type="button"
                onClick={handleSetOut}
                className="btn-secondary h-7 px-2 text-[11px]"
              >
                Set Out
              </button>
            </div>
          </div>
        </div>
      )}

      <div className={!isBatch ? "border-t border-[var(--border-hairline)] pt-3.5" : ""}>
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-[var(--text-primary)]">
            Playback Speed
          </span>
          {speedMixed && (
            <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
              Mixed
            </span>
          )}
        </div>
        <div role="radiogroup" aria-label="Playback speed" className="mt-2 grid grid-cols-4 gap-1.5">
          {SPEED_OPTIONS.map((spd) => {
            const active = !speedMixed && selectedSegment.speed === spd;
            return (
              <button
                key={spd}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => applyPatch({ speed: spd })}
                className={`btn-toggle-pill font-mono-tabular h-8 rounded-[8px] border text-[12px] ${
                  active
                    ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] font-semibold text-[var(--accent-text)]"
                    : "border-[var(--border-control)] bg-[var(--surface-control)] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-control-hover)]"
                }`}
              >
                {spd}x
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-[var(--border-hairline)] pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-[var(--text-primary)]">
            Color Grading
          </span>
          <button
            type="button"
            data-testid="editor-reset-color-btn"
            disabled={allColorDefault}
            onClick={() => applyPatch({ vibrance: 0, saturation: 100 })}
            className="btn-secondary h-7 px-2 text-[11px] disabled:opacity-45"
          >
            Reset Color
          </button>
        </div>

        <div className="mt-2.5 space-y-3">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="editor-vibrance-slider"
                className="text-[12px] font-medium text-[var(--text-primary)]"
              >
                Digital Vibrance
              </label>
              <button
                type="button"
                onClick={() => applyPatch({ vibrance: 0 })}
                title="Click to reset vibrance to 0"
                className={`font-mono-tabular text-[11px] font-medium ${
                  vibranceMixed
                    ? "text-[var(--text-muted)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--accent-text)]"
                }`}
              >
                {vibranceMixed ? "Mixed" : formatVibranceReadout(selectedSegment.vibrance)}
              </button>
            </div>
            <div className="relative mt-1.5 flex items-center">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 h-3 w-[1.5px] -translate-x-1/2 rounded-full bg-slate-900/20"
              />
              <input
                id="editor-vibrance-slider"
                data-testid="editor-vibrance-slider"
                type="range"
                aria-label="Digital Vibrance"
                min={-100}
                max={100}
                step={1}
                value={selectedSegment.vibrance}
                onPointerDown={handleSliderPointerDown}
                onDoubleClick={() => applyPatch({ vibrance: 0 })}
                onChange={(e) =>
                  applyPatch(
                    { vibrance: clampVibrance(Number(e.target.value)) },
                    { recordHistory: !sliderDraggingRef.current }
                  )
                }
                className="relative z-10 h-1.5 w-full accent-[var(--accent-primary)]"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="editor-saturation-slider"
                className="text-[12px] font-medium text-[var(--text-primary)]"
              >
                Saturation
              </label>
              <button
                type="button"
                onClick={() => applyPatch({ saturation: 100 })}
                title="Click to reset saturation to 100%"
                className={`font-mono-tabular text-[11px] font-medium ${
                  saturationMixed
                    ? "text-[var(--text-muted)]"
                    : "text-[var(--text-secondary)] hover:text-[var(--accent-text)]"
                }`}
              >
                {saturationMixed ? "Mixed" : `${selectedSegment.saturation}%`}
              </button>
            </div>
            <div className="relative mt-1.5 flex items-center">
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-1/2 h-3 w-[1.5px] -translate-x-1/2 rounded-full bg-slate-900/20"
              />
              <input
                id="editor-saturation-slider"
                data-testid="editor-saturation-slider"
                type="range"
                aria-label="Saturation"
                min={0}
                max={200}
                step={1}
                value={selectedSegment.saturation}
                onPointerDown={handleSliderPointerDown}
                onDoubleClick={() => applyPatch({ saturation: 100 })}
                onChange={(e) =>
                  applyPatch(
                    { saturation: clampSaturation(Number(e.target.value)) },
                    { recordHistory: !sliderDraggingRef.current }
                  )
                }
                className="relative z-10 h-1.5 w-full accent-[var(--accent-primary)]"
              />
            </div>
          </div>
        </div>
      </div>

      <div className="border-t border-[var(--border-hairline)] pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-[var(--text-primary)]">
            Framing
          </span>
          {framingMixed && (
            <span className="font-mono-tabular text-[11px] text-[var(--text-muted)]">
              Mixed
            </span>
          )}
        </div>
        <div role="radiogroup" aria-label="Framing" className="mt-2 grid grid-cols-3 gap-1.5">
          {FRAMING_OPTIONS.map((opt) => {
            const active = !framingMixed && selectedSegment.framing === opt.value;
            return (
              <button
                key={opt.value}
                type="button"
                role="radio"
                aria-checked={active}
                data-testid={`editor-framing-${opt.value}`}
                title={opt.title}
                onClick={() => applyPatch({ framing: opt.value })}
                className={`btn-toggle-pill h-8 rounded-[8px] border text-[12px] ${
                  active
                    ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] font-semibold text-[var(--accent-text)]"
                    : "border-[var(--border-control)] bg-[var(--surface-control)] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-control-hover)]"
                }`}
              >
                {opt.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="border-t border-[var(--border-hairline)] pt-3.5">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-semibold text-[var(--text-primary)]">
            Segment Audio
          </span>
          <button
            type="button"
            onClick={handleResetAudio}
            className="btn-icon inline-flex h-6 items-center gap-1 rounded px-1.5 text-[11px] font-medium text-[var(--accent-text)] hover:bg-[var(--accent-tint-bg)]"
          >
            Reset
          </button>
        </div>

        <div className="mt-2 space-y-2">
          {isMultiTrack ? (
            tracks.map((track) => {
              const mix = normalizedMixes.find((m) => m.trackOrder === track.trackOrder) ?? {
                trackOrder: track.trackOrder,
                streamIndex: track.streamIndex,
                muted: false,
                volume: 1,
              };
              const trackTitle = track.label?.trim() || `Track ${track.trackOrder + 1}`;
              const pct = Math.round(mix.volume * 100);
              return (
                <div
                  key={track.id || track.trackOrder}
                  className="rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2.5 shadow-[var(--border-card-specular)]"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[12px] font-medium text-[var(--text-primary)]">
                      {trackTitle}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        updateTrackMix(track.trackOrder, { muted: !mix.muted })
                      }
                      aria-label={`Mute ${trackTitle}`}
                      aria-pressed={mix.muted}
                      className={`btn-icon flex h-6 w-6 items-center justify-center rounded ${
                        mix.muted
                          ? "bg-[var(--status-error-bg)] text-[var(--status-error-fg)]"
                          : "bg-slate-900/[0.06] text-[var(--text-secondary)] hover:bg-slate-900/[0.12]"
                      }`}
                    >
                      {mix.muted ? (
                        <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                      ) : (
                        <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                      )}
                    </button>
                  </div>
                  <div className="mt-2 flex items-center gap-2.5">
                    <input
                      type="range"
                      aria-label={`${trackTitle} volume`}
                      min={0}
                      max={2}
                      step={0.05}
                      value={mix.volume}
                      onPointerDown={handleSliderPointerDown}
                      onChange={(e) =>
                        updateTrackMix(
                          track.trackOrder,
                          { volume: Number(e.target.value) },
                          { recordHistory: !sliderDraggingRef.current }
                        )
                      }
                      className="h-1.5 flex-1 accent-[var(--accent-primary)]"
                    />
                    <span className="font-mono-tabular w-10 text-right text-[11px] font-medium text-[var(--text-secondary)]">
                      {pct}%
                    </span>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2.5 shadow-[var(--border-card-specular)]">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[12px] font-medium text-[var(--text-primary)]">
                  Master Volume
                </span>
                <button
                  type="button"
                  onClick={() =>
                    applyPatch({
                      masterMuted: masterMutedMixed ? true : !selectedSegment.masterMuted,
                    })
                  }
                  aria-label="Mute segment audio"
                  aria-pressed={!masterMutedMixed && selectedSegment.masterMuted}
                  className={`btn-icon flex h-6 w-6 items-center justify-center rounded ${
                    !masterMutedMixed && selectedSegment.masterMuted
                      ? "bg-[var(--status-error-bg)] text-[var(--status-error-fg)]"
                      : "bg-slate-900/[0.06] text-[var(--text-secondary)] hover:bg-slate-900/[0.12]"
                  }`}
                >
                  {!masterMutedMixed && selectedSegment.masterMuted ? (
                    <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                  ) : (
                    <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
              <div className="mt-2 flex items-center gap-2.5">
                <input
                  type="range"
                  aria-label="Segment Master Volume"
                  min={0}
                  max={100}
                  step={1}
                  value={selectedSegment.masterMuted ? 0 : selectedSegment.masterVolume}
                  onPointerDown={handleSliderPointerDown}
                  onChange={(e) => {
                    const nextVol = Number(e.target.value);
                    applyPatch(
                      {
                        masterVolume: nextVol,
                        masterMuted: nextVol === 0,
                      },
                      { recordHistory: !sliderDraggingRef.current }
                    );
                  }}
                  className="h-1.5 flex-1 accent-[var(--accent-primary)]"
                />
                <span className="font-mono-tabular w-11 text-right text-[11px] font-medium text-[var(--text-secondary)]">
                  {masterVolMixed || masterMutedMixed
                    ? "Mixed"
                    : `${selectedSegment.masterMuted ? 0 : selectedSegment.masterVolume}%`}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="border-t border-[var(--border-hairline)] pt-3.5">
        {isBatch ? (
          <p className="text-[11px] leading-4 text-[var(--text-muted)]">
            Trim In/Out, per-track audio, and transitions are edited per single segment.
          </p>
        ) : (
          <>
            <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
              Transition In
            </span>
            <div role="radiogroup" aria-label="Transition In" className="mt-2 grid grid-cols-2 gap-1.5">
              {(
                [
                  { value: "cut", label: "Cut" },
                  { value: "crossfade", label: "Crossfade (0.35s)" },
                ] satisfies ReadonlyArray<{ value: EditorTransition; label: string }>
              ).map((opt) => {
                const active = selectedSegment.transitionIn === opt.value;
                const disabled = opt.value === "crossfade" && !crossfadeGuard.allowed;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    disabled={disabled}
                    onClick={() =>
                      onUpdateSegment(selectedSegment.id, { transitionIn: opt.value })
                    }
                    className={`btn-toggle-pill h-8 rounded-[8px] border px-2 text-[12px] ${
                      active
                        ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] font-semibold text-[var(--accent-text)]"
                        : "border-[var(--border-control)] bg-[var(--surface-control)] font-medium text-[var(--text-primary)] hover:bg-[var(--surface-control-hover)] disabled:opacity-45"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            {!crossfadeGuard.allowed && crossfadeGuard.reason && (
              <p className="mt-1.5 text-[11px] leading-4 text-[var(--text-muted)]">
                {crossfadeGuard.reason}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
