import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ContextMenuEntry } from "./ContextMenu";
import { PlayerControls } from "./player/PlayerControls";
import { PlayerHeader } from "./player/PlayerHeader";
import { PlayerQueue } from "./player/PlayerQueue";
import { PlayerVideoStage } from "./player/PlayerVideoStage";
import {
  buildPlayerStageContextMenuEntries,
  buildQueueContextMenuEntries,
} from "./player/playerContextMenus";
import { useMultiTrackAudio } from "./player/useMultiTrackAudio";
import { usePlayerShortcuts } from "./player/usePlayerShortcuts";
import { getVideoStreamUrl, isTauriRuntime } from "../lib/api";
import type {
  AspectMode,
  AudioTrackMix,
  ClipSummary,
  ExportPreset,
} from "../lib/types";

const PREVIEW_VOLUME_STORAGE_KEY = "glint_preview_volume";
const PREVIEW_MUTED_STORAGE_KEY = "glint_preview_muted";

function loadSavedPreviewVolume(): number {
  try {
    const raw = window.localStorage.getItem(PREVIEW_VOLUME_STORAGE_KEY);
    if (raw === null) return 100;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return 100;
    return Math.min(100, Math.max(0, Math.round(parsed)));
  } catch {
    return 100;
  }
}

function loadSavedPreviewMuted(): boolean {
  try {
    return window.localStorage.getItem(PREVIEW_MUTED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function resolveTrimForClip(
  durationSec: number,
  savedTrim?: { startSec: number; endSec: number } | null
): { startSec: number; endSec: number } {
  const maxDur = durationSec > 0 ? durationSec : 0;
  if (!savedTrim || !Number.isFinite(savedTrim.startSec) || !Number.isFinite(savedTrim.endSec)) {
    return { startSec: 0, endSec: maxDur };
  }
  if (maxDur <= 0) {
    return {
      startSec: Math.max(0, savedTrim.startSec),
      endSec: Math.max(savedTrim.startSec, savedTrim.endSec),
    };
  }
  const clampedStart = Math.max(0, Math.min(maxDur, savedTrim.startSec));
  const clampedEnd = Math.max(0, Math.min(maxDur, savedTrim.endSec));
  if (clampedEnd <= clampedStart) {
    return { startSec: 0, endSec: maxDur };
  }
  return { startSec: clampedStart, endSec: clampedEnd };
}

interface PlayerViewProps {
  clip: ClipSummary;
  queue: ClipSummary[];
  sourceLabel: string;
  streamerBaseUrl: string;
  streamerToken: string;
  defaultAutoNext: boolean;
  autoCopyToClipboard: boolean;
  savedTrim?: { startSec: number; endSec: number } | null;
  onSaveTrimRange?: (clipId: string, startSec: number, endSec: number) => void;
  onBack: () => void;
  onSelectClip: (clip: ClipSummary) => void;
  onToggleFavorite: (clip: ClipSummary) => void;
  onOpenCollectionPicker: (clip: ClipSummary) => void;
  onEditClip: (clip: ClipSummary) => void;
  onRevealFile: (clip: ClipSummary) => void;
  onDeleteClip: (clip: ClipSummary) => void;
  onOpenContextMenu: (x: number, y: number, entries: ContextMenuEntry[]) => void;
  onSetCover: (clip: ClipSummary, timeSec: number) => Promise<void>;
  onSnapshotFrame: (params: {
    clip: ClipSummary;
    timeSec: number;
    aspectMode: AspectMode;
    copyToClipboard: boolean;
  }) => Promise<void>;
  onOpenSaveTrimModal: (params: {
    clip: ClipSummary;
    startSec: number;
    endSec: number;
    audioMix: AudioTrackMix[];
    aspectMode: AspectMode;
    normalizeAudio: boolean;
  }) => void;
  onSendToEditor: (params: {
    clip: ClipSummary;
    startSec: number;
    endSec: number;
    audioMix: AudioTrackMix[];
    masterVolume: number;
    masterMuted: boolean;
  }) => void;
  onStartExport: (params: {
    clip: ClipSummary;
    preset: ExportPreset;
    startSec: number;
    endSec: number;
    audioMix: AudioTrackMix[];
    copyToClipboard: boolean;
    aspectMode: AspectMode;
    normalizeAudio: boolean;
  }) => Promise<void>;
}

export function PlayerView({
  clip,
  queue,
  sourceLabel,
  streamerBaseUrl,
  streamerToken,
  defaultAutoNext,
  autoCopyToClipboard,
  savedTrim,
  onSaveTrimRange,
  onBack,
  onSelectClip,
  onToggleFavorite,
  onOpenCollectionPicker,
  onEditClip,
  onRevealFile,
  onDeleteClip,
  onOpenContextMenu,
  onSetCover,
  onSnapshotFrame,
  onOpenSaveTrimModal,
  onSendToEditor,
  onStartExport,
}: PlayerViewProps) {
  const stageRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const hudTimerRef = useRef<number | null>(null);
  const pulseTimerRef = useRef<number | null>(null);

  const savedTrimRef = useRef(savedTrim);
  savedTrimRef.current = savedTrim;
  const clipIdRef = useRef(clip.id);
  clipIdRef.current = clip.id;

  const initialTrim = resolveTrimForClip(clip.durationSec || 0, savedTrim);
  const [isPlaying, setIsPlaying] = useState(false);
  const [duration, setDuration] = useState(clip.durationSec || 0);
  const [currentTime, setCurrentTime] = useState(initialTrim.startSec > 0 ? initialTrim.startSec : 0);
  const [startSec, setStartSec] = useState(initialTrim.startSec);
  const [endSec, setEndSec] = useState(initialTrim.endSec);
  const startSecRef = useRef(startSec);
  startSecRef.current = startSec;
  const endSecRef = useRef(endSec);
  endSecRef.current = endSec;
  const hasUserInteractedWithClipRef = useRef(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [loopActive, setLoopActive] = useState(false);
  const [aspectMode, setAspectMode] = useState<AspectMode>("original");
  const [normalizeAudio, setNormalizeAudio] = useState(false);
  const [masterMuted, setMasterMuted] = useState<boolean>(loadSavedPreviewMuted);
  const [masterVolume, setMasterVolume] = useState<number>(loadSavedPreviewVolume);
  const lastNonZeroVolumeRef = useRef<number>(masterVolume > 0 ? masterVolume : 100);

  useEffect(() => {
    if (masterVolume > 0) {
      lastNonZeroVolumeRef.current = masterVolume;
    }
    try {
      window.localStorage.setItem(PREVIEW_VOLUME_STORAGE_KEY, String(masterVolume));
    } catch {
      // Ignore storage write failures.
    }
  }, [masterVolume]);

  useEffect(() => {
    try {
      window.localStorage.setItem(PREVIEW_MUTED_STORAGE_KEY, String(masterMuted));
    } catch {
      // Ignore storage write failures.
    }
  }, [masterMuted]);

  const [autoNext, setAutoNext] = useState(defaultAutoNext);
  const [queueOpen, setQueueOpen] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth >= 1200 : true
  );
  const [isCompact, setIsCompact] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth < 1160 : false
  );
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [hudVisible, setHudVisible] = useState(true);
  const [mixerOpen, setMixerOpen] = useState(false);
  const [pulseIcon, setPulseIcon] = useState<"play" | "pause" | null>(null);
  const [countdownSec, setCountdownSec] = useState<number | null>(null);
  const [exportingPreset, setExportingPreset] = useState<ExportPreset | null>(null);
  const [settingCover, setSettingCover] = useState(false);
  const [takingSnapshot, setTakingSnapshot] = useState(false);

  const currentIndex = useMemo(
    () => queue.findIndex((item) => item.id === clip.id),
    [queue, clip.id]
  );
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex >= 0 && currentIndex < queue.length - 1;
  const nextClip = hasNext ? queue[currentIndex + 1] : null;
  const prevClip = hasPrev ? queue[currentIndex - 1] : null;

  const {
    tracks,
    mixes,
    soloTrackOrder,
    syncAudioOutput,
    syncAudioSeek,
    pauseAllAudio,
    playAllAudio,
    handleMixChange,
    handleToggleSolo,
    getEffectiveMix,
  } = useMultiTrackAudio({
    clip,
    streamerBaseUrl,
    streamerToken,
    playbackRate,
    masterMuted,
    masterVolume,
    isPlaying,
    isFullscreen,
    videoRef,
  });

  const syncAudioRef = useRef(syncAudioOutput);
  syncAudioRef.current = syncAudioOutput;

  useEffect(() => {
    const onResize = () => {
      const compact = window.innerWidth < 1160;
      setIsCompact((prev) => {
        if (!prev && compact) {
          setQueueOpen(false);
        }
        return compact;
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
      setHudVisible(true);
      syncAudioRef.current();
      window.requestAnimationFrame(() => syncAudioRef.current());
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  useEffect(() => {
    const nextTrim = resolveTrimForClip(clip.durationSec || 0, savedTrimRef.current);
    hasUserInteractedWithClipRef.current = false;
    setIsPlaying(false);
    setCurrentTime(nextTrim.startSec > 0 ? nextTrim.startSec : 0);
    setStartSec(nextTrim.startSec);
    setEndSec(nextTrim.endSec);
    setDuration(clip.durationSec || 0);
    setCountdownSec(null);
  }, [clip.id, clip.durationSec]);

  useEffect(() => {
    if (countdownSec === null) return;
    if (countdownSec <= 0) {
      setCountdownSec(null);
      if (nextClip) onSelectClip(nextClip);
      return;
    }
    const timer = window.setTimeout(() => {
      setCountdownSec((prev) => (prev !== null ? prev - 1 : null));
    }, 1000);
    return () => window.clearTimeout(timer);
  }, [countdownSec, nextClip, onSelectClip]);

  const showHudBriefly = useCallback(() => {
    setHudVisible(true);
    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    if (isFullscreen && isPlaying) {
      hudTimerRef.current = window.setTimeout(() => {
        setHudVisible(false);
      }, 2500);
    }
  }, [isFullscreen, isPlaying]);

  useEffect(() => {
    showHudBriefly();
    return () => {
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current);
    };
  }, [isFullscreen, isPlaying, showHudBriefly]);

  const triggerPulse = (kind: "play" | "pause") => {
    setPulseIcon(kind);
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulseIcon(null), 350);
  };

  const seekTo = useCallback(
    (timeSec: number) => {
      hasUserInteractedWithClipRef.current = true;
      const video = videoRef.current;
      const maxT = duration > 0 ? duration : clip.durationSec || 0;
      const clamped = Math.max(0, Math.min(maxT, timeSec));
      setCountdownSec(null);
      if (video) {
        video.currentTime = clamped;
      }
      setCurrentTime(clamped);
      syncAudioSeek(clamped);
    },
    [clip.durationSec, duration, syncAudioSeek]
  );

  const togglePlay = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    hasUserInteractedWithClipRef.current = true;
    setCountdownSec(null);

    if (video.paused) {
      const actualTime = Number.isFinite(video.currentTime) ? video.currentTime : currentTime;
      if ((actualTime < startSec - 0.05 || actualTime >= endSec - 0.05) && endSec > startSec) {
        seekTo(startSec);
      }
      try {
        await video.play();
        await playAllAudio(video.currentTime);
        setIsPlaying(true);
        triggerPulse("play");
      } catch {
        setIsPlaying(false);
      }
    } else {
      video.pause();
      pauseAllAudio();
      setIsPlaying(false);
      triggerPulse("pause");
    }
  }, [currentTime, endSec, pauseAllAudio, playAllAudio, seekTo, startSec]);

  const stepFrame = useCallback(
    (direction: -1 | 1) => {
      const video = videoRef.current;
      if (!video) return;
      if (!video.paused) {
        video.pause();
        pauseAllAudio();
        setIsPlaying(false);
      }
      const fps = clip.fps > 0 ? clip.fps : 60;
      seekTo(video.currentTime + direction * (1 / fps));
    },
    [clip.fps, pauseAllAudio, seekTo]
  );

  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      el.requestFullscreen().catch(() => {});
    }
  }, []);

  const handleChangeMasterVolume = useCallback((next: number) => {
    const clamped = Math.min(100, Math.max(0, Math.round(next)));
    setMasterVolume(clamped);
  }, []);

  const handleToggleMute = useCallback(() => {
    if (masterMuted || masterVolume === 0) {
      setMasterMuted(false);
      if (masterVolume === 0) {
        setMasterVolume(lastNonZeroVolumeRef.current || 100);
      }
    } else {
      setMasterMuted(true);
    }
  }, [masterMuted, masterVolume]);

  const commitTrimRange = useCallback(
    (nextStart: number, nextEnd: number) => {
      onSaveTrimRange?.(clipIdRef.current, nextStart, nextEnd);
    },
    [onSaveTrimRange]
  );

  const handleShortcutSetStart = useCallback(
    (value: number | ((prev: number) => number)) => {
      setStartSec((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        commitTrimRange(next, endSecRef.current);
        return next;
      });
    },
    [commitTrimRange]
  );

  const handleShortcutSetEnd = useCallback(
    (value: number | ((prev: number) => number)) => {
      setEndSec((prev) => {
        const next = typeof value === "function" ? value(prev) : value;
        commitTrimRange(startSecRef.current, next);
        return next;
      });
    },
    [commitTrimRange]
  );

  usePlayerShortcuts({
    clip,
    videoRef,
    currentTime,
    duration,
    startSec,
    endSec,
    mixerOpen,
    prevClip,
    nextClip,
    setMixerOpen,
    setStartSec: handleShortcutSetStart,
    setEndSec: handleShortcutSetEnd,
    setLoopActive,
    onToggleMute: handleToggleMute,
    setAspectMode,
    showHudBriefly,
    togglePlay,
    seekTo,
    stepFrame,
    toggleFullscreen,
    onBack,
    onOpenCollectionPicker,
    onToggleFavorite,
    onDeleteClip,
    onSelectClip,
  });

  const handleVideoTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const t = video.currentTime;
    setCurrentTime(t);

    const totalDur = duration || clip.durationSec;
    const isTrimmed = startSec > 0.02 || endSec < totalDur - 0.1;

    if (loopActive && endSec > startSec && t >= endSec - 0.04) {
      seekTo(startSec);
      return;
    }

    if (!loopActive && isPlaying && isTrimmed && endSec > startSec && t >= endSec) {
      video.pause();
      pauseAllAudio();
      setIsPlaying(false);
    }
  };

  const handleVideoEnded = () => {
    pauseAllAudio();
    setIsPlaying(false);
    if (loopActive) {
      seekTo(startSec);
      void togglePlay();
      return;
    }
    if (autoNext && nextClip) {
      setCountdownSec(2);
    }
  };

  const triggerExport = async (preset: ExportPreset) => {
    if (exportingPreset) return;
    setExportingPreset(preset);
    try {
      await onStartExport({
        clip,
        preset,
        startSec,
        endSec,
        audioMix: getEffectiveMix(),
        copyToClipboard: autoCopyToClipboard,
        aspectMode,
        normalizeAudio,
      });
    } finally {
      setExportingPreset(null);
    }
  };

  const handleSetCoverAction = async () => {
    if (settingCover || !isTauriRuntime()) return;
    setSettingCover(true);
    try {
      await onSetCover(clip, videoRef.current?.currentTime ?? currentTime);
    } finally {
      setSettingCover(false);
    }
  };

  const handleSnapshotAction = async () => {
    if (takingSnapshot || !isTauriRuntime()) return;
    setTakingSnapshot(true);
    try {
      await onSnapshotFrame({
        clip,
        timeSec: videoRef.current?.currentTime ?? currentTime,
        aspectMode,
        copyToClipboard: autoCopyToClipboard,
      });
    } finally {
      setTakingSnapshot(false);
    }
  };

  const selectedDur = Math.max(0, endSec - startSec);
  const canSaveSelection = selectedDur >= 0.2;

  const handlePlayerStageContextMenu = (x: number, y: number) => {
    onOpenContextMenu(
      x,
      y,
      buildPlayerStageContextMenuEntries({
        clip,
        canSaveSelection,
        settingCover,
        takingSnapshot,
        onOpenCollectionPicker,
        onOpenSaveTrim: () =>
          onOpenSaveTrimModal({
            clip,
            startSec,
            endSec,
            audioMix: getEffectiveMix(),
            aspectMode,
            normalizeAudio,
          }),
        onSendToEditor: () =>
          onSendToEditor({
            clip,
            startSec,
            endSec,
            audioMix: getEffectiveMix(),
            masterVolume,
            masterMuted,
          }),
        onSetCover: () => void handleSetCoverAction(),
        onSnapshot: () => void handleSnapshotAction(),
        onToggleFavorite,
        onEditClip,
        onRevealFile,
        onDeleteClip,
      })
    );
  };

  const handleQueueContextMenu = (item: ClipSummary, x: number, y: number) => {
    onOpenContextMenu(
      x,
      y,
      buildQueueContextMenuEntries({
        item,
        activeClipId: clip.id,
        onSelectClip,
        onOpenCollectionPicker,
        onToggleFavorite,
        onEditClip,
        onRevealFile,
        onDeleteClip,
      })
    );
  };

  const videoSrc = streamerBaseUrl
    ? getVideoStreamUrl(streamerBaseUrl, streamerToken, clip.id)
    : "";
  const displayTitle = clip.title?.trim() || clip.fileName;
  const isStretched = aspectMode === "stretch_16_9";

  const controlsElement = (
    <PlayerControls
      clip={clip}
      streamerBaseUrl={streamerBaseUrl}
      streamerToken={streamerToken}
      duration={duration}
      currentTime={currentTime}
      startSec={startSec}
      endSec={endSec}
      isPlaying={isPlaying}
      playbackRate={playbackRate}
      loopActive={loopActive}
      isStretched={isStretched}
      normalizeAudio={normalizeAudio}
      masterMuted={masterMuted}
      masterVolume={masterVolume}
      mixerOpen={mixerOpen}
      isFullscreen={isFullscreen}
      tracks={tracks}
      mixes={mixes}
      soloTrackOrder={soloTrackOrder}
      exportingPreset={exportingPreset}
      onTogglePlay={() => void togglePlay()}
      onSeek={seekTo}
      onStepFrame={stepFrame}
      onChangeTrim={(nextStart, nextEnd) => {
        setStartSec(nextStart);
        setEndSec(nextEnd);
        commitTrimRange(nextStart, nextEnd);
      }}
      onResetTrim={() => {
        const fullEnd = duration || clip.durationSec;
        setStartSec(0);
        setEndSec(fullEnd);
        commitTrimRange(0, fullEnd);
      }}
      onChangePlaybackRate={setPlaybackRate}
      onToggleLoop={() => setLoopActive((prev) => !prev)}
      onToggleStretch={() =>
        setAspectMode((prev) => (prev === "original" ? "stretch_16_9" : "original"))
      }
      onToggleNormalize={() => setNormalizeAudio((prev) => !prev)}
      onToggleMute={handleToggleMute}
      onChangeMasterVolume={handleChangeMasterVolume}
      onSetMasterMuted={setMasterMuted}
      onToggleMixer={() => setMixerOpen((prev) => !prev)}
      onCloseMixer={() => setMixerOpen(false)}
      onChangeMix={handleMixChange}
      onToggleSolo={handleToggleSolo}
      onToggleFullscreen={toggleFullscreen}
      onTriggerExport={(preset) => void triggerExport(preset)}
      onOpenStageContextMenu={handlePlayerStageContextMenu}
    />
  );

  return (
    <main className="view-enter flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--surface-canvas)]">
      <PlayerHeader
        clip={clip}
        displayTitle={displayTitle}
        sourceLabel={sourceLabel}
        currentIndex={currentIndex}
        queueLength={queue.length}
        autoNext={autoNext}
        queueOpen={queueOpen}
        onBack={onBack}
        onToggleAutoNext={() => setAutoNext((prev) => !prev)}
        onToggleQueue={() => setQueueOpen((prev) => !prev)}
        onOpenCollectionPicker={onOpenCollectionPicker}
        onToggleFavorite={onToggleFavorite}
      />

      <div className="relative flex min-h-0 flex-1 overflow-hidden">
        <div
          ref={stageRef}
          onMouseMove={showHudBriefly}
          className={`flex min-w-0 flex-1 flex-col gap-3 overflow-y-auto p-4 ${
            isFullscreen ? "justify-between bg-black p-0" : ""
          }`}
        >
          <PlayerVideoStage
            clip={clip}
            displayTitle={displayTitle}
            videoSrc={videoSrc}
            isFullscreen={isFullscreen}
            isStretched={isStretched}
            videoRef={videoRef}
            pulseIcon={pulseIcon}
            countdownSec={countdownSec}
            nextClip={nextClip}
            onTogglePlay={() => void togglePlay()}
            onLoadedMetadata={(d) => {
              setDuration(d);
              setEndSec((prev) => (prev <= 0 ? d : Math.min(prev, d)));
              const vid = videoRef.current;
              if (
                !hasUserInteractedWithClipRef.current &&
                startSecRef.current > 0 &&
                vid &&
                vid.currentTime < startSecRef.current - 0.05
              ) {
                const target = Math.min(d, startSecRef.current);
                vid.currentTime = target;
                setCurrentTime(target);
                syncAudioSeek(target);
              }
              syncAudioOutput();
            }}
            onTimeUpdate={handleVideoTimeUpdate}
            onEnded={handleVideoEnded}
            onCancelCountdown={() => setCountdownSec(null)}
            onOpenStageContextMenu={handlePlayerStageContextMenu}
          />

          <div
            className={
              isFullscreen
                ? `hud-bar pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4 ${
                    hudVisible ? "translate-y-0 opacity-100" : "translate-y-2.5 opacity-0"
                  }`
                : "w-full shrink-0"
            }
          >
            <div className={isFullscreen ? "pointer-events-auto w-full max-w-[960px]" : "w-full"}>
              {controlsElement}
            </div>
          </div>
        </div>

        <PlayerQueue
          open={queueOpen}
          isCompact={isCompact}
          isFullscreen={isFullscreen}
          activeClipId={clip.id}
          queue={queue}
          onSelectClip={onSelectClip}
          onQueueContextMenu={handleQueueContextMenu}
        />
      </div>
    </main>
  );
}
