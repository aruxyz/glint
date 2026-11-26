import { useEffect, useRef } from "react";
import { getLocalAudioStreamUrl } from "../lib/api";
import { EDITOR_MIN_AUDIO_TRIM_SEC } from "../lib/editor";
import type { EditorAudioLayer } from "../lib/types";

interface AudioNodeEntry {
  key: string;
  el: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  gain: GainNode;
}

interface UseEditorAudioPreviewParams {
  audioLayers: EditorAudioLayer[];
  playheadSec: number;
  isPlaying: boolean;
  streamerBaseUrl: string;
  streamerToken: string;
}

export function useEditorAudioPreview({
  audioLayers,
  playheadSec,
  isPlaying,
  streamerBaseUrl,
  streamerToken,
}: UseEditorAudioPreviewParams) {
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<Map<string, AudioNodeEntry>>(new Map());
  const stateRef = useRef({ audioLayers, playheadSec, isPlaying });
  stateRef.current = { audioLayers, playheadSec, isPlaying };

  useEffect(() => {
    const validLayers = audioLayers.filter((l) => !l.isMissing && Boolean(l.filePath));
    const validIds = new Set(validLayers.map((l) => l.id));

    for (const [id, entry] of nodesRef.current.entries()) {
      const matched = validLayers.find((l) => l.id === id);
      const nextKey = matched
        ? `${streamerBaseUrl}|${streamerToken}|${matched.filePath}`
        : "";
      if (!matched || entry.key !== nextKey) {
        entry.el.pause();
        entry.el.src = "";
        try {
          entry.source.disconnect();
          entry.gain.disconnect();
        } catch {
          // Ignore disconnect errors on torn-down nodes.
        }
        nodesRef.current.delete(id);
      }
    }

    if (validLayers.length === 0) {
      return;
    }

    if (!ctxRef.current && typeof AudioContext !== "undefined") {
      ctxRef.current = new AudioContext();
    }
    const ctx = ctxRef.current;
    if (!ctx) return;

    for (const layer of validLayers) {
      const srcUrl = getLocalAudioStreamUrl(streamerBaseUrl, streamerToken, layer.filePath);
      if (!srcUrl) continue;
      const key = `${streamerBaseUrl}|${streamerToken}|${layer.filePath}`;
      if (nodesRef.current.has(layer.id)) continue;

      const el = new Audio();
      el.crossOrigin = "anonymous";
      el.preload = "auto";
      el.playbackRate = 1;
      el.src = srcUrl;

      const source = ctx.createMediaElementSource(el);
      const gain = ctx.createGain();
      gain.gain.value = layer.muted
        ? 0
        : Math.min(2, Math.max(0, layer.volume / 100));
      source.connect(gain);
      gain.connect(ctx.destination);

      nodesRef.current.set(layer.id, { key, el, source, gain });
    }

    return () => {
      for (const id of Array.from(nodesRef.current.keys())) {
        if (!validIds.has(id)) {
          const entry = nodesRef.current.get(id);
          if (entry) {
            entry.el.pause();
            entry.el.src = "";
            nodesRef.current.delete(id);
          }
        }
      }
    };
  }, [audioLayers, streamerBaseUrl, streamerToken]);

  useEffect(() => {
    const syncAll = () => {
      const { audioLayers: layers, playheadSec: head, isPlaying: playing } = stateRef.current;
      const ctx = ctxRef.current;
      const hidden = typeof document !== "undefined" && document.hidden;

      for (const layer of layers) {
        const entry = nodesRef.current.get(layer.id);
        if (!entry) continue;

        const { el, gain } = entry;
        el.playbackRate = 1;
        gain.gain.value = layer.muted
          ? 0
          : Math.min(2, Math.max(0, layer.volume / 100));

        const activeDur = Math.max(
          EDITOR_MIN_AUDIO_TRIM_SEC,
          layer.trimEndSec - layer.trimStartSec
        );
        const start = layer.timelineOffsetSec;
        const end = start + activeDur;
        const inRange = head >= start && head < end;

        if (!inRange) {
          if (!el.paused) el.pause();
          continue;
        }

        const targetSec = layer.trimStartSec + (head - start);

        if (playing && !hidden) {
          if (layer.muted || layer.volume <= 0) {
            if (!el.paused) el.pause();
            continue;
          }
          if (Math.abs(el.currentTime - targetSec) > 0.18 && el.readyState >= 1) {
            el.currentTime = targetSec;
          }
          if (ctx?.state === "suspended") {
            ctx.resume().catch(() => {});
          }
          if (el.paused) {
            el.play().catch(() => {});
          }
        } else {
          if (!el.paused) el.pause();
          if (Math.abs(el.currentTime - targetSec) > 0.08 && el.readyState >= 1) {
            el.currentTime = targetSec;
          }
        }
      }
    };

    syncAll();
    document.addEventListener("visibilitychange", syncAll);
    return () => document.removeEventListener("visibilitychange", syncAll);
  }, [audioLayers, playheadSec, isPlaying]);

  useEffect(() => {
    const nodes = nodesRef.current;
    return () => {
      for (const entry of nodes.values()) {
        entry.el.pause();
        entry.el.src = "";
        try {
          entry.source.disconnect();
          entry.gain.disconnect();
        } catch {
          // Ignore disconnect errors on unmount.
        }
      }
      nodes.clear();
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
    };
  }, []);
}
