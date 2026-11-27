import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RectangleHorizontal,
  Repeat,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Smartphone,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
import { isTauriRuntime } from "../../lib/api";
import { formatTimecode } from "../../lib/format";
import { formatCustomPresetSpec } from "../../lib/presets";
import type {
  AudioTrack,
  AudioTrackMix,
  ClipMarker,
  ClipSummary,
  CustomExportPreset,
  ExportPreset,
  MarkerColor,
} from "../../lib/types";
import { AudioMixerPopover } from "../AudioMixerPopover";
import { GlassSelect } from "../GlassSelect";
import { TrimBar } from "../TrimBar";

const SPEED_OPTIONS = [
  { value: 0.25, label: "0.25x" },
  { value: 0.5, label: "0.5x" },
  { value: 1, label: "1x" },
  { value: 1.5, label: "1.5x" },
  { value: 2, label: "2x" },
] as const;

interface PlayerControlsProps {
  clip: ClipSummary;
  streamerBaseUrl: string;
  streamerToken: string;
  duration: number;
  currentTime: number;
  startSec: number;
  endSec: number;
  isPlaying: boolean;
  playbackRate: number;
  loopActive: boolean;
  isStretched: boolean;
  normalizeAudio: boolean;
  masterMuted: boolean;
  masterVolume: number;
  mixerOpen: boolean;
  isFullscreen: boolean;
  tracks: AudioTrack[];
  mixes: AudioTrackMix[];
  soloTrackOrder: number | null;
  exportingPreset: ExportPreset | null;
  customPresets: CustomExportPreset[];
  markers: ClipMarker[];
  focusedMarkerId: string | null;
  onClearFocusedMarker: () => void;
  onAddMarkerAtPlayhead: () => void;
  onUpdateMarker: (
    id: string,
    patch: { label?: string; color?: MarkerColor; timeSec?: number }
  ) => Promise<void> | void;
  onDeleteMarker: (id: string) => Promise<void> | void;
  onTogglePlay: () => void;
  onSeek: (timeSec: number) => void;
  onStepFrame: (direction: -1 | 1) => void;
  onChangeTrim: (startSec: number, endSec: number) => void;
  onResetTrim: () => void;
  onChangePlaybackRate: (rate: number) => void;
  onToggleLoop: () => void;
  onToggleStretch: () => void;
  onToggleNormalize: () => void;
  onToggleMute: () => void;
  onChangeMasterVolume: (volume: number) => void;
  onSetMasterMuted: (muted: boolean) => void;
  onToggleMixer: () => void;
  onCloseMixer: () => void;
  onChangeMix: (trackOrder: number, next: Partial<AudioTrackMix>) => void;
  onToggleSolo: (trackOrder: number) => void;
  onToggleFullscreen: () => void;
  onTriggerExport: (preset: ExportPreset) => void;
  onTriggerCustomExport: (customPreset: CustomExportPreset) => void;
  onOpenExportSettings: () => void;
  onOpenStageContextMenu: (x: number, y: number) => void;
}

