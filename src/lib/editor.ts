import { estimateExportBytes } from "./format";
import type {
  AudioTrackMix,
  ClipSummary,
  EditorAudioLayer,
  EditorExportPreset,
  EditorFraming,
  EditorSegment,
  EditorSpeed,
  EditorTransition,
  ProbedAudioFile,
} from "./types";

export const EDITOR_CROSSFADE_SEC = 0.35;
export const DEFAULT_LEGACY_CROSSFADE_SEC = 0.35;
export const MAX_TRANSITION_SEC = 3.0;
export const MIN_TRANSITION_SEC = 0.10;
export const EDITOR_MIN_ACTIVE_BODY_SEC = 0.20;
export const EDITOR_MIN_SEGMENT_FOR_CROSSFADE = 0.8;
export const EDITOR_MIN_TRIM_SEC = 0.25;
export const EDITOR_MIN_AUDIO_TRIM_SEC = 0.25;

export function roundTransitionDuration(value: number, fine = false): number {
  if (!Number.isFinite(value) || value < MIN_TRANSITION_SEC) return 0;
  const step = fine ? 0.01 : 0.05;
  const rounded = Math.round(value / step) * step;
  return Number(Math.max(0, Math.min(MAX_TRANSITION_SEC, rounded)).toFixed(2));
}

