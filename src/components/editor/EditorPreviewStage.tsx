import { useEffect, useRef } from "react";
import { Film, Pause, Play } from "lucide-react";
import { getAudioStreamUrl, getVideoStreamUrl } from "../../lib/api";
import {
  computeColorPreviewFilter,
  getFramingObjectClass,
} from "../../lib/editor";
import { useEditorAudioPreview } from "../../hooks/useEditorAudioPreview";
import type { EditorAudioLayer, EditorExportOptions, EditorSegment } from "../../lib/types";

interface EditorPreviewStageProps {
  segments: EditorSegment[];
  audioLayers: EditorAudioLayer[];
  playheadSec: number;
  activeIndex: number;
  activeSegment: EditorSegment | null;
  outgoingSegment: EditorSegment | null;
  crossfadeProgress: number | null;
  edgeFadeOpacity?: number;
  clipLocalTimeSec: number;
  outgoingClipLocalTimeSec: number;
  isPlaying: boolean;
  streamerBaseUrl: string;
  streamerToken: string;
  pulseIcon: "play" | "pause" | null;
  showVerticalGuide: boolean;
  exportOptions: EditorExportOptions;
  onTogglePlay: () => void;
  onOpenClipPicker: () => void;
}

function syncAudioElementsForSegment(
  segment: EditorSegment,
  videoEl: HTMLVideoElement | null,
  audioCtx: AudioContext | null,
  audioEls: Map<number, HTMLAudioElement>,
  gainNodes: Map<number, GainNode>,
  localTime: number,
  isPlaying: boolean,
  volumeScale = 1
) {
  const isMultiTrack = segment.audioMix.length > 1 && audioEls.size > 1;
  const masterScale = segment.masterMuted
    ? 0
    : Math.min(1, Math.max(0, segment.masterVolume / 100));

  if (isMultiTrack) {
    if (videoEl) videoEl.muted = true;
    for (const mix of segment.audioMix) {
      const gain = gainNodes.get(mix.trackOrder);
      const el = audioEls.get(mix.trackOrder);
      if (gain) {
        gain.gain.value = (mix.muted ? 0 : mix.volume) * masterScale * volumeScale;
      }
      if (el) {
        el.playbackRate = segment.speed;
        if (Math.abs(el.currentTime - localTime) > 0.25) {
          el.currentTime = localTime;
        }
        if (isPlaying && el.paused) {
          el.play().catch(() => {});
        } else if (!isPlaying && !el.paused) {
          el.pause();
        }
      }
    }
    if (isPlaying && audioCtx?.state === "suspended") {
      audioCtx.resume().catch(() => {});
    }
  } else if (videoEl) {
    const primary = segment.audioMix[0];
    const trackScale = primary ? (primary.muted ? 0 : Math.min(1, primary.volume)) : 1;
    const vol = Math.min(1, Math.max(0, masterScale * trackScale * volumeScale));
    videoEl.muted = vol <= 0;
    videoEl.volume = vol;
  }
}