export function PlayerControls({
  clip,
  streamerBaseUrl,
  streamerToken,
  duration,
  currentTime,
  startSec,
  endSec,
  isPlaying,
  playbackRate,
  loopActive,
  isStretched,
  normalizeAudio,
  masterMuted,
  masterVolume,
  mixerOpen,
  isFullscreen,
  tracks,
  mixes,
  soloTrackOrder,
  exportingPreset,
  customPresets,
  markers,
  focusedMarkerId,
  onClearFocusedMarker,
  onAddMarkerAtPlayhead,
  onUpdateMarker,
  onDeleteMarker,
  onTogglePlay,
  onSeek,
  onStepFrame,
  onChangeTrim,
  onResetTrim,
  onChangePlaybackRate,
  onToggleLoop,
  onToggleStretch,
  onToggleNormalize,
  onToggleMute,
  onChangeMasterVolume,
  onSetMasterMuted,
  onToggleMixer,
  onCloseMixer,
  onChangeMix,
  onToggleSolo,
  onToggleFullscreen,
  onTriggerExport,
  onTriggerCustomExport,
  onOpenExportSettings,
  onOpenStageContextMenu,
}: PlayerControlsProps) {
  const [verticalMenuOpen, setVerticalMenuOpen] = useState(false);
  const [customMenuOpen, setCustomMenuOpen] = useState(false);
  const [volumeSliderOpen, setVolumeSliderOpen] = useState(false);
  const [isDraggingVolume, setIsDraggingVolume] = useState(false);
  const verticalMenuRef = useRef<HTMLDivElement>(null);
  const customMenuRef = useRef<HTMLDivElement>(null);
  const volumeControlRef = useRef<HTMLDivElement>(null);
  const wheelHideTimerRef = useRef<number | null>(null);
  const hoverCloseTimerRef = useRef<number | null>(null);

  const openVolumePopover = () => {
    if (hoverCloseTimerRef.current) {
      window.clearTimeout(hoverCloseTimerRef.current);
      hoverCloseTimerRef.current = null;
    }
    setVolumeSliderOpen(true);
  };

  const scheduleCloseVolumePopover = () => {
    if (isDraggingVolume) return;
    if (hoverCloseTimerRef.current) {
      window.clearTimeout(hoverCloseTimerRef.current);
    }
    hoverCloseTimerRef.current = window.setTimeout(() => {
      setVolumeSliderOpen(false);
      hoverCloseTimerRef.current = null;
    }, 180);
  };

  useEffect(() => {
    const el = volumeControlRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (e.deltaY === 0) return;
      e.preventDefault();
      e.stopPropagation();

      const step = e.shiftKey ? 1 : 5;
      const direction = e.deltaY < 0 ? 1 : -1;
      const nextVol = Math.max(0, Math.min(100, masterVolume + direction * step));

      onChangeMasterVolume(nextVol);
      if (direction > 0 && masterMuted && nextVol > 0) {
        onSetMasterMuted(false);
      }

      setVolumeSliderOpen(true);
      if (wheelHideTimerRef.current) {
        window.clearTimeout(wheelHideTimerRef.current);
      }
      wheelHideTimerRef.current = window.setTimeout(() => {
        setVolumeSliderOpen(false);
      }, 1200);
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => {
      el.removeEventListener("wheel", handleWheel);
    };
  }, [masterMuted, masterVolume, onChangeMasterVolume, onSetMasterMuted]);

  useEffect(() => {
    return () => {
      if (wheelHideTimerRef.current) {
        window.clearTimeout(wheelHideTimerRef.current);
      }
      if (hoverCloseTimerRef.current) {
        window.clearTimeout(hoverCloseTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isDraggingVolume) return;
    const handlePointerUp = () => {
      setIsDraggingVolume(false);
      if (
        volumeControlRef.current &&
        !volumeControlRef.current.matches(":hover")
      ) {
        scheduleCloseVolumePopover();
      }
    };
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerUp);
    return () => {
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerUp);
    };
  }, [isDraggingVolume]);

  useEffect(() => {
    if (!verticalMenuOpen && !customMenuOpen) return;
    const handleOutside = (e: MouseEvent) => {
      if (
        verticalMenuOpen &&
        verticalMenuRef.current &&
        !verticalMenuRef.current.contains(e.target as Node)
      ) {
        setVerticalMenuOpen(false);
      }
      if (
        customMenuOpen &&
        customMenuRef.current &&
        !customMenuRef.current.contains(e.target as Node)
      ) {
        setCustomMenuOpen(false);
      }
    };
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setVerticalMenuOpen(false);
        setCustomMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", handleOutside);
    window.addEventListener("keydown", handleEsc, true);
    return () => {
      window.removeEventListener("mousedown", handleOutside);
      window.removeEventListener("keydown", handleEsc, true);
    };
  }, [customMenuOpen, verticalMenuOpen]);

  const blurIfMouse = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (e.detail > 0) e.currentTarget.blur();
  };

  const inTauri = isTauriRuntime();

  return (
    <div
      className={`${
        isFullscreen ? "glass-fullscreen" : "glass-dock"
      } rounded-[16px] p-4`}
    >
      <div
        data-testid="player-trim-region"
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenStageContextMenu(e.clientX, e.clientY);
        }}
      >
        <TrimBar
          clip={clip}
          streamerBaseUrl={streamerBaseUrl}
          streamerToken={streamerToken}
          duration={duration || clip.durationSec}
          currentTime={currentTime}
          startSec={startSec}
          endSec={endSec}
          tracks={tracks}
          mixes={mixes}
          soloTrackOrder={soloTrackOrder}
          markers={markers}
          focusedMarkerId={focusedMarkerId}
          onClearFocusedMarker={onClearFocusedMarker}
          onAddMarker={onAddMarkerAtPlayhead}
          onUpdateMarker={onUpdateMarker}
          onDeleteMarker={onDeleteMarker}
          onSeek={onSeek}
          onChangeTrim={onChangeTrim}
          onResetTrim={onResetTrim}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              blurIfMouse(e);
              onTogglePlay();
            }}
            aria-label={isPlaying ? "Pause (Space)" : "Play (Space)"}
            title="Play / Pause (Space)"
            className="btn-primary h-10 w-10 p-0"
          >
            {isPlaying ? (
              <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              blurIfMouse(e);
              onSeek(currentTime - 5);
            }}
            aria-label="Back 5 seconds (J)"
            title="Back 5s (J)"
            className="btn-secondary h-9 gap-1 px-2.5 text-[12px]"
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-mono-tabular">-5s</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              blurIfMouse(e);
              onStepFrame(-1);
            }}
            aria-label="Step back 1 frame (Comma)"
            title="Step -1 frame (,)"
            className="btn-secondary h-9 gap-1 px-2.5 text-[12px]"
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="font-mono-tabular">1f</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              blurIfMouse(e);
              onStepFrame(1);
            }}
            aria-label="Step forward 1 frame (Period)"
            title="Step +1 frame (.)"
            className="btn-secondary h-9 gap-1 px-2.5 text-[12px]"
          >
            <span className="font-mono-tabular">1f</span>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              blurIfMouse(e);
              onSeek(currentTime + 5);
            }}
            aria-label="Forward 5 seconds (L)"
            title="Forward 5s (L)"
            className="btn-secondary h-9 gap-1 px-2.5 text-[12px]"
          >
            <span className="font-mono-tabular">+5s</span>
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <span className="font-mono-tabular ml-2 text-[13px] font-medium text-[var(--text-primary)]">
            {formatTimecode(currentTime)} / {formatTimecode(duration || clip.durationSec)}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <GlassSelect
            ariaLabel="Playback speed"
            value={playbackRate}
            options={SPEED_OPTIONS}
            onChange={onChangePlaybackRate}
            placement="up"
            mono
            size="md"
          />

          <button
            type="button"
            onClick={(e) => {
              blurIfMouse(e);
              onToggleLoop();
            }}
            aria-pressed={loopActive}
            title="Loop selection (R)"
            className={`btn-toggle-pill inline-flex h-9 items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-medium ${
              loopActive
                ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] text-[var(--accent-text)]"
                : "border-[var(--border-control)] bg-[var(--surface-control)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] hover:bg-[var(--surface-control-hover)] hover:border-[#475569]"
            }`}
          >
            <Repeat className="h-3.5 w-3.5" aria-hidden="true" />
            Loop
          </button>

          <button
            type="button"
            onClick={(e) => {
              blurIfMouse(e);
              onToggleStretch();
            }}
            aria-pressed={isStretched}
            title="Stretch non-16:9 clips to fill 16:9 (applies to preview, export, and saved clip)"
            className={`btn-toggle-pill inline-flex h-9 items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-medium ${
              isStretched
                ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] text-[var(--accent-text)]"
                : "border-[var(--border-control)] bg-[var(--surface-control)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] hover:bg-[var(--surface-control-hover)] hover:border-[#475569]"
            }`}
          >
            <RectangleHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            Stretch 16:9
          </button>

          <button
            type="button"
            onClick={(e) => {
              blurIfMouse(e);
              onToggleNormalize();
            }}
            aria-pressed={normalizeAudio}
            title="Balance audio volume (loudnorm) on export and saved clips"
            className={`btn-toggle-pill inline-flex h-9 items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-medium ${
              normalizeAudio
                ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] text-[var(--accent-text)]"
                : "border-[var(--border-control)] bg-[var(--surface-control)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] hover:bg-[var(--surface-control-hover)] hover:border-[#475569]"
            }`}
          >
            <AudioLines className="h-3.5 w-3.5" aria-hidden="true" />
            Normalize
          </button>

          <div
            ref={volumeControlRef}
            onMouseEnter={openVolumePopover}
            onMouseLeave={scheduleCloseVolumePopover}
            className="relative"
          >
            <button
              type="button"
              data-testid="player-volume-button"
              onClick={(e) => {
                blurIfMouse(e);
                e.stopPropagation();
                onToggleMute();
              }}
              aria-label={
                masterMuted || masterVolume === 0
                  ? `Unmute audio (U), volume ${masterVolume}%`
                  : `Mute audio (U), volume ${masterVolume}%`
              }
              aria-pressed={masterMuted || masterVolume === 0}
              title={`Preview volume: ${masterMuted ? 0 : masterVolume}% (Scroll to adjust, U to mute)`}
              className={`btn-secondary h-9 min-w-[64px] gap-1.5 px-2.5 text-[12px] ${
                masterMuted || masterVolume === 0 ? "text-[var(--status-error-fg)]" : ""
              }`}
            >
              {masterMuted || masterVolume === 0 ? (
                <VolumeX className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : masterVolume < 50 ? (
                <Volume1 className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              <span className="font-mono-tabular w-8 text-right text-[11px] font-semibold">
                {masterMuted ? 0 : masterVolume}%
              </span>
            </button>

            {volumeSliderOpen && (
              <div className="absolute right-0 bottom-full z-40 pb-2">
                <div
                  data-testid="player-volume-popover"
                  className="glass-dock popover-enter origin-bottom-right flex w-[188px] items-center gap-2 rounded-[10px] px-3 py-2"
                >
                  <input
                    type="range"
                    aria-label="Preview volume"
                    min={0}
                    max={100}
                    step={1}
                    value={masterMuted ? 0 : masterVolume}
                    onPointerDown={() => setIsDraggingVolume(true)}
                    onChange={(e) => {
                      const nextVal = Number(e.target.value);
                      onChangeMasterVolume(nextVal);
                      if (nextVal > 0 && masterMuted) {
                        onSetMasterMuted(false);
                      }
                    }}
                    className="h-1.5 flex-1 cursor-pointer accent-[var(--accent-primary)]"
                  />
                  <span className="font-mono-tabular w-9 text-right text-[11px] font-semibold text-[var(--text-primary)]">
                    {masterMuted ? 0 : masterVolume}%
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={onToggleMixer}
              aria-expanded={mixerOpen}
              className={`btn-toggle-pill inline-flex h-9 items-center gap-1.5 rounded-[8px] border px-3 text-[12px] font-medium ${
                mixerOpen
                  ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] text-[var(--accent-text)]"
                  : "border-[var(--border-control)] bg-[var(--surface-control)] text-[var(--text-primary)] shadow-[inset_0_1px_0_rgba(255,255,255,0.88)] hover:bg-[var(--surface-control-hover)] hover:border-[#475569]"
              }`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              Audio Mixer · {tracks.length || 1}
            </button>

            <AudioMixerPopover
              open={mixerOpen}
              tracks={tracks}
              mixes={mixes}
              soloTrackOrder={soloTrackOrder}
              onChangeMix={onChangeMix}
              onToggleSolo={onToggleSolo}
              onClose={onCloseMixer}
            />
          </div>

          <button
            type="button"
            onClick={(e) => {
              blurIfMouse(e);
              e.stopPropagation();
              onToggleFullscreen();
            }}
            aria-label={isFullscreen ? "Exit fullscreen (F)" : "Fullscreen (F)"}
            title="Fullscreen (F)"
            className="btn-secondary h-9 w-9 p-0"
          >
            {isFullscreen ? (
              <Minimize2 className="h-4 w-4" aria-hidden="true" />
            ) : (
              <Maximize2 className="h-4 w-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {!isFullscreen && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border-hairline)] pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => onTriggerExport("discord_10mb")}
              disabled={exportingPreset !== null || !inTauri}
              title={!inTauri ? "Export requires Glint desktop app" : undefined}
              className="btn-primary h-[38px] px-4 text-[13px]"
            >
              Fit to Discord (10 MB)
            </button>
            <button
              type="button"
              onClick={() => onTriggerExport("discord_25mb")}
              disabled={exportingPreset !== null || !inTauri}
              className="btn-secondary h-[38px] px-3.5 text-[13px]"
            >
              25 MB
            </button>
            <button
              type="button"
              onClick={() => onTriggerExport("lossless_trim")}
              disabled={exportingPreset !== null || !inTauri}
              className="btn-secondary h-[38px] px-3.5 text-[13px]"
            >
              Original (Lossless)
            </button>

            <div ref={verticalMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setVerticalMenuOpen((prev) => !prev)}
                disabled={exportingPreset !== null || !inTauri}
                aria-expanded={verticalMenuOpen}
                aria-haspopup="menu"
                title={
                  !inTauri
                    ? "Export requires Glint desktop app"
                    : "Export 9:16 vertical clip for TikTok, Reels, or Shorts"
                }
                className="btn-secondary h-[38px] gap-1.5 px-3.5 text-[13px]"
              >
                <Smartphone
                  className="h-4 w-4 text-[var(--text-secondary)]"
                  aria-hidden="true"
                />
                <span>9:16 Vertical</span>
                <ChevronDown
                  className="h-3.5 w-3.5 text-[var(--text-secondary)]"
                  aria-hidden="true"
                />
              </button>

              {verticalMenuOpen && (
                <div
                  role="menu"
                  aria-label="9:16 Vertical export options"
                  className="glass-dock popover-enter origin-bottom-right absolute right-0 bottom-11 z-40 w-[250px] rounded-[12px] p-1.5"
                >
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setVerticalMenuOpen(false);
                      onTriggerExport("vertical_blur_9_16");
                    }}
                    className="nav-item-press flex w-full flex-col items-start rounded-[8px] px-3 py-2 text-left hover:bg-slate-900/5"
                  >
                    <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                      9:16 Blur Background
                    </span>
                    <span className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      1080x1920 with blurred backdrop
                    </span>
                  </button>

                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setVerticalMenuOpen(false);
                      onTriggerExport("vertical_crop_9_16");
                    }}
                    className="nav-item-press mt-0.5 flex w-full flex-col items-start rounded-[8px] px-3 py-2 text-left hover:bg-slate-900/5"
                  >
                    <span className="text-[13px] font-semibold text-[var(--text-primary)]">
                      9:16 Center Crop
                    </span>
                    <span className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                      1080x1920 full vertical crop
                    </span>
                  </button>
                </div>
              )}
            </div>

            <div ref={customMenuRef} className="relative">
              <button
                type="button"
                onClick={() => setCustomMenuOpen((prev) => !prev)}
                disabled={exportingPreset !== null || !inTauri}
                aria-expanded={customMenuOpen}
                aria-haspopup="menu"
                title={!inTauri ? "Export requires Glint desktop app" : "Export with a custom preset"}
                className="btn-secondary h-[38px] gap-1.5 px-3.5 text-[13px]"
              >
                <SlidersHorizontal
                  className="h-3.5 w-3.5 text-[var(--text-secondary)]"
                  aria-hidden="true"
                />
                <span>Custom</span>
                <ChevronDown
                  className="h-3.5 w-3.5 text-[var(--text-secondary)]"
                  aria-hidden="true"
                />
              </button>

              {customMenuOpen && (
                <div
                  role="menu"
                  aria-label="Custom export presets"
                  className="glass-dock popover-enter origin-bottom-right absolute right-0 bottom-11 z-40 w-[272px] rounded-[12px] p-1.5"
                >
                  {customPresets.length === 0 ? (
                    <div className="px-3 py-2.5 text-left">
                      <p className="text-[12px] font-medium text-[var(--text-secondary)]">
                        No custom presets
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          setCustomMenuOpen(false);
                          onOpenExportSettings();
                        }}
                        className="mt-1.5 text-[12px] font-semibold text-[var(--accent-primary)] hover:underline"
                      >
                        Create in Settings
                      </button>
                    </div>
                  ) : (
                    <div className="max-h-[240px] space-y-0.5 overflow-y-auto">
                      {customPresets.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setCustomMenuOpen(false);
                            onTriggerCustomExport(preset);
                          }}
                          className="nav-item-press flex w-full flex-col items-start rounded-[8px] px-3 py-2 text-left hover:bg-slate-900/5"
                        >
                          <span className="w-full truncate text-[13px] font-semibold text-[var(--text-primary)]">
                            {preset.name}
                          </span>
                          <span className="font-mono-tabular mt-0.5 w-full truncate text-[11px] text-[var(--text-secondary)]">
                            {formatCustomPresetSpec(preset)}
                          </span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