export function makeEditorAudioLayerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `aud-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clampAudioVolume(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(200, Math.round(value)));
}

export function normalizeEditorAudioLayer(layer: EditorAudioLayer): EditorAudioLayer {
  const durationSec = Math.max(
    EDITOR_MIN_AUDIO_TRIM_SEC,
    typeof layer.durationSec === "number" && Number.isFinite(layer.durationSec)
      ? layer.durationSec
      : EDITOR_MIN_AUDIO_TRIM_SEC
  );
  const rawStart =
    typeof layer.trimStartSec === "number" && Number.isFinite(layer.trimStartSec)
      ? layer.trimStartSec
      : 0;
  const rawEnd =
    typeof layer.trimEndSec === "number" && Number.isFinite(layer.trimEndSec)
      ? layer.trimEndSec
      : durationSec;
  const trimStartSec = Math.max(0, Math.min(rawStart, durationSec - EDITOR_MIN_AUDIO_TRIM_SEC));
  const trimEndSec = Math.max(
    trimStartSec + EDITOR_MIN_AUDIO_TRIM_SEC,
    Math.min(durationSec, rawEnd)
  );
  const timelineOffsetSec =
    typeof layer.timelineOffsetSec === "number" && Number.isFinite(layer.timelineOffsetSec)
      ? Math.max(0, layer.timelineOffsetSec)
      : 0;

  return {
    ...layer,
    durationSec,
    timelineOffsetSec,
    trimStartSec,
    trimEndSec,
    volume: clampAudioVolume(layer.volume ?? 100),
    muted: Boolean(layer.muted),
    isMissing: Boolean(layer.isMissing),
  };
}

export function createAudioLayerFromProbed(
  probed: ProbedAudioFile,
  initialOffsetSec = 0
): EditorAudioLayer {
  const durationSec = Math.max(EDITOR_MIN_AUDIO_TRIM_SEC, probed.durationSec || EDITOR_MIN_AUDIO_TRIM_SEC);
  return {
    id: makeEditorAudioLayerId(),
    filePath: probed.filePath,
    title: probed.title || "Music Track",
    durationSec,
    timelineOffsetSec: Math.max(0, initialOffsetSec),
    trimStartSec: 0,
    trimEndSec: durationSec,
    volume: 100,
    muted: false,
    isMissing: false,
  };
}

export function clampVibrance(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(-100, Math.min(100, Math.round(value)));
}

export function clampSaturation(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.max(0, Math.min(200, Math.round(value)));
}

export function normalizeEditorFraming(value: unknown): EditorFraming {
  if (value === "fill" || value === "stretch") return value;
  return "fit";
}

export function normalizeEditorSegment(seg: EditorSegment): EditorSegment {
  const maxDur = Math.max(EDITOR_MIN_TRIM_SEC, seg.clip?.durationSec || EDITOR_MIN_TRIM_SEC);
  const rawStart = typeof seg.startSec === "number" && Number.isFinite(seg.startSec) ? seg.startSec : 0;
  const rawEnd = typeof seg.endSec === "number" && Number.isFinite(seg.endSec) ? seg.endSec : maxDur;
  const startSec = Math.max(0, Math.min(rawStart, maxDur - EDITOR_MIN_TRIM_SEC));
  const endSec = Math.max(startSec + EDITOR_MIN_TRIM_SEC, Math.min(maxDur, rawEnd));

  const rawIn = seg.transitionIn;
  const rawInDur =
    typeof seg.transitionInDurationSec === "number" && Number.isFinite(seg.transitionInDurationSec)
      ? seg.transitionInDurationSec
      : rawIn === "crossfade"
        ? DEFAULT_LEGACY_CROSSFADE_SEC
        : 0;
  const normalizedIn =
    (rawIn === "crossfade" || rawIn === "fade") && rawInDur >= MIN_TRANSITION_SEC
      ? rawIn
      : "cut";
  const normalizedInDur =
    normalizedIn === "cut"
      ? 0
      : Math.max(MIN_TRANSITION_SEC, Math.min(MAX_TRANSITION_SEC, rawInDur));

  const rawOut = seg.transitionOut;
  const rawOutDur =
    typeof seg.transitionOutDurationSec === "number" && Number.isFinite(seg.transitionOutDurationSec)
      ? seg.transitionOutDurationSec
      : 0;
  const normalizedOut =
    rawOut === "fade" && rawOutDur >= MIN_TRANSITION_SEC ? "fade" : "cut";
  const normalizedOutDur =
    normalizedOut === "cut"
      ? 0
      : Math.max(MIN_TRANSITION_SEC, Math.min(MAX_TRANSITION_SEC, rawOutDur));

  return {
    ...seg,
    startSec,
    endSec,
    transitionIn: normalizedIn,
    transitionInDurationSec: normalizedInDur,
    transitionOut: normalizedOut,
    transitionOutDurationSec: normalizedOutDur,
    vibrance: typeof seg.vibrance === "number" ? clampVibrance(seg.vibrance) : 0,
    saturation: typeof seg.saturation === "number" ? clampSaturation(seg.saturation) : 100,
    framing: normalizeEditorFraming(seg.framing),
  };
}

export function computeColorPreviewFilter(vibrance: number, saturation: number): string {
  const vib = clampVibrance(vibrance);
  const sat = clampSaturation(saturation);
  if (vib === 0 && sat === 100) return "none";

  const satFactor = Math.max(0, sat / 100);
  const vibFactor = vib >= 0 ? 1 + (vib / 100) * 0.45 : 1 + (vib / 100) * 0.55;
  const contrastBoost = vib > 0 ? 1 + (vib / 100) * 0.05 : 1;
  return `saturate(${(satFactor * vibFactor).toFixed(3)}) contrast(${contrastBoost.toFixed(3)})`;
}

export function getFramingObjectClass(framing: EditorFraming): string {
  if (framing === "fill") return "object-cover";
  if (framing === "stretch") return "object-fill";
  return "object-contain";
}

export function makeEditorSegmentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `seg-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function createDefaultAudioMix(trackCount: number): AudioTrackMix[] {
  const count = Math.max(1, trackCount || 1);
  return Array.from({ length: count }, (_, idx) => ({
    trackOrder: idx,
    streamIndex: idx,
    muted: false,
    volume: 1,
  }));
}

