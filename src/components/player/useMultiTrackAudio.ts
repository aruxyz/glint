import { useCallback, useEffect, useRef, useState } from "react";
import { api, getAudioStreamUrl, isTauriRuntime } from "../../lib/api";
import type { AudioTrack, AudioTrackMix, ClipSummary } from "../../lib/types";

interface UseMultiTrackAudioParams {
  clip: ClipSummary;
  streamerBaseUrl: string;
  streamerToken: string;
  playbackRate: number;
  masterMuted: boolean;
  masterVolume: number;
  isPlaying: boolean;
  isFullscreen: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export function useMultiTrackAudio({
  clip,
  streamerBaseUrl,
  streamerToken,
  playbackRate,
  masterMuted,
  masterVolume,
  isPlaying,
  isFullscreen,
  videoRef,
}: UseMultiTrackAudioParams) {
  const [tracks, setTracks] = useState<AudioTrack[]>([]);
  const [mixes, setMixes] = useState<AudioTrackMix[]>([]);
  const [soloTrackOrder, setSoloTrackOrder] = useState<number | null>(null);

  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioElsRef = useRef<Map<number, HTMLAudioElement>>(new Map());
  const gainNodesRef = useRef<Map<number, GainNode>>(new Map());

  // Fetch audio track metadata when switching clips.
  useEffect(() => {
    setSoloTrackOrder(null);

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
    setTracks(fallbackTracks);
    setMixes(
      fallbackTracks.map((t) => ({
        trackOrder: t.trackOrder,
        streamIndex: t.streamIndex,
        muted: false,
        volume: 1,
      }))
    );

    if (!isTauriRuntime()) return;
    let active = true;
    api
      .getClipDetail(clip.id)
      .then((detail) => {
        if (!active) return;
        const resolved =
          detail.audioTracks.length > 0 ? detail.audioTracks : fallbackTracks;
        setTracks(resolved);
        setMixes(
          resolved.map((t) => ({
            trackOrder: t.trackOrder,
            streamIndex: t.streamIndex,
            muted: false,
            volume: 1,
          }))
        );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [clip.id, clip.audioTrackCount]);

  const useMultiTrackEngine = tracks.length >= 2 && Boolean(streamerBaseUrl);

  // Rebuild Web Audio multi-track elements when clip or track list changes.
  useEffect(() => {
    const cleanupAudio = () => {
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

    cleanupAudio();
    if (!useMultiTrackEngine) {
      return cleanupAudio;
    }

    const AudioCtx = window.AudioContext;
    const ctx = new AudioCtx();
    audioCtxRef.current = ctx;

    for (const track of tracks) {
      const audioEl = new Audio();
      audioEl.crossOrigin = "anonymous";
      audioEl.preload = "auto";
      audioEl.src = getAudioStreamUrl(
        streamerBaseUrl,
        streamerToken,
        clip.id,
        track.trackOrder
      );
      const sourceNode = ctx.createMediaElementSource(audioEl);
      const gainNode = ctx.createGain();
      sourceNode.connect(gainNode);
      gainNode.connect(ctx.destination);
      audioElsRef.current.set(track.trackOrder, audioEl);
      gainNodesRef.current.set(track.trackOrder, gainNode);
    }

    return cleanupAudio;
  }, [clip.id, streamerBaseUrl, streamerToken, tracks, useMultiTrackEngine]);

  // Apply preview volume, mute, solo, and mixer gains without mutating export mixes.
  const syncAudioOutput = useCallback(() => {
    const video = videoRef.current;
    const clampedPct = Math.min(100, Math.max(0, masterVolume));
    const previewScale = clampedPct / 100;

    if (useMultiTrackEngine) {
      if (video) video.muted = true;
      for (const mix of mixes) {
        const gainNode = gainNodesRef.current.get(mix.trackOrder);
        if (!gainNode) continue;
        const suppressedBySolo =
          soloTrackOrder !== null && soloTrackOrder !== mix.trackOrder;
        const baseGain =
          masterMuted || mix.muted || suppressedBySolo ? 0 : mix.volume;
        gainNode.gain.value = baseGain * previewScale;
      }
      if (isPlaying && audioCtxRef.current?.state === "suspended") {
        audioCtxRef.current.resume().catch(() => {});
      }
    } else if (video) {
      const primary = mixes[0];
      const trackVol = Math.min(1, Math.max(0, primary?.volume ?? 1));
      const effectiveVol = masterMuted
        ? 0
        : Math.min(1, Math.max(0, trackVol * previewScale));
      video.volume = effectiveVol;
      video.muted = masterMuted || Boolean(primary?.muted) || clampedPct === 0;
    }
  }, [
    isPlaying,
    masterMuted,
    masterVolume,
    mixes,
    soloTrackOrder,
    useMultiTrackEngine,
    videoRef,
  ]);

  // Re-sync audio output on volume/mixer changes and fullscreen transitions.
  useEffect(() => {
    syncAudioOutput();
    const raf = window.requestAnimationFrame(() => syncAudioOutput());
    return () => window.cancelAnimationFrame(raf);
  }, [syncAudioOutput, isFullscreen]);

  // Sync playbackRate across video and multi-track audio elements.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.playbackRate = playbackRate;
    for (const el of audioElsRef.current.values()) {
      el.playbackRate = playbackRate;
    }
  }, [playbackRate, videoRef]);

  // Drift guard loop keeps multi-track audio aligned to video while playing.
  useEffect(() => {
    if (!isPlaying || !useMultiTrackEngine) return;
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      for (const el of audioElsRef.current.values()) {
        if (Math.abs(el.currentTime - video.currentTime) > 0.08) {
          el.currentTime = video.currentTime;
        }
      }
    }, 350);
    return () => window.clearInterval(id);
  }, [isPlaying, useMultiTrackEngine, videoRef]);

  const syncAudioSeek = useCallback((targetTime: number) => {
    for (const el of audioElsRef.current.values()) {
      el.currentTime = targetTime;
    }
  }, []);

  const pauseAllAudio = useCallback(() => {
    for (const el of audioElsRef.current.values()) {
      el.pause();
    }
  }, []);

  const playAllAudio = useCallback(
    async (timeSec: number) => {
      if (audioCtxRef.current?.state === "suspended") {
        await audioCtxRef.current.resume().catch(() => {});
      }
      if (!useMultiTrackEngine) return;
      for (const el of audioElsRef.current.values()) {
        el.currentTime = timeSec;
        el.play().catch(() => {});
      }
    },
    [useMultiTrackEngine]
  );

  const handleMixChange = useCallback(
    (trackOrder: number, next: Partial<AudioTrackMix>) => {
      setMixes((prev) =>
        prev.map((m) => (m.trackOrder === trackOrder ? { ...m, ...next } : m))
      );
    },
    []
  );

  const handleToggleSolo = useCallback((trackOrder: number) => {
    setSoloTrackOrder((prev) => (prev === trackOrder ? null : trackOrder));
  }, []);

  // Export mix ignores preview masterVolume so exported clips keep full intended levels.
  const getEffectiveMix = useCallback(
    (): AudioTrackMix[] =>
      mixes.map((m) => ({
        ...m,
        muted:
          masterMuted ||
          m.muted ||
          (soloTrackOrder !== null && soloTrackOrder !== m.trackOrder),
      })),
    [masterMuted, mixes, soloTrackOrder]
  );

  return {
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
  };
}