export function EditorPreviewStage({
  segments,
  audioLayers,
  playheadSec,
  activeIndex,
  activeSegment,
  outgoingSegment,
  crossfadeProgress,
  edgeFadeOpacity = 1,
  clipLocalTimeSec,
  outgoingClipLocalTimeSec,
  isPlaying,
  streamerBaseUrl,
  streamerToken,
  pulseIcon,
  showVerticalGuide,
  exportOptions,
  onTogglePlay,
  onOpenClipPicker,
}: EditorPreviewStageProps) {
  useEditorAudioPreview({
    audioLayers,
    playheadSec,
    isPlaying,
    streamerBaseUrl,
    streamerToken,
  });
  const primaryVideoRef = useRef<HTMLVideoElement>(null);
  const outgoingVideoRef = useRef<HTMLVideoElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioElsRef = useRef<Map<number, HTMLAudioElement>>(new Map());
  const gainNodesRef = useRef<Map<number, GainNode>>(new Map());
  const savedPrimaryHiddenTimeRef = useRef<number | null>(null);
  const savedOutgoingHiddenTimeRef = useRef<number | null>(null);

  const activeClipId = activeSegment?.clipId ?? "";
  const activeTrackCount = activeSegment?.audioMix.length ?? 0;

  useEffect(() => {
    const cleanup = () => {
      for (const el of audioElsRef.current.values()) {
        el.pause();
        el.src = "";
      }
      audioElsRef.current.clear();
      gainNodesRef.current.clear();
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
        audioCtxRef.current = null;
      }
    };

    cleanup();
    if (!activeClipId || activeTrackCount < 2 || !streamerBaseUrl) {
      return cleanup;
    }

    const ctx = new window.AudioContext();
    audioCtxRef.current = ctx;

    for (let idx = 0; idx < activeTrackCount; idx += 1) {
      const audioEl = new Audio();
      audioEl.crossOrigin = "anonymous";
      audioEl.preload = "auto";
      audioEl.src = getAudioStreamUrl(streamerBaseUrl, streamerToken, activeClipId, idx);
      const srcNode = ctx.createMediaElementSource(audioEl);
      const gainNode = ctx.createGain();
      srcNode.connect(gainNode);
      gainNode.connect(ctx.destination);
      audioElsRef.current.set(idx, audioEl);
      gainNodesRef.current.set(idx, gainNode);
    }

    return cleanup;
  }, [activeClipId, activeTrackCount, streamerBaseUrl, streamerToken]);

  useEffect(() => {
    const video = primaryVideoRef.current;
    if (!video || !activeSegment) return;

    video.playbackRate = activeSegment.speed;
    if (Math.abs(video.currentTime - clipLocalTimeSec) > (isPlaying ? 0.35 : 0.05)) {
      if (video.readyState >= 1) {
        video.currentTime = clipLocalTimeSec;
      }
    }

    const fadeInVolume =
      crossfadeProgress !== null ? Math.min(1, Math.max(0, crossfadeProgress)) : 1;
    syncAudioElementsForSegment(
      activeSegment,
      video,
      audioCtxRef.current,
      audioElsRef.current,
      gainNodesRef.current,
      clipLocalTimeSec,
      isPlaying,
      fadeInVolume
    );

    if (isPlaying && !document.hidden && video.paused) {
      video.play().catch(() => {});
    } else if ((!isPlaying || document.hidden) && !video.paused) {
      video.pause();
    }
  }, [activeSegment, clipLocalTimeSec, crossfadeProgress, isPlaying]);

  useEffect(() => {
    const video = outgoingVideoRef.current;
    if (!video || !outgoingSegment || crossfadeProgress === null) return;
    video.playbackRate = outgoingSegment.speed;
    const outVol = Math.max(0, Math.min(1, 1 - crossfadeProgress));
    video.volume = outgoingSegment.masterMuted
      ? 0
      : outVol * Math.min(1, Math.max(0, outgoingSegment.masterVolume / 100));
    video.muted = video.volume <= 0;
    if (Math.abs(video.currentTime - outgoingClipLocalTimeSec) > 0.35 && video.readyState >= 1) {
      video.currentTime = outgoingClipLocalTimeSec;
    }
    if (isPlaying && !document.hidden && video.paused) {
      video.play().catch(() => {});
    } else if ((!isPlaying || document.hidden) && !video.paused) {
      video.pause();
    }
  }, [outgoingSegment, outgoingClipLocalTimeSec, crossfadeProgress, isPlaying]);

  const primarySrc =
    activeSegment && streamerBaseUrl
      ? getVideoStreamUrl(streamerBaseUrl, streamerToken, activeSegment.clipId)
      : "";
  const outgoingSrc =
    outgoingSegment && crossfadeProgress !== null && streamerBaseUrl
      ? getVideoStreamUrl(streamerBaseUrl, streamerToken, outgoingSegment.clipId)
      : "";

  const isCrossfading =
    Boolean(outgoingSegment) &&
    crossfadeProgress !== null &&
    crossfadeProgress >= 0 &&
    crossfadeProgress <= 1;

  useEffect(() => {
    savedPrimaryHiddenTimeRef.current = null;
  }, [primarySrc]);

  useEffect(() => {
    savedOutgoingHiddenTimeRef.current = null;
  }, [outgoingSrc]);

  useEffect(() => {
    const onVisibilityChange = () => {
      const primary = primaryVideoRef.current;
      const outgoing = outgoingVideoRef.current;

      if (document.hidden) {
        if (primary && primarySrc) {
          savedPrimaryHiddenTimeRef.current = Number.isFinite(primary.currentTime)
            ? primary.currentTime
            : clipLocalTimeSec;
          primary.pause();
          primary.removeAttribute("src");
          primary.load();
        }
        if (outgoing && outgoingSrc && isCrossfading) {
          savedOutgoingHiddenTimeRef.current = Number.isFinite(outgoing.currentTime)
            ? outgoing.currentTime
            : outgoingClipLocalTimeSec;
          outgoing.pause();
          outgoing.removeAttribute("src");
          outgoing.load();
        }
        for (const el of audioElsRef.current.values()) {
          if (!el.paused) el.pause();
        }
      } else {
        if (primary && primarySrc && savedPrimaryHiddenTimeRef.current !== null) {
          if (primary.getAttribute("src") !== primarySrc) {
            primary.setAttribute("src", primarySrc);
            primary.load();
          } else if (primary.readyState >= 1) {
            primary.currentTime = savedPrimaryHiddenTimeRef.current;
            savedPrimaryHiddenTimeRef.current = null;
          }
        }
        if (outgoing && outgoingSrc && isCrossfading && savedOutgoingHiddenTimeRef.current !== null) {
          if (outgoing.getAttribute("src") !== outgoingSrc) {
            outgoing.setAttribute("src", outgoingSrc);
            outgoing.load();
          } else if (outgoing.readyState >= 1) {
            outgoing.currentTime = savedOutgoingHiddenTimeRef.current;
            savedOutgoingHiddenTimeRef.current = null;
          }
        }
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [clipLocalTimeSec, isCrossfading, outgoingClipLocalTimeSec, outgoingSrc, primarySrc]);

  const activeColorFilter = activeSegment
    ? computeColorPreviewFilter(activeSegment.vibrance, activeSegment.saturation)
    : "none";
  const activeFramingClass = activeSegment
    ? getFramingObjectClass(activeSegment.framing)
    : "object-contain";

  const outgoingColorFilter = outgoingSegment
    ? computeColorPreviewFilter(outgoingSegment.vibrance, outgoingSegment.saturation)
    : "none";
  const outgoingFramingClass = outgoingSegment
    ? getFramingObjectClass(outgoingSegment.framing)
    : "object-contain";

  return (
    <div
      data-testid="editor-preview-stage"
      className={`relative flex min-h-[180px] flex-1 items-center justify-center overflow-hidden rounded-[12px] ${
        segments.length === 0
          ? "border border-[var(--border-hairline)] bg-[var(--surface-card)] shadow-[var(--border-card-specular),var(--shadow-card-rest)]"
          : "bg-[var(--surface-cinema-frame)]"
      }`}
    >
      {segments.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-6 text-center">
          <div className="flex h-10 w-10 items-center justify-center rounded-[10px] border border-[var(--border-hairline)] bg-white/80 text-[var(--text-secondary)] shadow-[var(--border-card-specular)]">
            <Film className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="mt-3 text-[14px] font-semibold text-[var(--text-primary)]">
            No segments in timeline
          </p>
          <p className="mt-1 max-w-[320px] text-[12px] text-[var(--text-secondary)]">
            Send a trimmed range from Player or pick clips from your library to start editing.
          </p>
          <button
            type="button"
            onClick={onOpenClipPicker}
            className="btn-primary mt-4 h-9 px-4 text-[13px]"
          >
            Add from Library
          </button>
        </div>
      ) : (
        <>
          {outgoingSrc && isCrossfading && (
            <video
              ref={outgoingVideoRef}
              src={outgoingSrc}
              playsInline
              preload="metadata"
              onLoadedMetadata={(e) => {
                const targetTime = savedOutgoingHiddenTimeRef.current ?? outgoingClipLocalTimeSec;
                savedOutgoingHiddenTimeRef.current = null;
                e.currentTarget.currentTime = targetTime;
                e.currentTarget.playbackRate = outgoingSegment?.speed ?? 1;
              }}
              style={{
                opacity: Math.max(0, 1 - (crossfadeProgress ?? 0)) * edgeFadeOpacity,
                filter: outgoingColorFilter === "none" ? undefined : outgoingColorFilter,
              }}
              className={`pointer-events-none absolute inset-0 h-full w-full ${outgoingFramingClass}`}
            />
          )}

          {primarySrc ? (
            <video
              ref={primaryVideoRef}
              data-testid="editor-preview-video"
              key={activeSegment?.clipId}
              src={primarySrc}
              playsInline
              preload="metadata"
              onClick={onTogglePlay}
              onLoadedMetadata={(e) => {
                const targetTime = savedPrimaryHiddenTimeRef.current ?? clipLocalTimeSec;
                savedPrimaryHiddenTimeRef.current = null;
                e.currentTarget.currentTime = targetTime;
                e.currentTarget.playbackRate = activeSegment?.speed ?? 1;
              }}
              style={{
                opacity: (isCrossfading ? Math.min(1, crossfadeProgress ?? 1) : 1) * edgeFadeOpacity,
                filter: activeColorFilter === "none" ? undefined : activeColorFilter,
              }}
              className={`h-full max-h-full w-full cursor-pointer ${activeFramingClass}`}
            />
          ) : (
            <button
              type="button"
              onClick={onTogglePlay}
              className="flex h-full w-full flex-col items-center justify-center gap-1.5 text-slate-200"
            >
              <span className="text-[14px] font-semibold">
                {activeSegment?.clip.title || activeSegment?.clip.fileName}
              </span>
              <span className="text-[12px] text-slate-400">
                Preview stream unavailable in standalone browser mode.
              </span>
            </button>
          )}

          {showVerticalGuide && (
            <div
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 flex items-center justify-center"
            >
              {exportOptions.verticalStyle === "crop" && (
                <div className="absolute inset-0 flex justify-between">
                  <div className="h-full flex-1 bg-black/45" />
                  <div className="aspect-[9/16] h-full shrink-0" />
                  <div className="h-full flex-1 bg-black/45" />
                </div>
              )}
              <div className="relative aspect-[9/16] h-[88%] rounded-[4px] border border-white/65 shadow-[0_0_0_1px_rgba(15,23,42,0.35)]">
                <span className="absolute top-1.5 left-1.5 rounded bg-[var(--surface-scrim-dark)] px-1.5 py-0.5 text-[10px] font-medium text-white">
                  9:16 {exportOptions.verticalStyle === "blur" ? "Blur" : "Crop"}
                </span>
              </div>
            </div>
          )}

          {activeSegment && (
            <div className="font-mono-tabular pointer-events-none absolute top-3 right-3 rounded-[6px] bg-[var(--surface-scrim-dark)] px-2 py-0.5 text-[11px] font-medium text-white">
              Seg {activeIndex + 1}/{segments.length}
              {activeSegment.speed !== 1 ? ` · ${activeSegment.speed}x` : ""}
            </div>
          )}
        </>
      )}

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
    </div>
  );
}