export function createSegmentFromClip(
  clip: ClipSummary,
  overrides?: Partial<{
    startSec: number;
    endSec: number;
    speed: EditorSpeed;
    audioMix: AudioTrackMix[];
    masterVolume: number;
    masterMuted: boolean;
    transitionIn: EditorTransition;
    vibrance: number;
    saturation: number;
    framing: EditorFraming;
  }>
): EditorSegment {
  const clipDur = Math.max(EDITOR_MIN_TRIM_SEC, clip.durationSec || EDITOR_MIN_TRIM_SEC);
  const rawStart = Math.max(0, overrides?.startSec ?? 0);
  const rawEnd = Math.min(clipDur, Math.max(rawStart + EDITOR_MIN_TRIM_SEC, overrides?.endSec ?? clipDur));

  return {
    id: makeEditorSegmentId(),
    clipId: clip.id,
    clip,
    startSec: Math.min(rawStart, Math.max(0, rawEnd - EDITOR_MIN_TRIM_SEC)),
    endSec: rawEnd,
    speed: overrides?.speed ?? 1,
    audioMix:
      overrides?.audioMix && overrides.audioMix.length > 0
        ? overrides.audioMix.map((m) => ({ ...m }))
        : createDefaultAudioMix(clip.audioTrackCount),
    masterVolume: overrides?.masterVolume ?? 100,
    masterMuted: overrides?.masterMuted ?? false,
    transitionIn: overrides?.transitionIn ?? "cut",
    transitionInDurationSec:
      overrides?.transitionIn === "crossfade" || overrides?.transitionIn === "fade"
        ? DEFAULT_LEGACY_CROSSFADE_SEC
        : 0,
    transitionOut: "cut",
    transitionOutDurationSec: 0,
    vibrance: clampVibrance(overrides?.vibrance ?? 0),
    saturation: clampSaturation(overrides?.saturation ?? 100),
    framing: normalizeEditorFraming(overrides?.framing),
  };
}

export function getSegmentRawDuration(
  seg: Pick<EditorSegment, "startSec" | "endSec">
): number {
  return Math.max(EDITOR_MIN_TRIM_SEC, seg.endSec - seg.startSec);
}

export function getSegmentEffectiveDuration(
  seg: Pick<EditorSegment, "startSec" | "endSec" | "speed">
): number {
  return getSegmentRawDuration(seg) / seg.speed;
}

export function getReservedLeftSec(segments: EditorSegment[], index: number): number {
  const seg = segments[index];
  if (!seg) return 0;
  if (index === 0 && seg.transitionIn === "fade" && seg.transitionInDurationSec >= MIN_TRANSITION_SEC) {
    return seg.transitionInDurationSec;
  }
  if (index > 0 && seg.transitionIn === "crossfade" && seg.transitionInDurationSec >= MIN_TRANSITION_SEC) {
    return seg.transitionInDurationSec;
  }
  return 0;
}

export function getReservedRightSec(segments: EditorSegment[], index: number): number {
  const seg = segments[index];
  if (!seg) return 0;
  if (
    index === segments.length - 1 &&
    seg.transitionOut === "fade" &&
    seg.transitionOutDurationSec >= MIN_TRANSITION_SEC
  ) {
    return seg.transitionOutDurationSec;
  }
  const next = segments[index + 1];
  if (
    index < segments.length - 1 &&
    next &&
    next.transitionIn === "crossfade" &&
    next.transitionInDurationSec >= MIN_TRANSITION_SEC
  ) {
    return next.transitionInDurationSec;
  }
  return 0;
}

export function getMaxFadeInSec(segments: EditorSegment[]): number {
  if (segments.length === 0) return 0;
  const eff = getSegmentEffectiveDuration(segments[0]);
  const rightReserve =
    segments.length === 1
      ? segments[0].transitionOut === "fade"
        ? segments[0].transitionOutDurationSec
        : 0
      : segments[1]?.transitionIn === "crossfade"
        ? segments[1].transitionInDurationSec
        : 0;
  const avail = Math.min(MAX_TRANSITION_SEC, eff - rightReserve - EDITOR_MIN_ACTIVE_BODY_SEC);
  return avail >= MIN_TRANSITION_SEC ? Number(avail.toFixed(2)) : 0;
}

