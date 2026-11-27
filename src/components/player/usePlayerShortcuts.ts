import { useEffect, type Dispatch, type SetStateAction } from "react";
import type { AspectMode, ClipSummary } from "../../lib/types";

interface UsePlayerShortcutsParams {
  clip: ClipSummary;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  currentTime: number;
  duration: number;
  startSec: number;
  endSec: number;
  mixerOpen: boolean;
  prevClip: ClipSummary | null;
  nextClip: ClipSummary | null;
  setMixerOpen: Dispatch<SetStateAction<boolean>>;
  setStartSec: Dispatch<SetStateAction<number>>;
  setEndSec: Dispatch<SetStateAction<number>>;
  setLoopActive: Dispatch<SetStateAction<boolean>>;
  onToggleMute: () => void;
  onAddMarkerAtPlayhead: (timeSec: number) => void;
  setAspectMode: Dispatch<SetStateAction<AspectMode>>;
  showHudBriefly: () => void;
  togglePlay: () => void;
  seekTo: (timeSec: number) => void;
  stepFrame: (direction: -1 | 1) => void;
  toggleFullscreen: () => void;
  onBack: () => void;
  onOpenCollectionPicker: (clip: ClipSummary) => void;
  onToggleFavorite: (clip: ClipSummary) => void;
  onDeleteClip: (clip: ClipSummary) => void;
  onSelectClip: (clip: ClipSummary) => void;
}

export function usePlayerShortcuts({
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
  setStartSec,
  setEndSec,
  setLoopActive,
  onToggleMute,
  onAddMarkerAtPlayhead,
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
}: UsePlayerShortcutsParams): void {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.tagName === "SELECT" ||
          target.isContentEditable);
      if (isTyping) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (document.querySelector('[role="dialog"], [role="menu"], [role="listbox"]')) return;

      showHudBriefly();

      if (e.key === "Escape") {
        if (mixerOpen) {
          e.preventDefault();
          setMixerOpen(false);
          return;
        }
        if (document.fullscreenElement) {
          return;
        }
        e.preventDefault();
        onBack();
        return;
      }

      if (e.key === " " || e.code === "Space" || e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        togglePlay();
        return;
      }

      if (
        e.key.toLowerCase() === "j" ||
        (e.key === "ArrowLeft" && target?.getAttribute("role") !== "slider")
      ) {
        e.preventDefault();
        seekTo((videoRef.current?.currentTime ?? currentTime) - 5);
        return;
      }

      if (
        e.key.toLowerCase() === "l" ||
        (e.key === "ArrowRight" && target?.getAttribute("role") !== "slider")
      ) {
        e.preventDefault();
        seekTo((videoRef.current?.currentTime ?? currentTime) + 5);
        return;
      }

      if (e.key === ",") {
        e.preventDefault();
        stepFrame(-1);
        return;
      }

      if (e.key === ".") {
        e.preventDefault();
        stepFrame(1);
        return;
      }

      if (e.key.toLowerCase() === "i") {
        e.preventDefault();
        const t = videoRef.current?.currentTime ?? currentTime;
        setStartSec(Math.min(t, Math.max(0, endSec - 0.25)));
        return;
      }

      if (e.key.toLowerCase() === "o") {
        e.preventDefault();
        const t = videoRef.current?.currentTime ?? currentTime;
        setEndSec(Math.max(t, Math.min(duration || clip.durationSec, startSec + 0.25)));
        return;
      }

      if (e.key.toLowerCase() === "r") {
        e.preventDefault();
        setLoopActive((prev) => !prev);
        return;
      }

      if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        e.stopPropagation();
        onAddMarkerAtPlayhead(videoRef.current?.currentTime ?? currentTime);
        return;
      }

      if (e.key.toLowerCase() === "u") {
        e.preventDefault();
        e.stopPropagation();
        onToggleMute();
        return;
      }

      if (!e.shiftKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        setAspectMode((prev) =>
          prev === "original" ? "stretch_16_9" : "original"
        );
        return;
      }

      if (!e.shiftKey && e.key.toLowerCase() === "c") {
        e.preventDefault();
        onOpenCollectionPicker(clip);
        return;
      }

      if (e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        onToggleFavorite(clip);
        return;
      }

      if (e.key === "Delete" || e.key === "Del") {
        e.preventDefault();
        onDeleteClip(clip);
        return;
      }

      if (!e.shiftKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        e.stopPropagation();
        toggleFullscreen();
        return;
      }

      if (e.shiftKey && e.key.toLowerCase() === "p" && prevClip) {
        e.preventDefault();
        onSelectClip(prevClip);
        return;
      }

      if (e.shiftKey && e.key.toLowerCase() === "n" && nextClip) {
        e.preventDefault();
        onSelectClip(nextClip);
      }
    };

    window.addEventListener("keydown", handleKeyDown, { capture: true });
    return () =>
      window.removeEventListener("keydown", handleKeyDown, { capture: true });
  }, [
    clip,
    currentTime,
    duration,
    endSec,
    mixerOpen,
    nextClip,
    onBack,
    onDeleteClip,
    onOpenCollectionPicker,
    onSelectClip,
    onToggleFavorite,
    prevClip,
    seekTo,
    setAspectMode,
    setEndSec,
    setLoopActive,
    onAddMarkerAtPlayhead,
    onToggleMute,
    setMixerOpen,
    setStartSec,
    showHudBriefly,
    startSec,
    stepFrame,
    toggleFullscreen,
    togglePlay,
    videoRef,
  ]);
}
