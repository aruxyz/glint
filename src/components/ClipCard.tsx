import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Check,
  Film,
  MoreHorizontal,
  Star,
  Volume2,
} from "lucide-react";
import { getThumbStreamUrl, getVideoStreamUrl } from "../lib/api";
import {
  formatBytes,
  formatDuration,
  formatRelativeTimestamp,
} from "../lib/format";
import type { ClipSummary } from "../lib/types";

interface ClipCardProps {
  clip: ClipSummary;
  streamerBaseUrl: string;
  streamerToken: string;
  selected: boolean;
  selectionMode: boolean;
  selectModeExplicit: boolean;
  onToggleSelect: (clip: ClipSummary, shiftKey: boolean) => void;
  onOpenPlayer: (clip: ClipSummary) => void;
  onToggleFavorite: (clip: ClipSummary) => void;
  onOpenContextMenu: (clip: ClipSummary, x: number, y: number) => void;
}

export function ClipCard({
  clip,
  streamerBaseUrl,
  streamerToken,
  selected,
  selectionMode,
  selectModeExplicit,
  onToggleSelect,
  onOpenPlayer,
  onToggleFavorite,
  onOpenContextMenu,
}: ClipCardProps) {
  const [imgError, setImgError] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [videoReady, setVideoReady] = useState(false);
  const [videoFailed, setVideoFailed] = useState(false);
  const [hoverRatio, setHoverRatio] = useState<number | null>(null);

  const hoverTimerRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const pendingRatioRef = useRef<number | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const thumbSrc = getThumbStreamUrl(
    streamerBaseUrl,
    streamerToken,
    clip.id,
    clip.thumbUrl
  );
  const videoSrc =
    streamerBaseUrl && !clip.isMissing
      ? getVideoStreamUrl(streamerBaseUrl, streamerToken, clip.id)
      : "";

  const canHoverPreview =
    Boolean(videoSrc) && !selectionMode && !selectModeExplicit && !videoFailed;

  const stopPreview = useCallback(() => {
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
      hoverTimerRef.current = null;
    }
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    pendingRatioRef.current = null;
    const vid = videoRef.current;
    if (vid) {
      vid.pause();
      vid.removeAttribute("src");
      vid.load();
    }
    setPreviewActive(false);
    setVideoReady(false);
    setHoverRatio(null);
  }, []);

  useEffect(() => {
    setImgError(false);
    setVideoFailed(false);
  }, [thumbSrc, videoSrc]);

  useEffect(() => {
    if (selectionMode || selectModeExplicit) {
      stopPreview();
    }
  }, [selectionMode, selectModeExplicit, stopPreview]);

  useEffect(() => () => stopPreview(), [stopPreview]);

  const scrubToRatio = useCallback(
    (ratio: number) => {
      const clamped = Math.min(1, Math.max(0, ratio));
      pendingRatioRef.current = clamped;
      if (rafRef.current !== null) return;
      rafRef.current = window.requestAnimationFrame(() => {
        rafRef.current = null;
        const r = pendingRatioRef.current;
        if (r === null) return;
        setHoverRatio(r);
        const vid = videoRef.current;
        if (vid && vid.readyState >= 1) {
          const total =
            vid.duration && Number.isFinite(vid.duration) && vid.duration > 0
              ? vid.duration
              : clip.durationSec;
          if (total > 0) {
            vid.currentTime = Math.min(total, Math.max(0, r * total));
          }
        }
      });
    },
    [clip.durationSec]
  );

  const handleThumbPointerEnter = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canHoverPreview) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const initialRatio = Math.min(
      1,
      Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width))
    );
    pendingRatioRef.current = initialRatio;
    if (hoverTimerRef.current !== null) {
      window.clearTimeout(hoverTimerRef.current);
    }
    hoverTimerRef.current = window.setTimeout(() => {
      hoverTimerRef.current = null;
      setVideoFailed(false);
      setVideoReady(false);
      setPreviewActive(true);
      setHoverRatio(pendingRatioRef.current ?? initialRatio);
    }, 200);
  };

  const handleThumbPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!canHoverPreview) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / Math.max(1, rect.width);
    if (previewActive) {
      scrubToRatio(ratio);
    } else {
      pendingRatioRef.current = Math.min(1, Math.max(0, ratio));
    }
  };

  const handleThumbPointerLeave = () => {
    stopPreview();
  };

  const displayTitle = clip.title?.trim() || clip.fileName;
  const scrubTimeSec =
    hoverRatio !== null ? hoverRatio * Math.max(0, clip.durationSec) : null;

  const handlePrimaryClick = (e: ReactMouseEvent) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || selectModeExplicit) {
      e.preventDefault();
      onToggleSelect(clip, e.shiftKey);
      return;
    }
    onOpenPlayer(clip);
  };

  return (
    <article
      className={`clip-card group relative flex min-w-0 flex-col p-2 ${
        selected ? "ring-2 ring-[var(--accent-primary)] bg-[rgba(239,246,255,0.86)]" : ""
      }`}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenContextMenu(clip, e.clientX, e.clientY);
      }}
    >
      <div
        onPointerEnter={handleThumbPointerEnter}
        onPointerMove={handleThumbPointerMove}
        onPointerLeave={handleThumbPointerLeave}
        className="relative aspect-video w-full overflow-hidden rounded-[10px] bg-[var(--surface-cinema-frame)]"
      >
        <button
          type="button"
          onClick={handlePrimaryClick}
          aria-label={selectModeExplicit ? `Select ${displayTitle}` : `Play ${displayTitle}`}
          className="block h-full w-full text-left focus-visible:outline-offset-[-2px]"
        >
          {thumbSrc && !imgError ? (
            <img
              src={thumbSrc}
              alt={displayTitle}
              loading="lazy"
              decoding="async"
              width={320}
              height={180}
              onError={() => setImgError(true)}
              className="h-full w-full object-cover transition-transform duration-200 group-hover:scale-[1.015]"
            />
          ) : (
            <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-slate-400">
              <Film className="h-6 w-6" aria-hidden="true" />
              <span className="max-w-[80%] truncate px-2 text-[11px] text-slate-300">
                {clip.fileName}
              </span>
            </div>
          )}

          {previewActive && videoSrc && !videoFailed && (
            <video
              ref={videoRef}
              src={videoSrc}
              muted
              playsInline
              preload="metadata"
              aria-hidden="true"
              onLoadedMetadata={(e) => {
                setVideoReady(true);
                const r = pendingRatioRef.current ?? hoverRatio;
                if (r !== null) {
                  const total =
                    e.currentTarget.duration &&
                    Number.isFinite(e.currentTarget.duration) &&
                    e.currentTarget.duration > 0
                      ? e.currentTarget.duration
                      : clip.durationSec;
                  if (total > 0) {
                    e.currentTarget.currentTime = Math.min(
                      total,
                      Math.max(0, r * total)
                    );
                  }
                }
              }}
              onError={() => setVideoFailed(true)}
              className={`pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-100 ${
                videoReady ? "opacity-100" : "opacity-0"
              }`}
            />
          )}
        </button>

        {previewActive && !videoFailed && hoverRatio !== null && (
          <>
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 z-10 w-[2px] -translate-x-1/2 bg-[#1D4ED8] shadow-[0_0_4px_rgba(29,78,216,0.5)]"
              style={{ left: `${hoverRatio * 100}%` }}
            />
            {scrubTimeSec !== null && (
              <span
                data-testid="clip-scrub-time"
                className="font-mono-tabular pointer-events-none absolute bottom-2 left-2 z-10 rounded-[4px] bg-[var(--surface-scrim-dark)] px-1.5 py-0.5 text-[11px] font-medium text-white"
              >
                {formatDuration(scrubTimeSec)}
              </span>
            )}
          </>
        )}

        {/* Top-left selection checkbox */}
        <button
          type="button"
          role="checkbox"
          aria-checked={selected}
          aria-label={selected ? `Deselect ${displayTitle}` : `Select ${displayTitle}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggleSelect(clip, e.shiftKey);
          }}
          className={`absolute top-1.5 left-1.5 flex h-8 w-8 items-center justify-center rounded-[8px] transition-opacity ${
            selected || selectionMode
              ? "opacity-100"
              : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          }`}
        >
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-[5px] border shadow-sm transition-colors ${
              selected
                ? "border-[var(--accent-primary)] bg-[var(--accent-primary)] text-white"
                : "border-white/80 bg-[var(--surface-scrim-dark)] text-transparent hover:border-white"
            }`}
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </button>

        {/* Top-right audio tracks & favorite */}
        <div className="pointer-events-none absolute top-1.5 right-1.5 flex items-center gap-1.5">
          {clip.audioTrackCount > 1 && (
            <span
              className="font-mono-tabular inline-flex items-center gap-1 rounded-[4px] bg-[var(--surface-scrim-dark)] px-1.5 py-0.5 text-[11px] font-medium text-white"
              title={`${clip.audioTrackCount} audio tracks`}
            >
              <Volume2 className="h-3 w-3" aria-hidden="true" />
              {clip.audioTrackCount}ch
            </span>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleFavorite(clip);
            }}
            aria-label={clip.isFavorite ? "Remove from Favorites" : "Add to Favorites"}
            aria-pressed={clip.isFavorite}
            className={`btn-icon pointer-events-auto flex h-8 w-8 items-center justify-center rounded-[8px] ${
              clip.isFavorite
                ? "bg-[var(--surface-scrim-dark)] text-amber-400 opacity-100"
                : "bg-[var(--surface-scrim-dark)] text-white/90 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            }`}
          >
            <Star
              className="h-4 w-4"
              fill={clip.isFavorite ? "currentColor" : "none"}
              aria-hidden="true"
            />
          </button>
        </div>

        <span className="font-mono-tabular pointer-events-none absolute right-2 bottom-2 rounded-[4px] bg-[var(--surface-scrim-dark)] px-1.5 py-0.5 text-[11px] font-medium text-white">
          {formatDuration(clip.durationSec)}
        </span>
      </div>

      <div className="mt-2 flex min-w-0 items-start justify-between gap-2 px-1 pb-0.5">
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={handlePrimaryClick}
            title={displayTitle}
            className="block w-full truncate text-left text-[14px] leading-5 font-semibold text-[var(--text-primary)] hover:text-[var(--accent-primary)]"
          >
            {displayTitle}
          </button>

          <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px] leading-4 text-[var(--text-secondary)]">
            <span className="truncate">{clip.gameName || "Desktop"}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0">{formatRelativeTimestamp(clip.recordedAt)}</span>
            <span aria-hidden="true">·</span>
            <span className="font-mono-tabular shrink-0">
              {formatBytes(clip.fileSizeBytes)}
            </span>
            {clip.collectionCount > 0 && (
              <span className="font-mono-tabular ml-0.5 shrink-0 rounded bg-slate-900/[0.06] px-1.5 py-0.2 text-[10px] font-semibold text-[var(--text-secondary)]">
                +{clip.collectionCount}
              </span>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            const rect = e.currentTarget.getBoundingClientRect();
            onOpenContextMenu(clip, rect.right - 200, rect.top - 8);
          }}
          aria-label="Clip actions"
          className="btn-icon flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] text-[var(--text-secondary)] hover:bg-[var(--surface-card-hover)] hover:text-[var(--text-primary)]"
        >
          <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </article>
  );
}
