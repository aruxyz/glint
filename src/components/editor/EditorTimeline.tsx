import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronDown,
  Film,
  GripVertical,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Scissors,
  SkipBack,
  SkipForward,
  Trash2,
  Type,
  Undo2,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  getLocalAudioWaveformUrl,
  getThumbStreamUrl,
  getWaveformUrl,
} from "../../lib/api";
import {
  fetchWaveformCached,
  getCachedWaveform,
  sliceAndResamplePeaks,
} from "../../lib/waveform";
import {
  EDITOR_MIN_AUDIO_TRIM_SEC,
  EDITOR_MIN_TRIM_SEC,
  getMaxCrossfadeSec,
  getMaxFadeInSec,
  getMaxFadeOutSec,
  getSegmentEffectiveDuration,
  MIN_TRANSITION_SEC,
  roundTransitionDuration,
  type TimelineLayout,
} from "../../lib/editor";
import { formatTimecode } from "../../lib/format";
import type { EditorAudioLayer, EditorSegment } from "../../lib/types";

interface EditorTimelineProps {
  layout: TimelineLayout;
  audioLayers: EditorAudioLayer[];
  selectedAudioLayerId: string | null;
  playheadSec: number;
  isPlaying: boolean;
  selectedSegmentIds: string[];
  primarySelectedSegmentId: string | null;
  activeSegmentTitle: string | null;
  hasPrevSegment: boolean;
  hasNextSegment: boolean;
  canSplit: boolean;
  canUndo: boolean;
  canRedo: boolean;
  zoom: number;
  timelineHeightPx?: number | null;
  isResizingHeight?: boolean;
  streamerBaseUrl: string;
  streamerToken: string;
  isNarrow: boolean;
  isMedium: boolean;
  onTogglePlay: () => void;
  onPrevSegment: () => void;
  onNextSegment: () => void;
  onSplitAtPlayhead: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onChangeZoom: (nextZoom: number) => void;
  onScrubTimeline: (timelineSec: number, segmentId?: string) => void;
  onSelectSegment: (segmentId: string, mode?: "single" | "toggle" | "range") => void;
  onUpdateSegment: (
    segmentId: string,
    patch: Partial<EditorSegment>,
    options?: { recordHistory?: boolean }
  ) => void;
  onAddAudioLayer: () => void;
  onSelectAudioLayer: (layerId: string | null) => void;
  onUpdateAudioLayer: (
    layerId: string,
    patch: Partial<EditorAudioLayer>,
    options?: { recordHistory?: boolean }
  ) => void;
  onRemoveAudioLayer: (layerId: string) => void;
  onLocateAudioLayer: (layerId: string) => void;
  onBeginTrimTransaction: () => void;
  onCommitTrimTransaction: () => void;
  onReorderSegment: (fromIndex: number, toIndex: number) => void;
  onToggleTransition?: (segmentId: string) => void;
}

const RULER_INTERVAL_CANDIDATES = [0.5, 1, 2, 5, 10, 15, 30, 60] as const;

// Future layer types are explicitly disabled until their editors ship.
const TIMELINE_LAYER_MENU_ITEMS = [
  {
    id: "zoom-pan",
    label: "Zoom / Pan",
    subtitle: "Keyframe camera motion",
    icon: ZoomIn,
    disabled: true, // TODO: implement video transform keyframe track
  },
  {
    id: "text-overlay",
    label: "Text Overlay",
    subtitle: "Timed captions and titles",
    icon: Type,
    disabled: true, // TODO: implement text overlay track
  },
] as const;

interface TrimDragState {
  segmentId: string;
  edge: "start" | "end";
  startX: number;
  origStartSec: number;
  origEndSec: number;
  clipDur: number;
  speed: number;
  frozenPxPerSec: number;
  currentX: number;
}

interface ReorderDragState {
  fromIndex: number;
  targetIndex: number;
  startX: number;
  deltaX: number;
  active: boolean;
}

interface MusicDragState {
  layerId: string;
  mode: "move" | "trim-start" | "trim-end";
  startX: number;
  origOffsetSec: number;
  origTrimStartSec: number;
  origTrimEndSec: number;
  durationSec: number;
  frozenPxPerSec: number;
}

interface TransitionDragState {
  targetSegmentId: string;
  blockIndex: number;
  field: "in" | "out";
  handleSide: "left" | "right";
  kind: "fade_in" | "crossfade" | "fade_out";
  startX: number;
  currentX: number;
  origDurationSec: number;
  currentDurationSec: number;
  maxDurationSec: number;
  frozenPxPerSec: number;
}

