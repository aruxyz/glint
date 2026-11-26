import { useEffect, useRef } from "react";
import { Pause, Play } from "lucide-react";
import type { ClipSummary } from "../../lib/types";

interface PlayerVideoStageProps {
  clip: ClipSummary;
  displayTitle: string;
  videoSrc: string;
  isFullscreen: boolean;
  isStretched: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  pulseIcon: "play" | "pause" | null;
  countdownSec: number | null;
  nextClip: ClipSummary | null;
  onTogglePlay: () => void;
  onLoadedMetadata: (durationSec: number) => void;
  onTimeUpdate: () => void;
  onEnded: () => void;
  onCancelCountdown: () => void;
  onOpenStageContextMenu: (x: number, y: number) => void;
}

export function PlayerVideoStage({
  clip,
  displayTitle,
  videoSrc,
  isFullscreen,
  isStretched,
  videoRef,
  pulseIcon,
  countdownSec,
  nextClip,
  onTogglePlay,
  onLoadedMetadata,
  onTimeUpdate,
  onEnded,
  onCancelCountdown,
  onOpenStageContextMenu,
}: PlayerVideoStageProps) {
  const savedHiddenTimeRef = useRef<number | null>(null);

  useEffect(() => {
    savedHiddenTimeRef.current = null;
  }, [clip.id, videoSrc]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const vid = videoRef.current;
      if (!vid || !videoSrc) return;

      if (document.hidden) {
        savedHiddenTimeRef.current = Number.isFinite(vid.currentTime) ? vid.currentTime : 0;
        vid.pause();
        vid.removeAttribute("src");
        vid.load();
      } else if (savedHiddenTimeRef.current !== null) {
        if (vid.getAttribute("src") !== videoSrc) {
          vid.setAttribute("src", videoSrc);
          vid.load();
        } else if (vid.readyState >= 1) {
          vid.currentTime = savedHiddenTimeRef.current;
          savedHiddenTimeRef.current = null;
        }
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [videoRef, videoSrc]);

  const tightStretchedFrame = isStretched && !isFullscreen && Boolean(videoSrc);

  const stageOverlays = (
    <>
      {pulseIcon && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <div className="pulse-pop flex h-14 w-14 items-center justify-center rounded-full border border-white/15 bg-slate-900/75 text-white">
            {pulseIcon === "play" ? (
              <Play className="h-6 w-6 fill-current" />
            ) : (
              <Pause className="h-6 w-6 fill-current" />
            )}
          </div>
        </div>
      )}

      {countdownSec !== null && nextClip && (
        <div className="glass-hud popover-enter origin-bottom-right absolute right-4 bottom-4 flex items-center gap-3 rounded-[10px] px-3.5 py-2">
          <span className="text-[12px] font-medium text-[var(--text-primary)]">
            Next: {nextClip.title || nextClip.fileName} in{" "}
            <span className="font-mono-tabular font-semibold">{countdownSec}s</span>
          </span>
          <button
            type="button"
            onClick={onCancelCountdown}
            className="text-[12px] font-semibold text-[var(--accent-primary)] hover:underline"
          >
            Cancel
          </button>
        </div>
      )}
    </>
  );

  return (
    <div
      data-testid="player-cinema-stage"
      style={{ containerType: "size" }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onOpenStageContextMenu(e.clientX, e.clientY);
      }}
      className={`relative flex flex-1 items-center justify-center overflow-hidden ${
        isFullscreen
          ? "h-full w-full rounded-none bg-black"
          : tightStretchedFrame
            ? "min-h-[280px]"
            : "min-h-[280px] rounded-[12px] bg-[var(--surface-cinema-frame)]"
      }`}
    >
      {videoSrc ? (
        <div
          data-testid="player-video-frame"
          className={
            tightStretchedFrame
              ? "relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] max-h-full max-w-full overflow-hidden rounded-[12px] bg-[var(--surface-cinema-frame)]"
              : isStretched
                ? "relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] max-h-full max-w-full"
                : "relative flex h-full w-full items-center justify-center"
          }
        >
          <video
            ref={videoRef}
            key={clip.id}
            src={videoSrc}
            playsInline
            preload="metadata"
            onClick={onTogglePlay}
            onLoadedMetadata={(e) => {
              const vid = e.currentTarget;
              if (savedHiddenTimeRef.current !== null) {
                vid.currentTime = savedHiddenTimeRef.current;
                savedHiddenTimeRef.current = null;
              }
              const d =
                Number.isFinite(vid.duration) && vid.duration > 0
                  ? vid.duration
                  : clip.durationSec;
              onLoadedMetadata(d);
            }}
            onTimeUpdate={onTimeUpdate}
            onEnded={onEnded}
            className={`clip-stage-enter cursor-pointer ${
              isStretched
                ? "h-full w-full object-fill"
                : "h-full max-h-full w-full object-contain"
            }`}
          />
          {stageOverlays}
        </div>
      ) : (
        <>
          <div className="flex flex-col items-center justify-center gap-2 p-6 text-center text-slate-300">
            <p className="text-[14px] font-medium text-white">{displayTitle}</p>
            <p className="text-[12px] text-slate-400">
              Local streamer URL unavailable in browser preview mode.
            </p>
          </div>
          {stageOverlays}
        </>
      )}
    </div>
  );
}
