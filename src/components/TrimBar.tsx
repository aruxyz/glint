import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Bookmark, RotateCcw, Trash2 } from "lucide-react";
import { getWaveformUrl } from "../lib/api";
import { estimateExportBytes, formatBytes, formatTimecode } from "../lib/format";
import {
  fetchWaveformCached,
  getCachedWaveform,
  mixTrackPeaks,
} from "../lib/waveform";
import type {
  AudioTrack,
  AudioTrackMix,
  ClipMarker,
  ClipSummary,
  ExportPreset,
  MarkerColor,
} from "../lib/types";

const MARKER_COLORS: Record<MarkerColor, { pin: string; label: string }> = {
  blue: { pin: "#1d4ed8", label: "Blue" },
  amber: { pin: "#b45309", label: "Amber" },
  emerald: { pin: "#047857", label: "Emerald" },
  rose: { pin: "#be123c", label: "Rose" },
};

const MARKER_COLOR_ORDER: MarkerColor[] = ["blue", "amber", "emerald", "rose"];

interface TrimBarProps {
  clip: ClipSummary;
  streamerBaseUrl: string;
  streamerToken: string;
  duration: number;
  currentTime: number;
  startSec: number;
  endSec: number;
  tracks?: AudioTrack[];
  mixes?: AudioTrackMix[];
  soloTrackOrder?: number | null;
  markers?: ClipMarker[];
  focusedMarkerId?: string | null;
  onClearFocusedMarker?: () => void;
  onAddMarker?: () => void;
  onUpdateMarker?: (
    id: string,
    patch: { label?: string; color?: MarkerColor; timeSec?: number }
  ) => Promise<void> | void;
  onDeleteMarker?: (id: string) => Promise<void> | void;
  onSeek: (timeSec: number) => void;
  onChangeTrim: (startSec: number, endSec: number) => void;
  onResetTrim: () => void;
  onTrimDragStart?: () => void;
  onTrimDragEnd?: () => void;
  activePresetEstimate?: ExportPreset;
  compact?: boolean;
}

type DragTarget = "playhead" | "start" | "end" | null;

const MIN_TRIM_GAP_SEC = 0.25;