function formatRulerTimecode(seconds: number, intervalSec: number): string {
  const safe = Math.max(0, seconds);
  if (intervalSec < 1) {
    const mins = Math.floor(safe / 60);
    const secs = (safe % 60).toFixed(1).padStart(4, "0");
    return `${mins}:${secs}`;
  }
  const totalSec = Math.round(safe);
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function EditorTimeline({
  layout,
  audioLayers,
  selectedAudioLayerId,
  playheadSec,
  isPlaying,
  selectedSegmentIds,
  primarySelectedSegmentId,
  activeSegmentTitle,
  hasPrevSegment,
  hasNextSegment,
  canSplit,
  canUndo,
  canRedo,
  zoom,
  timelineHeightPx,
  isResizingHeight = false,
  streamerBaseUrl,
  streamerToken,
  isNarrow,
  isMedium,
  onTogglePlay,
  onPrevSegment,
  onNextSegment,
  onSplitAtPlayhead,
  onUndo,
  onRedo,
  onChangeZoom,
  onScrubTimeline,
  onSelectSegment,
  onUpdateSegment,
  onAddAudioLayer,
  onSelectAudioLayer,
  onUpdateAudioLayer,
  onRemoveAudioLayer,
  onLocateAudioLayer,
  onBeginTrimTransaction,
  onCommitTrimTransaction,
  onReorderSegment,
}: EditorTimelineProps) {
  const trackContainerRef = useRef<HTMLDivElement>(null);
  const addLayerMenuRef = useRef<HTMLDivElement>(null);
  const [trackWidth, setTrackWidth] = useState(720);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [addLayerOpen, setAddLayerOpen] = useState(false);

  const [reorderDrag, setReorderDrag] = useState<ReorderDragState | null>(null);
  const [trimDrag, setTrimDrag] = useState<TrimDragState | null>(null);
  const [musicDrag, setMusicDrag] = useState<MusicDragState | null>(null);
  const [transitionDrag, setTransitionDrag] = useState<TransitionDragState | null>(null);
  const [rulerScrubbing, setRulerScrubbing] = useState(false);
  const [waveformMap, setWaveformMap] = useState<Record<string, number[]>>({});

  const reorderDragRef = useRef(reorderDrag);
  reorderDragRef.current = reorderDrag;
  const trimDragRef = useRef(trimDrag);
  trimDragRef.current = trimDrag;
  const musicDragRef = useRef(musicDrag);
  musicDragRef.current = musicDrag;
  const transitionDragRef = useRef(transitionDrag);
  transitionDragRef.current = transitionDrag;

  const gutterWidthPx = isNarrow ? 112 : 136;

  useEffect(() => {
    const el = trackContainerRef.current;
    if (!el) return;
    if (el.clientWidth > 100) {
      setTrackWidth(el.clientWidth);
    }
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 100) setTrackWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!addLayerOpen) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!addLayerMenuRef.current?.contains(e.target as Node)) {
        setAddLayerOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setAddLayerOpen(false);
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [addLayerOpen]);

  const timelineScale = useMemo(() => {
    const videoDurationSec = layout.totalDurationSec;
    const maxAudioEndSec = audioLayers.reduce((max, layer) => {
      const activeDur = Math.max(
        EDITOR_MIN_AUDIO_TRIM_SEC,
        layer.trimEndSec - layer.trimStartSec
      );
      return Math.max(max, layer.timelineOffsetSec + activeDur);
    }, 0);
    const timelineSpanSec = Math.max(videoDurationSec, maxAudioEndSec, 1);
    const innerTrackWidth = Math.max(200, trackWidth - gutterWidthPx - 16);
    const contentWidthPx = Math.max(innerTrackWidth, Math.round(innerTrackWidth * zoom));
    const pxPerSec = contentWidthPx / timelineSpanSec;
    return {
      videoDurationSec,
      timelineSpanSec,
      contentWidthPx,
      pxPerSec,
    };
  }, [audioLayers, gutterWidthPx, layout.totalDurationSec, trackWidth, zoom]);

  const activePxPerSec = trimDrag
    ? trimDrag.frozenPxPerSec
    : musicDrag
      ? musicDrag.frozenPxPerSec
      : transitionDrag
        ? transitionDrag.frozenPxPerSec
        : timelineScale.pxPerSec;

  const videoWaveRequests = useMemo(() => {
    const entries: Array<{ key: string; url: string }> = [];
    if (!streamerBaseUrl) return entries;
    const seen = new Set<string>();
    for (const item of layout.items) {
      const seg = item.segment;
      const firstUnmuted = seg.audioMix.find((m) => !m.muted);
      const trackOrder = firstUnmuted?.trackOrder ?? 0;
      const key = `${seg.clipId}:${trackOrder}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({
        key,
        url: getWaveformUrl(streamerBaseUrl, streamerToken, seg.clipId, trackOrder),
      });
    }
    return entries;
  }, [layout.items, streamerBaseUrl, streamerToken]);

  const audioWaveRequests = useMemo(() => {
    const entries: Array<{ key: string; url: string }> = [];
    if (!streamerBaseUrl) return entries;
    const seen = new Set<string>();
    for (const layer of audioLayers) {
      if (layer.isMissing || !layer.filePath) continue;
      const url = getLocalAudioWaveformUrl(streamerBaseUrl, streamerToken, layer.filePath);
      if (!url) continue;
      const key = `local:${layer.filePath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      entries.push({ key, url });
    }
    return entries;
  }, [audioLayers, streamerBaseUrl, streamerToken]);

  useEffect(() => {
    const allRequests = [...videoWaveRequests, ...audioWaveRequests];
    if (allRequests.length === 0) return;

    const controller = new AbortController();
    const initialHits: Record<string, number[]> = {};
    const pending: Array<{ key: string; url: string }> = [];

    for (const req of allRequests) {
      const cached = getCachedWaveform(req.key);
      if (cached) {
        initialHits[req.key] = cached;
      } else {
        pending.push(req);
      }
    }

    if (Object.keys(initialHits).length > 0) {
      setWaveformMap((prev) => ({ ...prev, ...initialHits }));
    }

    if (pending.length === 0) return () => controller.abort();

    Promise.allSettled(
      pending.map(async (req) => {
        const peaks = await fetchWaveformCached(req.url, req.key, controller.signal);
        return { key: req.key, peaks };
      })
    ).then((results) => {
      if (controller.signal.aborted) return;
      const next: Record<string, number[]> = {};
      for (const res of results) {
        if (res.status === "fulfilled" && res.value.peaks.length > 0) {
          next[res.value.key] = res.value.peaks;
        }
      }
      if (Object.keys(next).length > 0) {
        setWaveformMap((prev) => ({ ...prev, ...next }));
      }
    });

    return () => controller.abort();
  }, [audioWaveRequests, videoWaveRequests]);

  const blockLayouts = useMemo(() => {
    const minBlockVisualPx = audioLayers.length === 0 ? 28 : 14;
    const blocks = layout.items.map((item) => {
      const leftPx = Math.round(item.timelineStart * activePxPerSec);
      const rawWidth = Math.round(item.effectiveDur * activePxPerSec);
      return {
        id: item.segment.id,
        index: item.index,
        segment: item.segment,
        timelineStart: item.timelineStart,
        timelineEnd: item.timelineEnd,
        effectiveDur: item.effectiveDur,
        leftPx,
        widthPx: Math.max(minBlockVisualPx, rawWidth),
      };
    });
    const lastRight = blocks.reduce((max, b) => Math.max(max, b.leftPx + b.widthPx), 0);
    return {
      blocks,
      contentWidthPx: Math.max(timelineScale.contentWidthPx, lastRight),
    };
  }, [activePxPerSec, audioLayers.length, layout.items, timelineScale.contentWidthPx]);

  const rulerTicks = useMemo(() => {
    const pxPerSec = activePxPerSec;
    const interval =
      RULER_INTERVAL_CANDIDATES.find((cand) => cand * pxPerSec >= 72) ??
      RULER_INTERVAL_CANDIDATES[RULER_INTERVAL_CANDIDATES.length - 1];
    const span = timelineScale.timelineSpanSec;
    const ticks: Array<{
      sec: number;
      xPx: number;
      major: boolean;
      label?: string;
      align?: "left" | "right";
    }> = [];
    const halfStep = interval / 2;
    const maxSteps = Math.ceil(span / halfStep);
    const MIN_LABEL_GAP_PX = 16;
    const EST_LABEL_WIDTH_PX = interval < 1 ? 46 : 36;
    let lastLabelEndPx = -Infinity;

    for (let step = 0; step <= maxSteps; step += 1) {
      const sec = Number((step * halfStep).toFixed(3));
      if (sec > span + 0.001) break;
      const xPx = sec * pxPerSec;
      const major = step % 2 === 0;
      let label: string | undefined;
      let align: "left" | "right" | undefined;

      if (major) {
        const text = formatRulerTimecode(sec, interval);
        const labelStart = xPx + 4;
        const labelEnd = labelStart + EST_LABEL_WIDTH_PX;

        if (
          labelEnd <= blockLayouts.contentWidthPx - 4 &&
          labelStart >= lastLabelEndPx + MIN_LABEL_GAP_PX
        ) {
          label = text;
          align = "left";
          lastLabelEndPx = labelEnd;
        } else if (labelEnd > blockLayouts.contentWidthPx - 4) {
          const flipStart = xPx - 4 - EST_LABEL_WIDTH_PX;
          if (flipStart >= lastLabelEndPx + MIN_LABEL_GAP_PX) {
            label = text;
            align = "right";
            lastLabelEndPx = xPx - 4;
          }
        }
      }

      ticks.push({
        sec,
        xPx,
        major,
        label,
        align,
      });
    }
    return ticks;
  }, [activePxPerSec, blockLayouts.contentWidthPx, timelineScale.timelineSpanSec]);

  const playheadPx = useMemo(() => {
    const clamped = Math.max(0, Math.min(timelineScale.timelineSpanSec, playheadSec));
    return clamped * activePxPerSec;
  }, [activePxPerSec, playheadSec, timelineScale.timelineSpanSec]);

  // Auto-scroll track horizontally when zoomed > 1x and playhead exits viewport.
  useEffect(() => {
    if (
      zoom <= 1 ||
      trimDragRef.current ||
      reorderDragRef.current?.active ||
      musicDragRef.current ||
      transitionDragRef.current ||
      rulerScrubbing
    ) {
      return;
    }
    const container = trackContainerRef.current;
    if (!container) return;
    const pad = 28;
    const laneVisibleWidth = Math.max(120, container.clientWidth - gutterWidthPx);
    const leftEdge = container.scrollLeft + pad;
    const rightEdge = container.scrollLeft + laneVisibleWidth - pad;
    if (playheadPx < leftEdge) {
      container.scrollLeft = Math.max(0, playheadPx - pad);
    } else if (playheadPx > rightEdge) {
      container.scrollLeft = Math.max(0, playheadPx - laneVisibleWidth + pad);
    }
  }, [gutterWidthPx, playheadPx, rulerScrubbing, zoom]);

  // Ruler scrub lifecycle
  useEffect(() => {
    if (!rulerScrubbing) return;
    const scrubAtClientX = (clientX: number) => {
      const container = trackContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const laneX = clientX - rect.left + container.scrollLeft - gutterWidthPx;
      const maxScrub =
        timelineScale.videoDurationSec > 0
          ? timelineScale.videoDurationSec
          : timelineScale.timelineSpanSec;
      const sec = Math.max(0, Math.min(maxScrub, laneX / Math.max(1, activePxPerSec)));
      onScrubTimeline(sec);
    };
    const onMove = (e: PointerEvent) => scrubAtClientX(e.clientX);
    const onUp = () => setRulerScrubbing(false);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [
    activePxPerSec,
    gutterWidthPx,
    onScrubTimeline,
    rulerScrubbing,
    timelineScale.timelineSpanSec,
    timelineScale.videoDurationSec,
  ]);

  // Video trim handle pointer lifecycle (0ms transition, frozen scale).
  useEffect(() => {
    if (!trimDrag) return;
    const handleMove = (e: PointerEvent) => {
      const active = trimDragRef.current;
      if (!active) return;
      const deltaEffectiveSec = (e.clientX - active.startX) / active.frozenPxPerSec;
      const deltaClipSec = deltaEffectiveSec * active.speed;
      setTrimDrag((prev) => (prev ? { ...prev, currentX: e.clientX } : null));

      if (active.edge === "start") {
        const nextStart = Math.max(
          0,
          Math.min(active.origEndSec - EDITOR_MIN_TRIM_SEC, active.origStartSec + deltaClipSec)
        );
        onUpdateSegment(active.segmentId, { startSec: nextStart }, { recordHistory: false });
        const block = blockLayouts.blocks.find((b) => b.id === active.segmentId);
        if (block) onScrubTimeline(block.timelineStart, active.segmentId);
      } else {
        const nextEnd = Math.min(
          active.clipDur,
          Math.max(active.origStartSec + EDITOR_MIN_TRIM_SEC, active.origEndSec + deltaClipSec)
        );
        onUpdateSegment(active.segmentId, { endSec: nextEnd }, { recordHistory: false });
        const block = blockLayouts.blocks.find((b) => b.id === active.segmentId);
        if (block) {
          const newEffective = (nextEnd - active.origStartSec) / active.speed;
          onScrubTimeline(block.timelineStart + Math.max(0, newEffective - 0.04), active.segmentId);
        }
      }
    };
    const handleUp = () => {
      setTrimDrag(null);
      onCommitTrimTransaction();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [
    Boolean(trimDrag),
    blockLayouts.blocks,
    onCommitTrimTransaction,
    onScrubTimeline,
    onUpdateSegment,
  ]);

  // Music layer drag & trim lifecycle
  useEffect(() => {
    if (!musicDrag) return;
    const handleMove = (e: PointerEvent) => {
      const active = musicDragRef.current;
      if (!active) return;
      const deltaSec = (e.clientX - active.startX) / Math.max(1, active.frozenPxPerSec);

      if (active.mode === "move") {
        let nextOffset = Math.max(0, active.origOffsetSec + deltaSec);
        const snapThresholdSec = 6 / Math.max(1, active.frozenPxPerSec);
        const snapTargets = [0, playheadSec, layout.totalDurationSec].filter((t) => t >= 0);
        for (const target of snapTargets) {
          if (Math.abs(nextOffset - target) <= snapThresholdSec) {
            nextOffset = target;
            break;
          }
        }
        onUpdateAudioLayer(
          active.layerId,
          { timelineOffsetSec: nextOffset },
          { recordHistory: false }
        );
      } else if (active.mode === "trim-start") {
        const maxTrimStart = active.origTrimEndSec - EDITOR_MIN_AUDIO_TRIM_SEC;
        const minAllowedDelta = -active.origOffsetSec;
        const clampedStart = Math.max(
          0,
          Math.min(maxTrimStart, active.origTrimStartSec + Math.max(minAllowedDelta, deltaSec))
        );
        const appliedDelta = clampedStart - active.origTrimStartSec;
        const nextOffset = Math.max(0, active.origOffsetSec + appliedDelta);
        onUpdateAudioLayer(
          active.layerId,
          { trimStartSec: clampedStart, timelineOffsetSec: nextOffset },
          { recordHistory: false }
        );
      } else {
        const nextEnd = Math.min(
          active.durationSec,
          Math.max(active.origTrimStartSec + EDITOR_MIN_AUDIO_TRIM_SEC, active.origTrimEndSec + deltaSec)
        );
        onUpdateAudioLayer(
          active.layerId,
          { trimEndSec: nextEnd },
          { recordHistory: false }
        );
      }
    };
    const handleUp = () => {
      setMusicDrag(null);
      onCommitTrimTransaction();
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [
    Boolean(musicDrag),
    layout.totalDurationSec,
    onCommitTrimTransaction,
    onUpdateAudioLayer,
    playheadSec,
  ]);

  // Transition handle drag lifecycle (0ms, frozenPxPerSec)
  useEffect(() => {
    if (!transitionDrag) return;
    const handleMove = (e: PointerEvent) => {
      const active = transitionDragRef.current;
      if (!active) return;
      const rawDeltaSec =
        active.handleSide === "left"
          ? (e.clientX - active.startX) / Math.max(1, active.frozenPxPerSec)
          : (active.startX - e.clientX) / Math.max(1, active.frozenPxPerSec);
      const clampedRaw = Math.max(
        0,
        Math.min(active.maxDurationSec, active.origDurationSec + rawDeltaSec)
      );
      const nextDur = roundTransitionDuration(clampedRaw, e.shiftKey);

      setTransitionDrag((prev) =>
        prev
          ? {
              ...prev,
              currentX: e.clientX,
              currentDurationSec: nextDur,
            }
          : null
      );

      if (active.field === "in") {
        const nextType =
          nextDur >= MIN_TRANSITION_SEC
            ? active.kind === "fade_in"
              ? "fade"
              : "crossfade"
            : "cut";
        onUpdateSegment(
          active.targetSegmentId,
          {
            transitionIn: nextType,
            transitionInDurationSec: nextDur,
          },
          { recordHistory: false }
        );
      } else {
        onUpdateSegment(
          active.targetSegmentId,
          {
            transitionOut: nextDur >= MIN_TRANSITION_SEC ? "fade" : "cut",
            transitionOutDurationSec: nextDur,
          },
          { recordHistory: false }
        );
      }
    };

    const handleUp = () => {
      setTransitionDrag(null);
      onCommitTrimTransaction();
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [Boolean(transitionDrag), onCommitTrimTransaction, onUpdateSegment]);

  // Video block drag-and-drop reorder lifecycle with sibling displacement.
  useEffect(() => {
    if (!reorderDrag) return;
    const handleMove = (e: PointerEvent) => {
      const current = reorderDragRef.current;
      if (!current) return;
      const dx = e.clientX - current.startX;
      const container = trackContainerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const relX = e.clientX - rect.left + container.scrollLeft - gutterWidthPx;

      let target = current.fromIndex;
      let minDist = Infinity;
      for (let i = 0; i < blockLayouts.blocks.length; i += 1) {
        const b = blockLayouts.blocks[i];
        const mid = b.leftPx + b.widthPx / 2;
        const dist = Math.abs(relX - mid);
        if (dist < minDist) {
          minDist = dist;
          target = i;
        }
      }

      setReorderDrag((prev) =>
        prev
          ? {
              ...prev,
              active: prev.active || Math.abs(dx) > 6,
              deltaX: dx,
              targetIndex: target,
            }
          : null
      );
    };

    const handleUp = () => {
      const current = reorderDragRef.current;
      if (current && current.active && current.targetIndex !== current.fromIndex) {
        onReorderSegment(current.fromIndex, current.targetIndex);
      }
      setReorderDrag(null);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [Boolean(reorderDrag), blockLayouts.blocks, gutterWidthPx, onReorderSegment]);

  const handleTrimPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    edge: "start" | "end",
    block: (typeof blockLayouts.blocks)[number]
  ) => {
    e.stopPropagation();
    e.preventDefault();
    onSelectSegment(block.id, "single");
    onBeginTrimTransaction();

    const seg = block.segment;
    const clipDur = Math.max(EDITOR_MIN_TRIM_SEC, seg.clip.durationSec || EDITOR_MIN_TRIM_SEC);
    setTrimDrag({
      segmentId: seg.id,
      edge,
      startX: e.clientX,
      currentX: e.clientX,
      origStartSec: seg.startSec,
      origEndSec: seg.endSec,
      clipDur,
      speed: seg.speed,
      frozenPxPerSec: Math.max(1, timelineScale.pxPerSec),
    });
  };

  const handleBlockPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    idx: number,
    block: (typeof blockLayouts.blocks)[number]
  ) => {
    const targetEl = e.target as HTMLElement;
    if (
      targetEl.closest("button") ||
      targetEl.closest("[data-trim-edge]") ||
      targetEl.closest("[data-transition-edge]")
    ) {
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      onSelectSegment(block.id, "toggle");
      return;
    }
    if (e.shiftKey) {
      onSelectSegment(block.id, "range");
      return;
    }

    const rect = e.currentTarget.getBoundingClientRect();
    const clickRatio = Math.max(
      0,
      Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
    );
    const targetSec =
      block.timelineStart + clickRatio * (block.timelineEnd - block.timelineStart);

    onSelectSegment(block.id, "single");
    onScrubTimeline(targetSec, block.id);

    setReorderDrag({
      fromIndex: idx,
      targetIndex: idx,
      startX: e.clientX,
      deltaX: 0,
      active: false,
    });
  };

  const handleMusicPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    layer: EditorAudioLayer,
    mode: MusicDragState["mode"]
  ) => {
    if (layer.isMissing) return;
    const targetEl = e.target as HTMLElement;
    if (mode === "move" && (targetEl.closest("button") || targetEl.closest("[data-music-trim-edge]"))) {
      return;
    }
    e.stopPropagation();
    e.preventDefault();
    onSelectAudioLayer(layer.id);
    onBeginTrimTransaction();
    setMusicDrag({
      layerId: layer.id,
      mode,
      startX: e.clientX,
      origOffsetSec: layer.timelineOffsetSec,
      origTrimStartSec: layer.trimStartSec,
      origTrimEndSec: layer.trimEndSec,
      durationSec: Math.max(EDITOR_MIN_AUDIO_TRIM_SEC, layer.durationSec),
      frozenPxPerSec: Math.max(1, timelineScale.pxPerSec),
    });
  };

  const handleTransitionPointerDown = (
    e: ReactPointerEvent<HTMLDivElement>,
    params: {
      blockIndex: number;
      targetSegmentId: string;
      field: "in" | "out";
      handleSide: "left" | "right";
      kind: "fade_in" | "crossfade" | "fade_out";
      origDurationSec: number;
      maxDurationSec: number;
      selectSegmentId: string;
    }
  ) => {
    const targetEl = e.target as HTMLElement;
    if (targetEl.closest("button")) return;
    e.stopPropagation();
    e.preventDefault();
    onSelectSegment(params.selectSegmentId, "single");
    onBeginTrimTransaction();
    setTransitionDrag({
      targetSegmentId: params.targetSegmentId,
      blockIndex: params.blockIndex,
      field: params.field,
      handleSide: params.handleSide,
      kind: params.kind,
      startX: e.clientX,
      currentX: e.clientX,
      origDurationSec: params.origDurationSec,
      currentDurationSec: params.origDurationSec,
      maxDurationSec: params.maxDurationSec,
      frozenPxPerSec: Math.max(1, timelineScale.pxPerSec),
    });
  };

  const resetTransitionToCut = (targetSegmentId: string, field: "in" | "out") => {
    if (field === "in") {
      onUpdateSegment(targetSegmentId, {
        transitionIn: "cut",
        transitionInDurationSec: 0,
      });
    } else {
      onUpdateSegment(targetSegmentId, {
        transitionOut: "cut",
        transitionOutDurationSec: 0,
      });
    }
  };

  const controlSize = isNarrow ? "h-11 w-11" : "h-8 w-8";
  const smallBtnSize = isNarrow ? "h-11 w-11" : "h-7 w-7";
  const isTrimming = trimDrag !== null || transitionDrag !== null;
  const handleWidthClass = isNarrow ? "w-[14px]" : "w-[10px]";

  const activeAudioLayer = useMemo(() => {
    if (audioLayers.length === 0) return null;
    return audioLayers.find((l) => l.id === selectedAudioLayerId) ?? audioLayers[0];
  }, [audioLayers, selectedAudioLayerId]);

  const transitionTooltip = useMemo(() => {
    if (!transitionDrag) return null;
    const block = blockLayouts.blocks[transitionDrag.blockIndex];
    if (!block) return null;
    const dur = transitionDrag.currentDurationSec;
    const durPx = dur * transitionDrag.frozenPxPerSec;
    const anchorX =
      transitionDrag.handleSide === "left"
        ? block.leftPx + durPx
        : block.leftPx + block.widthPx - durPx;
    const anchorLeft = gutterWidthPx + anchorX - scrollLeft;
    const clampedLeft = Math.max(6, Math.min(Math.max(40, trackWidth - 130), anchorLeft));
    const prefix =
      dur < MIN_TRANSITION_SEC
        ? "Cut"
        : transitionDrag.kind === "fade_in"
          ? "Fade In"
          : transitionDrag.kind === "fade_out"
            ? "Fade Out"
            : "Crossfade";
    const text =
      dur < MIN_TRANSITION_SEC ? "Cut (0.00s)" : `${prefix} ${dur.toFixed(2)}s`;
    return { text, leftPx: clampedLeft };
  }, [blockLayouts.blocks, gutterWidthPx, scrollLeft, trackWidth, transitionDrag]);

  const trimTooltip = useMemo(() => {
    if (!trimDrag) return null;
    const block = blockLayouts.blocks.find((b) => b.id === trimDrag.segmentId);
    if (!block) return null;
    const seg = block.segment;
    const eff = getSegmentEffectiveDuration(seg);
    const edgeTime = trimDrag.edge === "start" ? seg.startSec : seg.endSec;
    const anchorLeft =
      gutterWidthPx +
      (trimDrag.edge === "start" ? block.leftPx : block.leftPx + block.widthPx) -
      scrollLeft;
    const clampedLeft = Math.max(6, Math.min(Math.max(40, trackWidth - 110), anchorLeft));
    return {
      text: `${eff.toFixed(2)}s (${formatTimecode(edgeTime)})`,
      leftPx: clampedLeft,
    };
  }, [blockLayouts.blocks, gutterWidthPx, scrollLeft, trackWidth, trimDrag]);

  const draggedBlockWidth =
    reorderDrag?.active && blockLayouts.blocks[reorderDrag.fromIndex]
      ? blockLayouts.blocks[reorderDrag.fromIndex].widthPx
      : 0;

  return (
    <section
      data-testid="editor-timeline"
      aria-label="Editor timeline"
      style={
        !isNarrow && timelineHeightPx
          ? {
              height: `${timelineHeightPx}px`,
              transition: isResizingHeight ? "none" : undefined,
            }
          : undefined
      }
      className="glass-dock relative flex shrink-0 flex-col gap-2 rounded-[14px] p-3"
    >
      {/* 3-Zone Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Left Zone: + Add Layer, Split, Undo, Redo */}
        <div className="flex flex-wrap items-center gap-1.5">
          <div ref={addLayerMenuRef} className="relative">
            <button
              type="button"
              data-testid="editor-add-layer-btn"
              onClick={() => setAddLayerOpen((prev) => !prev)}
              aria-haspopup="menu"
              aria-expanded={addLayerOpen}
              className={`btn-secondary ${isNarrow ? "min-h-[44px] px-3" : "h-8 px-2.5"} gap-1.5 text-[12px] font-medium`}
            >
              <Plus className="h-3.5 w-3.5 text-[var(--accent-primary)]" aria-hidden="true" />
              <span>Add Layer</span>
              <ChevronDown
                className={`h-3.5 w-3.5 text-[var(--text-muted)] transition-transform duration-150 ${
                  addLayerOpen ? "rotate-180" : ""
                }`}
                aria-hidden="true"
              />
            </button>

            {addLayerOpen && (
              <div
                role="menu"
                aria-label="Add timeline layer"
                data-testid="editor-add-layer-menu"
                className="absolute top-full left-0 z-50 mt-1.5 min-w-[232px] rounded-[12px] border border-[var(--border-hairline)] bg-white p-1.5 shadow-[0_12px_32px_rgba(15,23,42,0.14)]"
              >
                <button
                  type="button"
                  role="menuitem"
                  data-testid="editor-add-song-item"
                  onClick={() => {
                    setAddLayerOpen(false);
                    onAddAudioLayer();
                  }}
                  className="flex w-full items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-left transition-colors duration-[120ms] hover:bg-slate-900/[0.06]"
                >
                  <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-violet-600/12 text-[#6d28d9]">
                    <Music className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
                      Add Song / Music
                    </span>
                    <span className="block text-[10px] text-[var(--text-muted)]">
                      MP3, WAV, AAC, M4A, FLAC
                    </span>
                  </span>
                </button>

                <div className="my-1 h-px bg-[var(--border-hairline)]" />

                {TIMELINE_LAYER_MENU_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitem"
                      disabled
                      aria-disabled="true"
                      className="flex w-full items-center gap-2.5 rounded-[8px] bg-slate-50/70 px-2.5 py-1.5 text-left"
                    >
                      <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] bg-slate-200/75 text-slate-600">
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-medium text-slate-600">
                          {item.label}
                        </span>
                        <span className="block text-[10px] text-slate-500">
                          {item.subtitle}
                        </span>
                      </span>
                      <span className="rounded-full bg-slate-200/85 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-700">
                        Soon
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <span aria-hidden="true" className="mx-0.5 h-4 w-px bg-[var(--border-hairline)]" />

          <button
            type="button"
            data-testid="editor-split-btn"
            onClick={onSplitAtPlayhead}
            disabled={!canSplit}
            aria-label="Split segment at playhead (S)"
            title={
              canSplit
                ? "Split segment at playhead (S)"
                : "Move playhead inside a segment (at least 0.25s from edges) to split"
            }
            className={`btn-secondary ${isNarrow ? "min-h-[44px] px-3" : "h-8 px-2.5"} gap-1.5 text-[12px]`}
          >
            <Scissors className="h-3.5 w-3.5" aria-hidden="true" />
            <span>Split</span>
          </button>

          <button
            type="button"
            data-testid="editor-undo-btn"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Undo (Ctrl+Z)"
            title="Undo (Ctrl+Z)"
            className={`btn-secondary ${controlSize} p-0`}
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            data-testid="editor-redo-btn"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Redo (Ctrl+Shift+Z)"
            title="Redo (Ctrl+Shift+Z)"
            className={`btn-secondary ${controlSize} p-0`}
          >
            <Redo2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>

        {/* Center Zone: Timecode + Transport */}
        <div className="flex items-center gap-1.5">
          {activeSegmentTitle && (
            <span className="mr-1 hidden max-w-[140px] truncate text-[12px] font-medium text-[var(--text-secondary)] xl:inline">
              {activeSegmentTitle}
            </span>
          )}
          <span
            data-testid="editor-timeline-timecode"
            className="font-mono-tabular min-w-[44px] text-right text-[12px] font-semibold text-[var(--text-primary)]"
          >
            {formatTimecode(playheadSec)}
          </span>

          <button
            type="button"
            onClick={onPrevSegment}
            disabled={!hasPrevSegment}
            aria-label="Previous segment ([)"
            title="Previous segment ([)"
            className={`btn-secondary ${controlSize} p-0`}
          >
            <SkipBack className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            onClick={onTogglePlay}
            disabled={layout.items.length === 0}
            aria-label={isPlaying ? "Pause timeline (Space)" : "Play timeline (Space)"}
            title="Play / Pause (Space)"
            className={`btn-primary ${controlSize} rounded-full p-0`}
          >
            {isPlaying ? (
              <Pause className="h-4 w-4 fill-current" aria-hidden="true" />
            ) : (
              <Play className="h-4 w-4 fill-current" aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={onNextSegment}
            disabled={!hasNextSegment}
            aria-label="Next segment (])"
            title="Next segment (])"
            className={`btn-secondary ${controlSize} p-0`}
          >
            <SkipForward className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <span className="font-mono-tabular min-w-[44px] text-[12px] text-[var(--text-muted)]">
            {formatTimecode(layout.totalDurationSec)}
          </span>
        </div>

        {/* Right Zone: Timeline Zoom */}
        <div data-testid="editor-zoom-group" className="ml-auto flex items-center gap-1">
          <button
            type="button"
            data-testid="editor-zoom-out-btn"
            onClick={() => onChangeZoom(Math.max(1, Number((zoom - 0.25).toFixed(2))))}
            disabled={zoom <= 1}
            aria-label="Zoom out timeline"
            title="Zoom out"
            className={`btn-icon flex ${smallBtnSize} items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)] disabled:opacity-35`}
          >
            <ZoomOut className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          {!isNarrow && !isMedium && (
            <input
              type="range"
              data-testid="editor-zoom-slider"
              min={1}
              max={4}
              step={0.25}
              value={zoom}
              onChange={(e) => onChangeZoom(Number(e.target.value))}
              aria-label="Timeline zoom"
              className="h-1.5 w-[72px] accent-[var(--accent-primary)]"
            />
          )}

          <button
            type="button"
            data-testid="editor-zoom-in-btn"
            onClick={() => onChangeZoom(Math.min(4, Number((zoom + 0.25).toFixed(2))))}
            disabled={zoom >= 4}
            aria-label="Zoom in timeline"
            title="Zoom in"
            className={`btn-icon flex ${smallBtnSize} items-center justify-center rounded-[6px] text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)] disabled:opacity-35`}
          >
            <ZoomIn className="h-3.5 w-3.5" aria-hidden="true" />
          </button>

          <button
            type="button"
            data-testid="editor-zoom-reset-btn"
            onClick={() => onChangeZoom(1)}
            title="Reset zoom to 100%"
            aria-label={`Timeline zoom ${Math.round(zoom * 100)}%, click to reset`}
            className={`nav-item-press font-mono-tabular rounded px-1.5 text-[11px] font-medium text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)] ${
              isNarrow ? "min-h-[44px]" : "h-6"
            }`}
          >
            {Math.round(zoom * 100)}%
          </button>
        </div>
      </div>

      {/* Multi-Track Scrollable Timeline Area */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        {trimTooltip && (
          <div
            data-testid="editor-trim-tooltip"
            style={{ left: `${trimTooltip.leftPx}px` }}
            className="font-mono-tabular pointer-events-none absolute -top-7 z-40 -translate-x-1/2 whitespace-nowrap rounded-[5px] bg-[var(--surface-scrim-dark)] px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm"
          >
            {trimTooltip.text}
          </div>
        )}
        {transitionTooltip && (
          <div
            data-testid="editor-transition-tooltip"
            style={{ left: `${transitionTooltip.leftPx}px` }}
            className="font-mono-tabular pointer-events-none absolute -top-7 z-40 -translate-x-1/2 whitespace-nowrap rounded-[5px] bg-[var(--surface-scrim-dark)] px-1.5 py-0.5 text-[10px] font-medium text-white shadow-sm"
          >
            {transitionTooltip.text}
          </div>
        )}

        <div
          ref={trackContainerRef}
          data-testid="editor-timeline-track"
          onScroll={(e) => setScrollLeft(e.currentTarget.scrollLeft)}
          className="glint-scroll relative min-h-[76px] flex-1 overflow-x-auto overflow-y-hidden rounded-[10px] border border-[var(--border-hairline)] bg-slate-900/[0.06]"
        >
          {blockLayouts.blocks.length === 0 && audioLayers.length === 0 ? (
            <div className="flex h-full items-center justify-center px-4 text-[12px] text-[var(--text-muted)]">
              Timeline is empty. Send clips from Player, add from Library, or click Add Layer.
            </div>
          ) : (
            <div
              className="relative flex min-h-full flex-col select-none"
              style={{ width: `${gutterWidthPx + blockLayouts.contentWidthPx + 12}px` }}
            >
              {/* Row 0: Time Ruler */}
              <div className="flex h-6 shrink-0 items-stretch border-b border-[var(--border-hairline)] bg-white/45">
                <div
                  style={{ width: `${gutterWidthPx}px` }}
                  className="sticky left-0 z-20 flex shrink-0 items-center border-r border-[var(--border-hairline)] bg-[rgba(248,250,252,0.92)] px-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]"
                >
                  Time
                </div>
                <div
                  data-testid="editor-time-ruler"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    const container = trackContainerRef.current;
                    if (container) {
                      const rect = container.getBoundingClientRect();
                      const laneX = e.clientX - rect.left + container.scrollLeft - gutterWidthPx;
                      const maxScrub =
                        timelineScale.videoDurationSec > 0
                          ? timelineScale.videoDurationSec
                          : timelineScale.timelineSpanSec;
                      const sec = Math.max(0, Math.min(maxScrub, laneX / Math.max(1, activePxPerSec)));
                      onScrubTimeline(sec);
                    }
                    setRulerScrubbing(true);
                  }}
                  style={{ width: `${blockLayouts.contentWidthPx}px` }}
                  className="relative cursor-pointer"
                >
                  {rulerTicks.map((tick) => (
                    <div
                      key={tick.sec}
                      style={{ left: `${tick.xPx}px` }}
                      className="pointer-events-none absolute top-0 bottom-0"
                    >
                      <span
                        className={`block w-px ${
                          tick.major ? "h-2.5 bg-slate-900/35" : "h-1.5 bg-slate-900/20"
                        }`}
                      />
                      {tick.label && (
                        <span
                          className={`font-mono-tabular absolute top-2.5 whitespace-nowrap text-[10px] leading-none text-[var(--text-muted)] ${
                            tick.align === "right" ? "-left-1 -translate-x-full" : "left-1"
                          }`}
                        >
                          {tick.label}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              {/* Track Rows Wrapper (holds full-height vertical playhead) */}
              <div className="relative flex flex-1 flex-col">
                {/* Track 1: Video Clips */}
                <div className="flex h-[52px] shrink-0 items-stretch border-b border-[var(--border-hairline)]">
                  <div
                    style={{ width: `${gutterWidthPx}px` }}
                    className="sticky left-0 z-20 flex shrink-0 items-center gap-1.5 border-r border-[var(--border-hairline)] bg-[rgba(248,250,252,0.92)] px-2.5"
                  >
                    <Film className="h-3.5 w-3.5 shrink-0 text-[var(--accent-primary)]" aria-hidden="true" />
                    <span className="truncate text-[11px] font-semibold text-[var(--text-primary)]">
                      Clips
                    </span>
                    <span className="font-mono-tabular ml-auto text-[10px] text-[var(--text-muted)]">
                      {layout.items.length}
                    </span>
                  </div>

                  <div
                    data-testid="editor-video-track"
                    style={{ width: `${blockLayouts.contentWidthPx}px` }}
                    className="relative flex items-center py-1"
                  >
                    {blockLayouts.blocks.map((block, idx) => {
                      const seg = block.segment;
                      const selected = selectedSegmentIds.includes(seg.id);
                      const isPrimary = seg.id === primarySelectedSegmentId;
                      const title = seg.clip.title?.trim() || seg.clip.fileName;
                      const showThumb = block.widthPx >= 96;
                      const thumbSrc =
                        showThumb && streamerBaseUrl
                          ? getThumbStreamUrl(
                              streamerBaseUrl,
                              streamerToken,
                              seg.clip.id,
                              seg.clip.thumbUrl
                            )
                          : "";
                      const allSegments = layout.items.map((it) => it.segment);
                      const isLast = idx === layout.items.length - 1;
                      const nextSeg = !isLast ? layout.items[idx + 1]?.segment : undefined;
                      const inDur =
                        idx === 0
                          ? seg.transitionIn === "fade"
                            ? seg.transitionInDurationSec
                            : 0
                          : seg.transitionIn === "crossfade"
                            ? seg.transitionInDurationSec
                            : 0;
                      const outDur = isLast
                        ? seg.transitionOut === "fade"
                          ? seg.transitionOutDurationSec
                          : 0
                        : nextSeg?.transitionIn === "crossfade"
                          ? nextSeg.transitionInDurationSec
                          : 0;
                      const maxInDur =
                        idx === 0
                          ? getMaxFadeInSec(allSegments)
                          : getMaxCrossfadeSec(allSegments, idx);
                      const maxOutDur = isLast
                        ? getMaxFadeOutSec(allSegments)
                        : getMaxCrossfadeSec(allSegments, idx + 1);
                      const inPx = Math.min(block.widthPx - 8, Math.max(0, inDur * activePxPerSec));
                      const outPx = Math.min(block.widthPx - 8, Math.max(0, outDur * activePxPerSec));
                      const inKind: "fade_in" | "crossfade" = idx === 0 ? "fade_in" : "crossfade";
                      const outKind: "fade_out" | "crossfade" = isLast ? "fade_out" : "crossfade";
                      const outTargetId = isLast ? seg.id : nextSeg?.id ?? seg.id;
                      const outField: "in" | "out" = isLast ? "out" : "in";
                      const earSizeClass = isNarrow ? "w-5 h-[20px]" : "w-4 h-[18px]";
                      const isDropBefore =
                        reorderDrag?.active &&
                        reorderDrag.targetIndex === idx &&
                        reorderDrag.fromIndex > idx;
                      const isDropAfter =
                        reorderDrag?.active &&
                        reorderDrag.targetIndex === idx &&
                        reorderDrag.fromIndex < idx;
                      const isBeingDragged = reorderDrag?.active && reorderDrag.fromIndex === idx;

                      let siblingShiftPx = 0;
                      if (reorderDrag?.active && !isBeingDragged) {
                        if (reorderDrag.fromIndex < idx && idx <= reorderDrag.targetIndex) {
                          siblingShiftPx = -draggedBlockWidth;
                        } else if (reorderDrag.fromIndex > idx && idx >= reorderDrag.targetIndex) {
                          siblingShiftPx = draggedBlockWidth;
                        }
                      }

                      const isThisTrimmed = trimDrag?.segmentId === seg.id;

                      return (
                        <div
                          key={seg.id}
                          style={{
                            left: `${block.leftPx}px`,
                            width: `${block.widthPx}px`,
                            transform: isBeingDragged
                              ? `translate3d(${reorderDrag.deltaX}px, -2px, 0) scale(1.02)`
                              : siblingShiftPx !== 0
                                ? `translate3d(${siblingShiftPx}px, 0, 0)`
                                : undefined,
                            transition:
                              isTrimming || isBeingDragged
                                ? "none"
                                : reorderDrag?.active
                                  ? "transform 150ms cubic-bezier(0.2, 0, 0, 1)"
                                  : undefined,
                            zIndex: isBeingDragged ? 25 : undefined,
                          }}
                          className="absolute inset-y-1 flex items-center"
                        >
                          {isDropBefore && (
                            <span
                              data-testid="timeline-drop-indicator"
                              aria-hidden="true"
                              className="pointer-events-none absolute -left-0.5 inset-y-0 z-30 w-[3px] rounded-full bg-[var(--accent-primary)] shadow-[0_0_8px_rgba(29,78,216,0.45)]"
                            />
                          )}

                          <div
                            data-timeline-segment-id={seg.id}
                            data-selected={selected ? "true" : "false"}
                            onPointerDown={(e) => handleBlockPointerDown(e, idx, block)}
                            className={`group relative flex h-full w-full cursor-grab items-center overflow-hidden rounded-[8px] border active:cursor-grabbing ${
                              isTrimming
                                ? ""
                                : "transition-[background-color,border-color,box-shadow,opacity] duration-[120ms]"
                            } ${
                              selected
                                ? isPrimary
                                  ? "border-[var(--accent-primary)] bg-[rgba(219,234,254,0.96)] ring-2 ring-[var(--accent-primary)]"
                                  : "border-[var(--accent-primary)] bg-[rgba(219,234,254,0.88)] ring-1 ring-[var(--accent-primary)]"
                                : "border-[rgba(29,78,216,0.28)] bg-[rgba(219,234,254,0.72)] hover:bg-[rgba(219,234,254,0.92)]"
                            } ${
                              isBeingDragged
                                ? "opacity-85 shadow-[0_10px_24px_rgba(15,23,42,0.18)]"
                                : ""
                            }`}
                          >
                            {/* Left Transition Overlay (In: Fade In or Crossfade) */}
                            {inPx > 0 && (
                              <div
                                aria-hidden="true"
                                style={{
                                  width: `${inPx}px`,
                                  backgroundImage:
                                    "repeating-linear-gradient(-45deg, rgba(29, 78, 216, 0.14), rgba(29, 78, 216, 0.14) 3px, transparent 3px, transparent 7px), linear-gradient(135deg, rgba(29, 78, 216, 0.24) 0%, rgba(29, 78, 216, 0.05) 100%)",
                                }}
                                className="pointer-events-none absolute inset-y-0 left-0 z-10 overflow-hidden"
                              >
                                <svg
                                  viewBox="0 0 100 100"
                                  preserveAspectRatio="none"
                                  className="h-full w-full"
                                >
                                  <line
                                    x1="0"
                                    y1="100"
                                    x2="100"
                                    y2="0"
                                    stroke="#1d4ed8"
                                    strokeWidth="1.75"
                                    vectorEffect="non-scaling-stroke"
                                  />
                                </svg>
                                {inPx >= 54 && !transitionDrag && (
                                  <span className="font-mono-tabular absolute bottom-1 left-1.5 rounded bg-white/80 px-1 text-[9px] font-semibold text-[#1e3a8a]">
                                    {inDur.toFixed(2)}s
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Right Transition Overlay (Out: Crossfade or Fade Out) */}
                            {outPx > 0 && (
                              <div
                                aria-hidden="true"
                                style={{
                                  width: `${outPx}px`,
                                  backgroundImage:
                                    "repeating-linear-gradient(45deg, rgba(29, 78, 216, 0.14), rgba(29, 78, 216, 0.14) 3px, transparent 3px, transparent 7px), linear-gradient(225deg, rgba(29, 78, 216, 0.24) 0%, rgba(29, 78, 216, 0.05) 100%)",
                                }}
                                className="pointer-events-none absolute inset-y-0 right-0 z-10 overflow-hidden"
                              >
                                <svg
                                  viewBox="0 0 100 100"
                                  preserveAspectRatio="none"
                                  className="h-full w-full"
                                >
                                  <line
                                    x1="0"
                                    y1="0"
                                    x2="100"
                                    y2="100"
                                    stroke="#1d4ed8"
                                    strokeWidth="1.75"
                                    vectorEffect="non-scaling-stroke"
                                  />
                                </svg>
                                {outPx >= 54 && !transitionDrag && (
                                  <span className="font-mono-tabular absolute right-1.5 bottom-1 rounded bg-white/80 px-1 text-[9px] font-semibold text-[#1e3a8a]">
                                    {outDur.toFixed(2)}s
                                  </span>
                                )}
                              </div>
                            )}

                            {/* Upper Zone (top-0 h-[18px]): Left Transition Handle */}
                            {maxInDur >= MIN_TRANSITION_SEC && (
                              inDur >= MIN_TRANSITION_SEC ? (
                                <div
                                  role="separator"
                                  aria-orientation="vertical"
                                  aria-label={idx === 0 ? `Fade in duration for ${title}` : `Crossfade in duration for ${title}`}
                                  data-transition-edge="in"
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    resetTransitionToCut(seg.id, "in");
                                  }}
                                  onPointerDown={(e) =>
                                    handleTransitionPointerDown(e, {
                                      blockIndex: idx,
                                      targetSegmentId: seg.id,
                                      field: "in",
                                      handleSide: "left",
                                      kind: inKind,
                                      origDurationSec: inDur,
                                      maxDurationSec: maxInDur,
                                      selectSegmentId: seg.id,
                                    })
                                  }
                                  style={{ left: `${inPx}px` }}
                                  title="Drag to resize transition (double-click to reset to Cut)"
                                  className="absolute inset-y-0 z-30 -ml-[5px] flex w-[10px] cursor-ew-resize flex-col items-center"
                                >
                                  <span className="h-[14px] w-[10px] rounded-b-[3px] bg-[var(--accent-primary)] shadow-sm" />
                                  <span className="w-[2px] flex-1 bg-[var(--accent-primary)]" />
                                  {inPx >= 28 && !isNarrow && (
                                    <button
                                      type="button"
                                      aria-label="Reset left transition to Cut"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        resetTransitionToCut(seg.id, "in");
                                      }}
                                      className="absolute top-0.5 -left-4 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-white/90 text-[var(--accent-text)] shadow-sm group-hover:flex"
                                    >
                                      <X className="h-2.5 w-2.5" aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div
                                  role="separator"
                                  aria-orientation="vertical"
                                  aria-label={idx === 0 ? `Drag right for Fade In on ${title}` : `Drag right for Crossfade on ${title}`}
                                  data-transition-edge="in"
                                  onPointerDown={(e) =>
                                    handleTransitionPointerDown(e, {
                                      blockIndex: idx,
                                      targetSegmentId: seg.id,
                                      field: "in",
                                      handleSide: "left",
                                      kind: inKind,
                                      origDurationSec: 0,
                                      maxDurationSec: maxInDur,
                                      selectSegmentId: seg.id,
                                    })
                                  }
                                  title={idx === 0 ? "Drag right for Fade In" : "Drag right for Crossfade"}
                                  className={`absolute top-0 left-0 z-30 flex ${earSizeClass} cursor-ew-resize items-start justify-start p-0.5 transition-opacity duration-[120ms] ${
                                    isNarrow ? "opacity-85" : selected ? "opacity-100" : "opacity-45 group-hover:opacity-100"
                                  }`}
                                >
                                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 text-[var(--accent-primary)]" aria-hidden="true">
                                    <path d="M0 0 L10 0 L0 10 Z" fill="currentColor" />
                                  </svg>
                                </div>
                              )
                            )}

                            {/* Upper Zone (top-0 h-[18px]): Right Transition Handle */}
                            {maxOutDur >= MIN_TRANSITION_SEC && (
                              outDur >= MIN_TRANSITION_SEC ? (
                                <div
                                  role="separator"
                                  aria-orientation="vertical"
                                  aria-label={isLast ? `Fade out duration for ${title}` : `Crossfade out duration for ${title}`}
                                  data-transition-edge="out"
                                  onDoubleClick={(e) => {
                                    e.stopPropagation();
                                    resetTransitionToCut(outTargetId, outField);
                                  }}
                                  onPointerDown={(e) =>
                                    handleTransitionPointerDown(e, {
                                      blockIndex: idx,
                                      targetSegmentId: outTargetId,
                                      field: outField,
                                      handleSide: "right",
                                      kind: outKind,
                                      origDurationSec: outDur,
                                      maxDurationSec: maxOutDur,
                                      selectSegmentId: seg.id,
                                    })
                                  }
                                  style={{ right: `${outPx}px` }}
                                  title="Drag to resize transition (double-click to reset to Cut)"
                                  className="absolute inset-y-0 z-30 -mr-[5px] flex w-[10px] cursor-ew-resize flex-col items-center"
                                >
                                  <span className="h-[14px] w-[10px] rounded-b-[3px] bg-[var(--accent-primary)] shadow-sm" />
                                  <span className="w-[2px] flex-1 bg-[var(--accent-primary)]" />
                                  {outPx >= 28 && !isNarrow && (
                                    <button
                                      type="button"
                                      aria-label="Reset right transition to Cut"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        resetTransitionToCut(outTargetId, outField);
                                      }}
                                      className="absolute top-0.5 -right-4 hidden h-3.5 w-3.5 items-center justify-center rounded-full bg-white/90 text-[var(--accent-text)] shadow-sm group-hover:flex"
                                    >
                                      <X className="h-2.5 w-2.5" aria-hidden="true" />
                                    </button>
                                  )}
                                </div>
                              ) : (
                                <div
                                  role="separator"
                                  aria-orientation="vertical"
                                  aria-label={isLast ? `Drag left for Fade Out on ${title}` : `Drag left for Crossfade on ${title}`}
                                  data-transition-edge="out"
                                  onPointerDown={(e) =>
                                    handleTransitionPointerDown(e, {
                                      blockIndex: idx,
                                      targetSegmentId: outTargetId,
                                      field: outField,
                                      handleSide: "right",
                                      kind: outKind,
                                      origDurationSec: 0,
                                      maxDurationSec: maxOutDur,
                                      selectSegmentId: seg.id,
                                    })
                                  }
                                  title={isLast ? "Drag left for Fade Out" : "Drag left for Crossfade"}
                                  className={`absolute top-0 right-0 z-30 flex ${earSizeClass} cursor-ew-resize items-start justify-end p-0.5 transition-opacity duration-[120ms] ${
                                    isNarrow ? "opacity-85" : selected ? "opacity-100" : "opacity-45 group-hover:opacity-100"
                                  }`}
                                >
                                  <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 text-[var(--accent-primary)]" aria-hidden="true">
                                    <path d="M0 0 L10 0 L10 10 Z" fill="currentColor" />
                                  </svg>
                                </div>
                              )
                            )}

                            {/* Lower Zone (top-[18px] bottom-0): Trim Start Handle */}
                            <div
                              role="separator"
                              aria-orientation="vertical"
                              aria-label={`Trim start of ${title}`}
                              data-trim-edge="start"
                              onPointerDown={(e) => handleTrimPointerDown(e, "start", block)}
                              className={`group/handle absolute top-[18px] bottom-0 left-0 z-20 flex ${handleWidthClass} cursor-ew-resize items-center justify-center`}
                            >
                              <span
                                className={`h-4 w-[3px] rounded-full transition-colors duration-[120ms] ${
                                  (isThisTrimmed && trimDrag.edge === "start") || selected
                                    ? "bg-[var(--accent-primary)]"
                                    : "bg-slate-900/20 group-hover/handle:bg-[var(--accent-primary)]"
                                }`}
                              />
                            </div>

                            {showThumb && (
                              <div className="relative z-10 h-full w-9 shrink-0 overflow-hidden bg-[var(--surface-cinema-frame)]">
                                {thumbSrc && (
                                  <img
                                    src={thumbSrc}
                                    alt=""
                                    className="h-full w-full object-cover"
                                  />
                                )}
                              </div>
                            )}

                            {block.widthPx >= 44 && (() => {
                              const segMuted =
                                seg.masterMuted ||
                                (seg.audioMix.length > 0 && seg.audioMix.every((m) => m.muted));
                              if (segMuted) {
                                return (
                                  <div
                                    aria-hidden="true"
                                    className="pointer-events-none absolute inset-x-1 bottom-2 z-0 h-[1.5px] rounded-full bg-slate-900/15"
                                  />
                                );
                              }
                              const firstUnmuted = seg.audioMix.find((m) => !m.muted);
                              const trackOrder = firstUnmuted?.trackOrder ?? 0;
                              const rawPeaks = waveformMap[`${seg.clipId}:${trackOrder}`];
                              if (!rawPeaks || rawPeaks.length === 0) return null;
                              const barCount = Math.min(96, Math.max(12, Math.floor(block.widthPx / 3)));
                              const slicedPeaks = sliceAndResamplePeaks(
                                rawPeaks,
                                seg.startSec,
                                seg.endSec,
                                seg.clip.durationSec,
                                barCount
                              );
                              return (
                                <div
                                  aria-hidden="true"
                                  className="pointer-events-none absolute inset-x-1 bottom-1 top-3 z-0 flex items-end gap-[1.5px] opacity-85"
                                >
                                  {slicedPeaks.map((amp, barIdx) => (
                                    <div
                                      key={barIdx}
                                      className="flex-1 rounded-t-[1px]"
                                      style={{
                                        height: `${Math.max(10, Math.min(92, Math.round(amp * 92)))}%`,
                                        backgroundColor: selected
                                          ? "rgba(29, 78, 216, 0.32)"
                                          : "rgba(29, 78, 216, 0.24)",
                                      }}
                                    />
                                  ))}
                                </div>
                              );
                            })()}

                            <div className="relative z-10 flex min-w-0 flex-1 items-center justify-between gap-1 px-2 py-0.5">
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[11px] font-semibold text-[var(--text-primary)]">
                                  {title}
                                </p>
                                <div className="flex items-center gap-1.5">
                                  <span
                                    data-testid="timeline-block-duration"
                                    className="font-mono-tabular text-[10px] text-[var(--text-secondary)]"
                                  >
                                    {block.effectiveDur.toFixed(1)}s
                                  </span>
                                  {seg.speed !== 1 && (
                                    <span className="font-mono-tabular text-[10px] font-semibold text-[var(--accent-text)]">
                                      {seg.speed}x
                                    </span>
                                  )}
                                </div>
                              </div>
                              <GripVertical
                                className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)] opacity-0 group-hover:opacity-75"
                                aria-hidden="true"
                              />
                            </div>

                            {/* Lower Zone (top-[18px] bottom-0): Trim End Handle */}
                            <div
                              role="separator"
                              aria-orientation="vertical"
                              aria-label={`Trim end of ${title}`}
                              data-trim-edge="end"
                              onPointerDown={(e) => handleTrimPointerDown(e, "end", block)}
                              className={`group/handle absolute top-[18px] bottom-0 right-0 z-20 flex ${handleWidthClass} cursor-ew-resize items-center justify-center`}
                            >
                              <span
                                className={`h-4 w-[3px] rounded-full transition-colors duration-[120ms] ${
                                  (isThisTrimmed && trimDrag.edge === "end") || selected
                                    ? "bg-[var(--accent-primary)]"
                                    : "bg-slate-900/20 group-hover/handle:bg-[var(--accent-primary)]"
                                }`}
                              />
                            </div>
                          </div>

                          {isDropAfter && (
                            <span
                              data-testid="timeline-drop-indicator"
                              aria-hidden="true"
                              className="pointer-events-none absolute -right-0.5 inset-y-0 z-30 w-[3px] rounded-full bg-[var(--accent-primary)] shadow-[0_0_8px_rgba(29,78,216,0.45)]"
                            />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Track 2: Music Layer (shown when audioLayers.length > 0) */}
                {audioLayers.length > 0 && (
                  <div
                    data-testid="editor-music-track-row"
                    className="flex h-[56px] shrink-0 items-stretch"
                  >
                    <div
                      style={{ width: `${gutterWidthPx}px` }}
                      className="sticky left-0 z-20 flex shrink-0 items-center gap-1 border-r border-[var(--border-hairline)] bg-[rgba(248,250,252,0.92)] px-2"
                    >
                      <Music className="h-3.5 w-3.5 shrink-0 text-[#6d28d9]" aria-hidden="true" />
                      <span
                        data-testid="editor-music-gutter-label"
                        className="shrink-0 text-[11px] font-semibold text-[#4c1d95]"
                      >
                        Music
                      </span>
                      {activeAudioLayer && (
                        <div className="ml-auto flex items-center gap-0.5">
                          <button
                            type="button"
                            data-testid="editor-music-gutter-mute"
                            aria-pressed={activeAudioLayer.muted}
                            aria-label={activeAudioLayer.muted ? "Unmute music layer" : "Mute music layer"}
                            title={activeAudioLayer.muted ? "Unmute" : "Mute"}
                            onClick={() =>
                              onUpdateAudioLayer(activeAudioLayer.id, {
                                muted: !activeAudioLayer.muted,
                              })
                            }
                            className={`flex ${smallBtnSize} items-center justify-center rounded-[6px] text-[#4c1d95] hover:bg-violet-900/10`}
                          >
                            {activeAudioLayer.muted ? (
                              <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                            ) : (
                              <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                            )}
                          </button>
                          <button
                            type="button"
                            data-testid="editor-music-gutter-delete"
                            aria-label="Remove music layer"
                            title="Remove music layer"
                            onClick={() => onRemoveAudioLayer(activeAudioLayer.id)}
                            className={`flex ${smallBtnSize} items-center justify-center rounded-[6px] text-[var(--text-muted)] hover:bg-red-500/10 hover:text-[var(--status-error-fg)]`}
                          >
                            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      )}
                    </div>

                    <div
                      data-testid="editor-music-track"
                      style={{ width: `${blockLayouts.contentWidthPx}px` }}
                      className="relative flex items-center py-1.5"
                    >
                      {audioLayers.map((layer) => {
                        const activeDur = Math.max(
                          EDITOR_MIN_AUDIO_TRIM_SEC,
                          layer.trimEndSec - layer.trimStartSec
                        );
                        const leftPx = layer.timelineOffsetSec * activePxPerSec;
                        const widthPx = Math.max(36, activeDur * activePxPerSec);
                        const isSelected = activeAudioLayer?.id === layer.id;
                        const videoEnd = layout.totalDurationSec;
                        const overflowStartPx =
                          videoEnd > 0 && layer.timelineOffsetSec + activeDur > videoEnd
                            ? Math.max(0, (videoEnd - layer.timelineOffsetSec) * activePxPerSec)
                            : null;

                        return (
                          <div
                            key={layer.id}
                            data-testid={`editor-music-block-${layer.id}`}
                            data-selected={isSelected ? "true" : "false"}
                            onPointerDown={(e) => handleMusicPointerDown(e, layer, "move")}
                            style={{
                              left: `${leftPx}px`,
                              width: `${widthPx}px`,
                            }}
                            className={`group absolute inset-y-1.5 flex items-center overflow-hidden rounded-[8px] border ${
                              layer.isMissing
                                ? "border-[var(--status-error-fg)] bg-[var(--status-error-bg)] text-[var(--status-error-fg)]"
                                : isSelected
                                  ? "cursor-grab border-[#6d28d9] bg-[rgba(221,214,254,0.94)] text-[#1e1b4b] ring-2 ring-[#6d28d9] active:cursor-grabbing"
                                  : "cursor-grab border-[rgba(109,40,217,0.34)] bg-[rgba(237,233,254,0.88)] text-[#1e1b4b] hover:bg-[rgba(221,214,254,0.9)] active:cursor-grabbing"
                            } ${layer.muted && !layer.isMissing ? "opacity-70" : ""}`}
                          >
                            {!layer.isMissing && (
                              <div
                                role="separator"
                                aria-orientation="vertical"
                                aria-label={`Trim start of ${layer.title}`}
                                data-music-trim-edge="start"
                                onPointerDown={(e) => handleMusicPointerDown(e, layer, "trim-start")}
                                className={`group/handle absolute inset-y-0 left-0 z-20 flex ${handleWidthClass} cursor-ew-resize items-center justify-center`}
                              >
                                <span className="h-4 w-[3px] rounded-full bg-[#6d28d9]/40 group-hover/handle:bg-[#6d28d9]" />
                              </div>
                            )}

                            {overflowStartPx !== null && overflowStartPx < widthPx && (
                              <div
                                aria-hidden="true"
                                style={{
                                  left: `${overflowStartPx}px`,
                                  backgroundImage:
                                    "repeating-linear-gradient(-45deg, rgba(109,40,217,0.12), rgba(109,40,217,0.12) 4px, transparent 4px, transparent 8px)",
                                }}
                                className="pointer-events-none absolute inset-y-0 right-0 z-0 border-l border-dashed border-[#6d28d9]/50"
                              />
                            )}

                            {!layer.isMissing && widthPx >= 44 && (() => {
                              if (layer.muted) {
                                return (
                                  <div
                                    aria-hidden="true"
                                    className="pointer-events-none absolute inset-x-1.5 bottom-2 z-0 h-[1.5px] rounded-full bg-[#6d28d9] opacity-25"
                                  />
                                );
                              }
                              const rawPeaks = waveformMap[`local:${layer.filePath}`];
                              if (!rawPeaks || rawPeaks.length === 0) return null;
                              const barCount = Math.min(120, Math.max(14, Math.floor(widthPx / 3)));
                              const slicedPeaks = sliceAndResamplePeaks(
                                rawPeaks,
                                layer.trimStartSec,
                                layer.trimEndSec,
                                layer.durationSec,
                                barCount
                              );
                              return (
                                <div
                                  aria-hidden="true"
                                  className="pointer-events-none absolute inset-x-1.5 bottom-1 top-3 z-0 flex items-end gap-[1.5px] opacity-85"
                                >
                                  {slicedPeaks.map((amp, barIdx) => (
                                    <div
                                      key={barIdx}
                                      className="flex-1 rounded-t-[1px]"
                                      style={{
                                        height: `${Math.max(10, Math.min(92, Math.round(amp * 92)))}%`,
                                        backgroundColor: isSelected
                                          ? "rgba(109, 40, 217, 0.34)"
                                          : "rgba(109, 40, 217, 0.24)",
                                      }}
                                    />
                                  ))}
                                </div>
                              );
                            })()}

                            <div className="relative z-10 flex min-w-0 flex-1 items-center justify-between gap-2 px-2.5">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                  <p className="truncate text-[11px] font-semibold">
                                    {layer.title}
                                  </p>
                                  {layer.muted && !layer.isMissing && (
                                    <span className="rounded bg-[#4c1d95]/15 px-1 py-0.5 text-[9px] font-semibold text-[#4c1d95]">
                                      Muted
                                    </span>
                                  )}
                                  {layer.isMissing && (
                                    <span className="rounded bg-red-600/15 px-1 py-0.5 text-[9px] font-semibold">
                                      File missing
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center gap-2 text-[10px]">
                                  <span className="font-mono-tabular">
                                    {activeDur.toFixed(1)}s
                                  </span>
                                  {!layer.isMissing && (
                                    <span className="font-mono-tabular font-semibold text-[#4c1d95]">
                                      {layer.muted ? "Muted" : `${Math.round(layer.volume)}%`}
                                    </span>
                                  )}
                                  {overflowStartPx !== null && (
                                    <span className="truncate text-[9px] text-[#4c1d95]/85">
                                      Ends at video end
                                    </span>
                                  )}
                                </div>
                              </div>

                              {layer.isMissing && (
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => onLocateAudioLayer(layer.id)}
                                    className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-primary)] hover:bg-white"
                                  >
                                    Locate
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => onRemoveAudioLayer(layer.id)}
                                    className="rounded bg-white/80 px-1.5 py-0.5 text-[10px] font-semibold hover:bg-white"
                                  >
                                    Remove
                                  </button>
                                </div>
                              )}
                            </div>

                            {!layer.isMissing && (
                              <div
                                role="separator"
                                aria-orientation="vertical"
                                aria-label={`Trim end of ${layer.title}`}
                                data-music-trim-edge="end"
                                onPointerDown={(e) => handleMusicPointerDown(e, layer, "trim-end")}
                                className={`group/handle absolute inset-y-0 right-0 z-20 flex ${handleWidthClass} cursor-ew-resize items-center justify-center`}
                              >
                                <span className="h-4 w-[3px] rounded-full bg-[#6d28d9]/40 group-hover/handle:bg-[#6d28d9]" />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Full-height 0ms real-time global playhead needle across Ruler, Track 1, and Track 2 */}
                <div
                  data-testid="editor-timeline-playhead"
                  aria-hidden="true"
                  className="pointer-events-none absolute top-[-24px] bottom-0 z-30 -ml-[1px] w-[2px] bg-[var(--accent-primary)] shadow-[0_0_0_1px_rgba(255,255,255,0.85)]"
                  style={{ left: `${gutterWidthPx + playheadPx}px`, transition: "none" }}
                >
                  <span className="absolute -top-0.5 left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 rounded-[2px] bg-[var(--accent-primary)] ring-1 ring-white" />
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Selected Music Layer Volume & Quick Controls Strip */}
      {activeAudioLayer && !activeAudioLayer.isMissing && (
        <div
          data-testid="editor-music-controls-strip"
          className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-[rgba(109,40,217,0.22)] bg-[rgba(237,233,254,0.55)] px-2.5 py-1.5"
        >
          <div className="flex min-w-0 items-center gap-2">
            <Music className="h-3.5 w-3.5 shrink-0 text-[#6d28d9]" aria-hidden="true" />
            <span className="max-w-[180px] truncate text-[11px] font-semibold text-[#1e1b4b]">
              {activeAudioLayer.title}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="music-volume-slider"
              className="text-[11px] font-medium text-[#4c1d95]"
            >
              Volume
            </label>
            <input
              id="music-volume-slider"
              data-testid="editor-music-volume-slider"
              type="range"
              min={0}
              max={200}
              step={5}
              value={activeAudioLayer.volume}
              onPointerDown={() => onBeginTrimTransaction()}
              onPointerUp={() => onCommitTrimTransaction()}
              onChange={(e) =>
                onUpdateAudioLayer(
                  activeAudioLayer.id,
                  { volume: Number(e.target.value) },
                  { recordHistory: false }
                )
              }
              aria-label="Music volume"
              className="h-1.5 w-24 accent-[#6d28d9]"
            />
            <span className="font-mono-tabular w-9 text-right text-[11px] font-semibold text-[#1e1b4b]">
              {Math.round(activeAudioLayer.volume)}%
            </span>

            <button
              type="button"
              aria-pressed={activeAudioLayer.muted}
              aria-label={activeAudioLayer.muted ? "Unmute music" : "Mute music"}
              onClick={() =>
                onUpdateAudioLayer(activeAudioLayer.id, { muted: !activeAudioLayer.muted })
              }
              className={`flex ${smallBtnSize} items-center justify-center rounded-[6px] text-[#4c1d95] hover:bg-violet-900/10`}
            >
              {activeAudioLayer.muted ? (
                <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </button>

            <button
              type="button"
              aria-label="Delete music layer"
              onClick={() => onRemoveAudioLayer(activeAudioLayer.id)}
              className={`flex ${smallBtnSize} items-center justify-center rounded-[6px] text-[var(--text-muted)] hover:bg-red-500/10 hover:text-[var(--status-error-fg)]`}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