export function getMaxFadeOutSec(segments: EditorSegment[]): number {
  if (segments.length === 0) return 0;
  const lastIdx = segments.length - 1;
  const lastSeg = segments[lastIdx];
  const eff = getSegmentEffectiveDuration(lastSeg);
  const leftReserve = getReservedLeftSec(segments, lastIdx);
  const avail = Math.min(MAX_TRANSITION_SEC, eff - leftReserve - EDITOR_MIN_ACTIVE_BODY_SEC);
  return avail >= MIN_TRANSITION_SEC ? Number(avail.toFixed(2)) : 0;
}

export function getMaxCrossfadeSec(segments: EditorSegment[], rightIndex: number): number {
  if (rightIndex <= 0 || rightIndex >= segments.length) return 0;
  const prev = segments[rightIndex - 1];
  const curr = segments[rightIndex];
  const prevAvail =
    getSegmentEffectiveDuration(prev) -
    getReservedLeftSec(segments, rightIndex - 1) -
    EDITOR_MIN_ACTIVE_BODY_SEC;
  const currRightReserve =
    rightIndex === segments.length - 1
      ? curr.transitionOut === "fade"
        ? curr.transitionOutDurationSec
        : 0
      : segments[rightIndex + 1]?.transitionIn === "crossfade"
        ? segments[rightIndex + 1].transitionInDurationSec
        : 0;
  const currAvail =
    getSegmentEffectiveDuration(curr) - currRightReserve - EDITOR_MIN_ACTIVE_BODY_SEC;
  const avail = Math.min(MAX_TRANSITION_SEC, prevAvail, currAvail);
  return avail >= MIN_TRANSITION_SEC ? Number(avail.toFixed(2)) : 0;
}

export function canEnableCrossfade(
  segments: EditorSegment[],
  index: number
): { allowed: boolean; reason: string | null } {
  if (index <= 0 || index >= segments.length) {
    return {
      allowed: false,
      reason: "First segment cannot crossfade into a previous clip.",
    };
  }
  const maxDur = getMaxCrossfadeSec(segments, index);
  if (maxDur < MIN_TRANSITION_SEC) {
    return {
      allowed: false,
      reason: "Adjacent segments need at least 0.30s outside existing transitions.",
    };
  }
  return { allowed: true, reason: null };
}

export function sanitizeTransitions(segments: EditorSegment[]): EditorSegment[] {
  if (segments.length === 0) return segments;
  let changed = false;
  const working = segments.map((s) => ({ ...s }));

  for (let i = 0; i < working.length; i += 1) {
    const seg = working[i];
    const isLast = i === working.length - 1;

    if (!isLast && (seg.transitionOut !== "cut" || seg.transitionOutDurationSec !== 0)) {
      seg.transitionOut = "cut";
      seg.transitionOutDurationSec = 0;
      changed = true;
    }

    if (i === 0) {
      if (seg.transitionIn === "crossfade") {
        seg.transitionIn = "cut";
        seg.transitionInDurationSec = 0;
        changed = true;
      } else if (seg.transitionIn === "fade") {
        const maxIn = getMaxFadeInSec(working);
        const raw = seg.transitionInDurationSec || DEFAULT_LEGACY_CROSSFADE_SEC;
        const clamped = Math.min(maxIn, raw);
        if (clamped < MIN_TRANSITION_SEC) {
          seg.transitionIn = "cut";
          seg.transitionInDurationSec = 0;
          changed = true;
        } else if (Math.abs(clamped - seg.transitionInDurationSec) > 0.001) {
          seg.transitionInDurationSec = Number(clamped.toFixed(2));
          changed = true;
        }
      } else if (seg.transitionInDurationSec !== 0) {
        seg.transitionInDurationSec = 0;
        changed = true;
      }
    } else {
      if (seg.transitionIn === "fade") {
        seg.transitionIn = "cut";
        seg.transitionInDurationSec = 0;
        changed = true;
      } else if (seg.transitionIn === "crossfade") {
        const maxCf = getMaxCrossfadeSec(working, i);
        const raw = seg.transitionInDurationSec || DEFAULT_LEGACY_CROSSFADE_SEC;
        const clamped = Math.min(maxCf, raw);
        if (clamped < MIN_TRANSITION_SEC) {
          seg.transitionIn = "cut";
          seg.transitionInDurationSec = 0;
          changed = true;
        } else if (Math.abs(clamped - seg.transitionInDurationSec) > 0.001) {
          seg.transitionInDurationSec = Number(clamped.toFixed(2));
          changed = true;
        }
      } else if (seg.transitionInDurationSec !== 0) {
        seg.transitionInDurationSec = 0;
        changed = true;
      }
    }

    if (isLast) {
      if (seg.transitionOut === "fade") {
        const maxOut = getMaxFadeOutSec(working);
        const raw = seg.transitionOutDurationSec || DEFAULT_LEGACY_CROSSFADE_SEC;
        const clamped = Math.min(maxOut, raw);
        if (clamped < MIN_TRANSITION_SEC) {
          seg.transitionOut = "cut";
          seg.transitionOutDurationSec = 0;
          changed = true;
        } else if (Math.abs(clamped - seg.transitionOutDurationSec) > 0.001) {
          seg.transitionOutDurationSec = Number(clamped.toFixed(2));
          changed = true;
        }
      } else if (seg.transitionOutDurationSec !== 0) {
        seg.transitionOutDurationSec = 0;
        changed = true;
      }
    }
  }

  return changed ? working : segments;
}