export function TrimBar({
  clip,
  streamerBaseUrl,
  streamerToken,
  duration,
  currentTime,
  startSec,
  endSec,
  tracks = [],
  mixes = [],
  soloTrackOrder = null,
  markers = [],
  focusedMarkerId = null,
  onClearFocusedMarker,
  onAddMarker,
  onUpdateMarker,
  onDeleteMarker,
  onSeek,
  onChangeTrim,
  onResetTrim,
  onTrimDragStart,
  onTrimDragEnd,
  compact = false,
}: TrimBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [peaksByOrder, setPeaksByOrder] = useState<Record<number, number[]>>({});
  const [loadingWaveform, setLoadingWaveform] = useState(false);
  const [manualWaveTrack, setManualWaveTrack] = useState<number | "mix">("mix");
  const prevSoloRef = useRef<number | null>(soloTrackOrder);
  const [soloOverrideActive, setSoloOverrideActive] = useState(soloTrackOrder !== null);
  const [editingMarkerId, setEditingMarkerId] = useState<string | null>(null);
  const [markerLabelDraft, setMarkerLabelDraft] = useState("");
  const [hoveredMarkerId, setHoveredMarkerId] = useState<string | null>(null);
  const markerPopoverRef = useRef<HTMLDivElement>(null);
  const markerInputRef = useRef<HTMLInputElement>(null);

  const safeDuration = duration > 0 ? duration : clip.durationSec || 1;
  const safeFps = clip.fps > 0 ? clip.fps : 60;

  useEffect(() => {
    setManualWaveTrack("mix");
    setPeaksByOrder({});
    setEditingMarkerId(null);
  }, [clip.id]);

  useEffect(() => {
    if (!focusedMarkerId) return;
    const found = markers.find((m) => m.id === focusedMarkerId);
    if (found) {
      setEditingMarkerId(found.id);
      setMarkerLabelDraft(found.label);
    }
  }, [focusedMarkerId, markers]);

  useEffect(() => {
    if (!editingMarkerId) return;
    const raf = window.requestAnimationFrame(() => {
      markerInputRef.current?.focus();
      markerInputRef.current?.select();
    });
    const handleOutside = (e: MouseEvent) => {
      if (
        markerPopoverRef.current &&
        !markerPopoverRef.current.contains(e.target as Node)
      ) {
        setEditingMarkerId(null);
        onClearFocusedMarker?.();
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setEditingMarkerId(null);
        onClearFocusedMarker?.();
      }
    };
    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleEsc, true);
    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleEsc, true);
    };
  }, [editingMarkerId, onClearFocusedMarker]);

  useEffect(() => {
    if (soloTrackOrder !== prevSoloRef.current) {
      prevSoloRef.current = soloTrackOrder;
      setSoloOverrideActive(soloTrackOrder !== null);
    }
  }, [soloTrackOrder]);

  const effectiveWaveTrack: number | "mix" =
    tracks.length <= 1
      ? (tracks[0]?.trackOrder ?? 0)
      : soloOverrideActive && soloTrackOrder !== null
        ? soloTrackOrder
        : manualWaveTrack;

  useEffect(() => {
    if (!streamerBaseUrl || !clip.id) {
      setPeaksByOrder({});
      setLoadingWaveform(false);
      return;
    }

    const ordersToFetch =
      effectiveWaveTrack === "mix"
        ? tracks.length > 0
          ? tracks.map((t) => t.trackOrder)
          : [0]
        : [effectiveWaveTrack];

    const initialHits: Record<number, number[]> = {};
    const pending: number[] = [];
    for (const order of ordersToFetch) {
      const cached = getCachedWaveform(`${clip.id}:${order}`);
      if (cached) {
        initialHits[order] = cached;
      } else {
        pending.push(order);
      }
    }

    if (Object.keys(initialHits).length > 0) {
      setPeaksByOrder((prev) => ({ ...prev, ...initialHits }));
    }

    if (pending.length === 0) {
      setLoadingWaveform(false);
      return;
    }

    const controller = new AbortController();
    setLoadingWaveform(true);

    Promise.allSettled(
      pending.map(async (order) => {
        const url = getWaveformUrl(streamerBaseUrl, streamerToken, clip.id, order);
        const data = await fetchWaveformCached(
          url,
          `${clip.id}:${order}`,
          controller.signal
        );
        return { order, peaks: data };
      })
    )
      .then((results) => {
        if (controller.signal.aborted) return;
        const next: Record<number, number[]> = {};
        for (const res of results) {
          if (res.status === "fulfilled") {
            next[res.value.order] = res.value.peaks;
          }
        }
        if (Object.keys(next).length > 0) {
          setPeaksByOrder((prev) => ({ ...prev, ...next }));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingWaveform(false);
        }
      });

    return () => controller.abort();
  }, [clip.id, effectiveWaveTrack, streamerBaseUrl, streamerToken, tracks]);

  const selectedTrackMix = useMemo(() => {
    if (effectiveWaveTrack === "mix") return null;
    return mixes.find((m) => m.trackOrder === effectiveWaveTrack) ?? null;
  }, [effectiveWaveTrack, mixes]);

  const isSelectedTrackMuted = Boolean(selectedTrackMix?.muted);

  const peaks = useMemo(() => {
    if (effectiveWaveTrack === "mix") {
      if (tracks.length === 0) return peaksByOrder[0] ?? [];
      return mixTrackPeaks(tracks, mixes, peaksByOrder);
    }
    return peaksByOrder[effectiveWaveTrack] ?? [];
  }, [effectiveWaveTrack, mixes, peaksByOrder, tracks]);

  const timeFromClientX = useCallback(
    (clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || rect.width <= 0) return 0;
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      return ratio * safeDuration;
    },
    [safeDuration]
  );

  useEffect(() => {
    if (!dragTarget) return;

    const handlePointerMove = (e: PointerEvent) => {
      const t = timeFromClientX(e.clientX);
      if (dragTarget === "playhead") {
        onSeek(t);
      } else if (dragTarget === "start") {
        const clamped = Math.max(0, Math.min(t, endSec - MIN_TRIM_GAP_SEC));
        onChangeTrim(clamped, endSec);
        onSeek(clamped);
      } else if (dragTarget === "end") {
        const clamped = Math.min(safeDuration, Math.max(t, startSec + MIN_TRIM_GAP_SEC));
        onChangeTrim(startSec, clamped);
        onSeek(clamped);
      }
    };

    const handlePointerUp = () => {
      if (dragTarget === "start" || dragTarget === "end") {
        onTrimDragEnd?.();
      }
      setDragTarget(null);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [
    dragTarget,
    endSec,
    onChangeTrim,
    onSeek,
    onTrimDragEnd,
    safeDuration,
    startSec,
    timeFromClientX,
  ]);

  const handleTrackPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).dataset.trimHandle) return;
    setDragTarget("playhead");
    onSeek(timeFromClientX(e.clientX));
  };

  const handleHandleKeyDown = (
    target: "start" | "end",
    e: ReactKeyboardEvent<HTMLDivElement>
  ) => {
    const step = e.shiftKey ? 1 / safeFps : 0.1;
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const delta = e.key === "ArrowLeft" ? -step : step;
    if (target === "start") {
      const next = Math.max(0, Math.min(endSec - MIN_TRIM_GAP_SEC, startSec + delta));
      onChangeTrim(next, endSec);
      onSeek(next);
    } else {
      const next = Math.min(
        safeDuration,
        Math.max(startSec + MIN_TRIM_GAP_SEC, endSec + delta)
      );
      onChangeTrim(startSec, next);
      onSeek(next);
    }
  };

  const startPct = (startSec / safeDuration) * 100;
  const endPct = (endSec / safeDuration) * 100;
  const playheadPct = Math.min(100, Math.max(0, (currentTime / safeDuration) * 100));
  const selectedDur = Math.max(0, endSec - startSec);
  const isTrimmed = startSec > 0.02 || endSec < safeDuration - 0.02;

  const estDiscord10 = useMemo(
    () =>
      estimateExportBytes(selectedDur, clip.fileSizeBytes, safeDuration, "discord_10mb"),
    [selectedDur, clip.fileSizeBytes, safeDuration]
  );
  const estLossless = useMemo(
    () =>
      estimateExportBytes(selectedDur, clip.fileSizeBytes, safeDuration, "lossless_trim"),
    [selectedDur, clip.fileSizeBytes, safeDuration]
  );

  const editingMarker = useMemo(
    () => markers.find((m) => m.id === editingMarkerId) ?? null,
    [editingMarkerId, markers]
  );

  return (
    <div className={markers.length > 0 ? "pt-3" : ""}>
      <div
        ref={trackRef}
        onPointerDown={handleTrackPointerDown}
        className="relative h-9 w-full cursor-pointer select-none rounded-[8px] bg-slate-900/10"
      >
        {loadingWaveform && peaks.length === 0 ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center px-2"
          >
            <div className="h-1.5 w-full animate-pulse rounded-full bg-slate-900/10" />
          </div>
        ) : isSelectedTrackMuted ? (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 flex items-center px-1"
          >
            <div className="h-[1.5px] w-full rounded-full bg-slate-900/20" />
          </div>
        ) : (
          peaks.length > 0 && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center gap-[2px] overflow-hidden rounded-[8px] px-1"
            >
              {peaks.map((amp, i) => (
                <div
                  key={i}
                  className="flex-1 rounded-full bg-[rgba(15,23,42,0.34)]"
                  style={{
                    height: `${Math.max(14, Math.min(86, Math.round(amp * 86)))}%`,
                  }}
                />
              ))}
            </div>
          )
        )}

        {/* Dimmed regions outside active trim selection */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 rounded-l-[8px] bg-slate-900/20"
          style={{ width: `${startPct}%` }}
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-0 rounded-r-[8px] bg-slate-900/20"
          style={{ width: `${Math.max(0, 100 - endPct)}%` }}
        />

        {/* Selected trim band */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 border-y-2 border-[var(--accent-primary)] bg-[var(--accent-tint-bg)]"
          style={{
            left: `${startPct}%`,
            width: `${Math.max(0, endPct - startPct)}%`,
          }}
        />

        {/* Start handle */}
        <div
          role="slider"
          tabIndex={0}
          data-trim-handle="start"
          aria-label="Trim start time"
          aria-valuemin={0}
          aria-valuemax={Number((endSec - MIN_TRIM_GAP_SEC).toFixed(2))}
          aria-valuenow={Number(startSec.toFixed(2))}
          aria-valuetext={formatTimecode(startSec)}
          onKeyDown={(e) => handleHandleKeyDown("start", e)}
          onPointerDown={(e) => {
            e.stopPropagation();
            onTrimDragStart?.();
            setDragTarget("start");
          }}
          className="group absolute inset-y-0 z-20 -ml-3 flex w-6 cursor-ew-resize items-center justify-center focus-visible:outline-none"
          style={{ left: `${startPct}%` }}
        >
          <span className="h-full w-2.5 rounded-[4px] bg-[var(--accent-primary)] shadow-sm ring-1 ring-white group-focus-visible:ring-2 group-focus-visible:ring-slate-900" />
        </div>

        {/* End handle */}
        <div
          role="slider"
          tabIndex={0}
          data-trim-handle="end"
          aria-label="Trim end time"
          aria-valuemin={Number((startSec + MIN_TRIM_GAP_SEC).toFixed(2))}
          aria-valuemax={Number(safeDuration.toFixed(2))}
          aria-valuenow={Number(endSec.toFixed(2))}
          aria-valuetext={formatTimecode(endSec)}
          onKeyDown={(e) => handleHandleKeyDown("end", e)}
          onPointerDown={(e) => {
            e.stopPropagation();
            onTrimDragStart?.();
            setDragTarget("end");
          }}
          className="group absolute inset-y-0 z-20 -ml-3 flex w-6 cursor-ew-resize items-center justify-center focus-visible:outline-none"
          style={{ left: `${endPct}%` }}
        >
          <span className="h-full w-2.5 rounded-[4px] bg-[var(--accent-primary)] shadow-sm ring-1 ring-white group-focus-visible:ring-2 group-focus-visible:ring-slate-900" />
        </div>

        {/* Playhead needle */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 z-30 -ml-[1px] w-[2px] bg-[var(--accent-primary)]"
          style={{ left: `${playheadPct}%` }}
        >
          <span className="absolute -top-1 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[1px] bg-[var(--accent-primary)] ring-1 ring-white" />
        </div>

        {/* Clip moment markers */}
        {markers.map((marker) => {
          const pct = Math.min(100, Math.max(0, (marker.timeSec / safeDuration) * 100));
          const palette = MARKER_COLORS[marker.color] ?? MARKER_COLORS.blue;
          const isHovered = hoveredMarkerId === marker.id;
          const isEditing = editingMarkerId === marker.id;
          return (
            <div
              key={marker.id}
              className="absolute inset-y-0 z-[25]"
              style={{ left: `${pct}%` }}
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 -ml-[0.75px] w-[1.5px] opacity-75"
                style={{ backgroundColor: palette.pin }}
              />
              <button
                type="button"
                data-trim-handle="marker"
                aria-label={`${marker.label} at ${formatTimecode(marker.timeSec)}`}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onSeek(marker.timeSec);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setEditingMarkerId(marker.id);
                  setMarkerLabelDraft(marker.label);
                }}
                onKeyDown={(e) => {
                  if (e.key === "ContextMenu" || (e.shiftKey && e.key === "F10")) {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditingMarkerId(marker.id);
                    setMarkerLabelDraft(marker.label);
                  }
                }}
                onMouseEnter={() => setHoveredMarkerId(marker.id)}
                onMouseLeave={() =>
                  setHoveredMarkerId((prev) => (prev === marker.id ? null : prev))
                }
                onFocus={() => setHoveredMarkerId(marker.id)}
                onBlur={() =>
                  setHoveredMarkerId((prev) => (prev === marker.id ? null : prev))
                }
                className="absolute -top-2.5 -ml-2.5 flex h-6 w-5 items-start justify-center focus-visible:outline-none"
              >
                <span
                  className={`h-[12px] w-[10px] rounded-[2px] ring-[1.5px] ring-white shadow-sm transition-transform ${
                    isEditing || focusedMarkerId === marker.id
                      ? "scale-125"
                      : "hover:scale-110"
                  }`}
                  style={{
                    backgroundColor: palette.pin,
                    clipPath: "polygon(0 0, 100% 0, 100% 68%, 50% 100%, 0 68%)",
                  }}
                />
              </button>

              {isHovered && !isEditing && (
                <div
                  role="tooltip"
                  className="pointer-events-none absolute -top-9 left-1/2 z-40 -translate-x-1/2 whitespace-nowrap rounded-[6px] bg-[var(--surface-scrim-dark)] px-2 py-0.5 text-[11px] font-medium text-white shadow-sm"
                >
                  {marker.label}{" "}
                  <span className="font-mono-tabular opacity-80">
                    {formatTimecode(marker.timeSec)}
                  </span>
                </div>
              )}
            </div>
          );
        })}

        {editingMarker && (
          <div
            ref={markerPopoverRef}
            role="dialog"
            aria-label="Edit marker"
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              left: `clamp(114px, ${(editingMarker.timeSec / safeDuration) * 100}%, calc(100% - 114px))`,
            }}
            className="glass-dock popover-enter absolute bottom-12 z-50 w-[228px] -translate-x-1/2 rounded-[12px] p-3 shadow-[var(--shadow-glass-float)]"
          >
            <input
              ref={markerInputRef}
              type="text"
              maxLength={40}
              value={markerLabelDraft}
              onChange={(e) => setMarkerLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const nextLabel = markerLabelDraft.trim() || editingMarker.label;
                  void onUpdateMarker?.(editingMarker.id, { label: nextLabel });
                  setEditingMarkerId(null);
                  onClearFocusedMarker?.();
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  setEditingMarkerId(null);
                  onClearFocusedMarker?.();
                }
              }}
              aria-label="Marker label"
              className="glint-input h-8 w-full rounded-[7px] px-2.5 text-[12px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />

            <div className="mt-2.5 flex items-center justify-between gap-2">
              {MARKER_COLOR_ORDER.map((colorKey) => {
                const info = MARKER_COLORS[colorKey];
                const active = editingMarker.color === colorKey;
                return (
                  <button
                    key={colorKey}
                    type="button"
                    aria-label={info.label}
                    aria-pressed={active}
                    onClick={() => void onUpdateMarker?.(editingMarker.id, { color: colorKey })}
                    className={`h-6 w-6 rounded-full transition-transform ${
                      active ? "ring-2 ring-slate-900 ring-offset-1" : "hover:scale-110"
                    }`}
                    style={{ backgroundColor: info.pin }}
                  />
                );
              })}
            </div>

            <div className="mt-2.5 grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => {
                  onChangeTrim(
                    Math.min(editingMarker.timeSec, endSec - MIN_TRIM_GAP_SEC),
                    endSec
                  );
                  setEditingMarkerId(null);
                  onClearFocusedMarker?.();
                }}
                className="btn-secondary h-7 px-2 text-[11px]"
              >
                Set Trim In
              </button>
              <button
                type="button"
                onClick={() => {
                  onChangeTrim(
                    startSec,
                    Math.max(editingMarker.timeSec, startSec + MIN_TRIM_GAP_SEC)
                  );
                  setEditingMarkerId(null);
                  onClearFocusedMarker?.();
                }}
                className="btn-secondary h-7 px-2 text-[11px]"
              >
                Set Trim Out
              </button>
            </div>

            <button
              type="button"
              onClick={() => {
                void onDeleteMarker?.(editingMarker.id);
                setEditingMarkerId(null);
                onClearFocusedMarker?.();
              }}
              className="mt-2 flex h-7 w-full items-center justify-center gap-1.5 rounded-[7px] text-[11px] font-semibold text-[var(--status-error-fg)] hover:bg-[var(--status-error-bg)]"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
              Delete Marker
            </button>
          </div>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px]">
        <div className="font-mono-tabular flex flex-wrap items-center gap-3 text-[var(--text-on-glass-video)]">
          <span>In {formatTimecode(startSec)}</span>
          <span>Out {formatTimecode(endSec)}</span>
          <span className="font-semibold text-[var(--text-primary)]">
            Selected {formatTimecode(selectedDur)}
          </span>
          {isTrimmed && (
            <button
              type="button"
              onClick={onResetTrim}
              className="inline-flex items-center gap-1 font-sans text-[12px] font-medium text-[var(--accent-primary)] hover:underline"
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Reset trim
            </button>
          )}
          {!compact && onAddMarker && (
            <button
              type="button"
              onClick={onAddMarker}
              className="inline-flex items-center gap-1 font-sans text-[12px] font-medium text-[var(--text-secondary)] hover:text-[var(--accent-primary)]"
            >
              <Bookmark className="h-3 w-3" aria-hidden="true" />
              Marker (M)
            </button>
          )}
          {tracks.length > 1 && !compact && (
            <div
              role="group"
              aria-label="Waveform track"
              className="inline-flex h-6 items-center gap-0.5 rounded-[6px] border border-[var(--border-hairline)] bg-white/60 p-0.5 font-sans"
            >
              <button
                type="button"
                onClick={() => {
                  setSoloOverrideActive(false);
                  setManualWaveTrack("mix");
                }}
                aria-pressed={effectiveWaveTrack === "mix"}
                className={`h-5 rounded-[4px] px-1.5 text-[11px] font-medium transition-colors ${
                  effectiveWaveTrack === "mix"
                    ? "bg-[var(--accent-primary)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Mix
              </button>
              {tracks.map((track, idx) => {
                const isActive = effectiveWaveTrack === track.trackOrder;
                const trackMuted = Boolean(
                  mixes.find((m) => m.trackOrder === track.trackOrder)?.muted
                );
                return (
                  <button
                    key={track.id}
                    type="button"
                    title={track.label || `Track ${idx + 1}`}
                    onClick={() => {
                      setSoloOverrideActive(false);
                      setManualWaveTrack(track.trackOrder);
                    }}
                    aria-pressed={isActive}
                    className={`h-5 rounded-[4px] px-1.5 text-[11px] font-medium transition-colors ${
                      isActive
                        ? "bg-[var(--accent-primary)] text-white"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    } ${trackMuted && !isActive ? "opacity-45" : ""}`}
                  >
                    T{idx + 1}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {!compact && (
          <div className="font-mono-tabular text-[12px] text-[var(--text-on-glass-video)]">
            <span>Est. Discord: ~{formatBytes(estDiscord10)}</span>
            {estLossless > 10 * 1024 * 1024 && (
              <span className="ml-2 text-[var(--text-muted)]">
                (~{formatBytes(estLossless)} lossless)
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
