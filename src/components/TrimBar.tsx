import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { RotateCcw } from "lucide-react";
import { getWaveformUrl } from "../lib/api";
import { estimateExportBytes, formatBytes, formatTimecode } from "../lib/format";
import type { ClipSummary, ExportPreset, WaveformResponse } from "../lib/types";

interface TrimBarProps {
  clip: ClipSummary;
  streamerBaseUrl: string;
  streamerToken: string;
  duration: number;
  currentTime: number;
  startSec: number;
  endSec: number;
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
  onSeek,
  onChangeTrim,
  onResetTrim,
  onTrimDragStart,
  onTrimDragEnd,
  compact = false,
}: TrimBarProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [dragTarget, setDragTarget] = useState<DragTarget>(null);
  const [peaks, setPeaks] = useState<number[]>([]);

  const safeDuration = duration > 0 ? duration : clip.durationSec || 1;
  const safeFps = clip.fps > 0 ? clip.fps : 60;

  useEffect(() => {
    if (!streamerBaseUrl || !clip.id) {
      setPeaks([]);
      return;
    }
    const controller = new AbortController();
    fetch(getWaveformUrl(streamerBaseUrl, streamerToken, clip.id, 0), {
      signal: controller.signal,
    })
      .then((res) => (res.ok ? (res.json() as Promise<WaveformResponse>) : null))
      .then((data) => {
        if (data && Array.isArray(data.peaks)) {
          setPeaks(data.peaks);
        }
      })
      .catch(() => {
        setPeaks([]);
      });
    return () => controller.abort();
  }, [clip.id, streamerBaseUrl, streamerToken]);

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

  return (
    <div>
      <div
        ref={trackRef}
        onPointerDown={handleTrackPointerDown}
        className="relative h-9 w-full cursor-pointer select-none rounded-[8px] bg-slate-900/10"
      >
        {peaks.length > 0 && (
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