export interface TimelineSegmentLayoutItem {
  segment: EditorSegment;
  index: number;
  effectiveDur: number;
  overlapInSec: number;
  fadeInSec: number;
  fadeOutSec: number;
  timelineStart: number;
  timelineEnd: number;
}

export interface TimelineLayout {
  items: TimelineSegmentLayoutItem[];
  totalDurationSec: number;
}

export function computeTimelineLayout(segments: EditorSegment[]): TimelineLayout {
  const items: TimelineSegmentLayoutItem[] = [];
  let cursor = 0;

  for (let i = 0; i < segments.length; i += 1) {
    const segment = segments[i];
    const effectiveDur = getSegmentEffectiveDuration(segment);
    const maxCf = i > 0 ? getMaxCrossfadeSec(segments, i) : 0;
    const overlapInSec =
      i > 0 &&
      segment.transitionIn === "crossfade" &&
      segment.transitionInDurationSec >= MIN_TRANSITION_SEC &&
      maxCf >= MIN_TRANSITION_SEC
        ? Math.min(maxCf, segment.transitionInDurationSec)
        : 0;
    const maxIn = i === 0 ? getMaxFadeInSec(segments) : 0;
    const fadeInSec =
      i === 0 &&
      segment.transitionIn === "fade" &&
      segment.transitionInDurationSec >= MIN_TRANSITION_SEC &&
      maxIn >= MIN_TRANSITION_SEC
        ? Math.min(maxIn, segment.transitionInDurationSec)
        : 0;
    const maxOut = i === segments.length - 1 ? getMaxFadeOutSec(segments) : 0;
    const fadeOutSec =
      i === segments.length - 1 &&
      segment.transitionOut === "fade" &&
      segment.transitionOutDurationSec >= MIN_TRANSITION_SEC &&
      maxOut >= MIN_TRANSITION_SEC
        ? Math.min(maxOut, segment.transitionOutDurationSec)
        : 0;

    const timelineStart = Math.max(0, cursor - overlapInSec);
    const timelineEnd = timelineStart + effectiveDur;
    items.push({
      segment,
      index: i,
      effectiveDur,
      overlapInSec,
      fadeInSec,
      fadeOutSec,
      timelineStart,
      timelineEnd,
    });
    cursor = timelineEnd;
  }

  return {
    items,
    totalDurationSec: items.length > 0 ? items[items.length - 1].timelineEnd : 0,
  };
}

export function mapTimelineTimeToSegment(
  layout: TimelineLayout,
  timelineSec: number,
  preferredSegmentId?: string | null
): {
  item: TimelineSegmentLayoutItem | null;
  clipLocalSec: number;
  localEffectiveSec: number;
} {
  if (layout.items.length === 0) {
    return { item: null, clipLocalSec: 0, localEffectiveSec: 0 };
  }
  const clamped = Math.max(0, Math.min(layout.totalDurationSec, timelineSec));

  if (preferredSegmentId) {
    const preferred = layout.items.find(
      (it) =>
        it.segment.id === preferredSegmentId &&
        clamped >= it.timelineStart - 0.001 &&
        clamped <= it.timelineEnd + 0.001
    );
    if (preferred) {
      const localEffectiveSec = Math.max(
        0,
        Math.min(preferred.effectiveDur, clamped - preferred.timelineStart)
      );
      const clipLocalSec =
        preferred.segment.startSec + localEffectiveSec * preferred.segment.speed;
      return { item: preferred, clipLocalSec, localEffectiveSec };
    }
  }

  let matched = layout.items[layout.items.length - 1];
  for (let i = 0; i < layout.items.length; i += 1) {
    const it = layout.items[i];
    if (clamped < it.timelineEnd - 0.0005 || i === layout.items.length - 1) {
      matched = it;
      break;
    }
  }

  const localEffectiveSec = Math.max(
    0,
    Math.min(matched.effectiveDur, clamped - matched.timelineStart)
  );
  const clipLocalSec =
    matched.segment.startSec + localEffectiveSec * matched.segment.speed;

  return { item: matched, clipLocalSec, localEffectiveSec };
}

export function getSplitTargetAtPlayhead(
  layout: TimelineLayout,
  playheadSec: number,
  preferredSegmentId?: string | null
): { segment: EditorSegment; splitClipSec: number } | null {
  if (layout.items.length === 0) return null;
  const mapped = mapTimelineTimeToSegment(layout, playheadSec, preferredSegmentId);
  const item = mapped.item;
  if (!item) return null;

  if (playheadSec <= item.timelineStart + 0.01 || playheadSec >= item.timelineEnd - 0.01) {
    return null;
  }

  const splitClipSec = mapped.clipLocalSec;
  if (
    splitClipSec - item.segment.startSec < EDITOR_MIN_TRIM_SEC ||
    item.segment.endSec - splitClipSec < EDITOR_MIN_TRIM_SEC
  ) {
    return null;
  }

  return { segment: item.segment, splitClipSec };
}

export function splitSegmentPair(
  seg: EditorSegment,
  splitClipSec: number
): [EditorSegment, EditorSegment] {
  const leftSeg: EditorSegment = {
    ...seg,
    endSec: splitClipSec,
    audioMix: seg.audioMix.map((m) => ({ ...m })),
    transitionOut: "cut",
    transitionOutDurationSec: 0,
  };
  const rightSeg: EditorSegment = {
    ...seg,
    id: makeEditorSegmentId(),
    startSec: splitClipSec,
    audioMix: seg.audioMix.map((m) => ({ ...m })),
    transitionIn: "cut",
    transitionInDurationSec: 0,
  };
  return [leftSeg, rightSeg];
}

export function estimateEditorExportBytes(
  segments: EditorSegment[],
  totalDurationSec: number,
  preset: EditorExportPreset
): number {
  if (totalDurationSec <= 0 || segments.length === 0) return 0;
  let totalSourceBytes = 0;
  for (const seg of segments) {
    const clipDur = seg.clip.durationSec > 0 ? seg.clip.durationSec : getSegmentRawDuration(seg);
    const ratio = Math.min(1, Math.max(0.01, getSegmentRawDuration(seg) / clipDur));
    totalSourceBytes += (seg.clip.fileSizeBytes || 0) * ratio;
  }
  const mappedPreset =
    preset === "discord_10mb"
      ? "discord_10mb"
      : preset === "discord_25mb"
        ? "discord_25mb"
        : "lossless_trim";
  return estimateExportBytes(totalDurationSec, Math.round(totalSourceBytes), totalDurationSec, mappedPreset);
}
