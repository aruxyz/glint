import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../lib/api";
import {
  clampSaturation,
  clampVibrance,
  computeTimelineLayout,
  createAudioLayerFromProbed,
  createSegmentFromClip,
  EDITOR_MIN_TRIM_SEC,
  makeEditorSegmentId,
  normalizeEditorAudioLayer,
  normalizeEditorFraming,
  normalizeEditorSegment,
  sanitizeTransitions,
  splitSegmentPair,
} from "../lib/editor";
import type {
  AudioTrackMix,
  ClipSummary,
  EditorAudioLayer,
  EditorAudioLayerData,
  EditorExportOptions,
  EditorProjectDetail,
  EditorProjectSegmentData,
  EditorProjectSummary,
  EditorSegment,
  ProbedAudioFile,
} from "../lib/types";

const EDITOR_SEGMENTS_LEGACY_KEY = "glint_editor_segments_v1";
const EDITOR_WORKSPACE_STORAGE_KEY = "glint_editor_workspace_v2";
const MAX_HISTORY_STEPS = 40;

export const DEFAULT_EDITOR_EXPORT_OPTIONS: EditorExportOptions = {
  preset: "original",
  vertical916: false,
  verticalStyle: "blur",
  normalizeAudio: false,
  copyToClipboard: true,
  addToLibrary: true,
  outputName: "",
};

interface StoredEditorWorkspace {
  version: 2;
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeProjectUpdatedAt: string | null;
  savedBaselineJson: string | null;
  segments: EditorSegment[];
  audioLayers?: EditorAudioLayer[];
  exportOptions: EditorExportOptions;
}

interface EditorHistorySnapshot {
  segments: EditorSegment[];
  audioLayers: EditorAudioLayer[];
  selectedSegmentIds: string[];
  primarySelectedSegmentId: string | null;
  selectedAudioLayerId: string | null;
}

interface EditorHistoryState {
  past: EditorHistorySnapshot[];
  future: EditorHistorySnapshot[];
}

function cloneSegments(segments: EditorSegment[]): EditorSegment[] {
  return segments.map((s) => ({
    ...s,
    audioMix: s.audioMix.map((m) => ({ ...m })),
  }));
}

function cloneAudioLayers(layers: EditorAudioLayer[]): EditorAudioLayer[] {
  return layers.map((l) => ({ ...l }));
}

function makeSnapshot(
  segments: EditorSegment[],
  audioLayers: EditorAudioLayer[],
  selectedSegmentIds: string[],
  primarySelectedSegmentId: string | null,
  selectedAudioLayerId: string | null
): EditorHistorySnapshot {
  return {
    segments: cloneSegments(segments),
    audioLayers: cloneAudioLayers(audioLayers),
    selectedSegmentIds: [...selectedSegmentIds],
    primarySelectedSegmentId,
    selectedAudioLayerId,
  };
}

function applySegmentPatch(seg: EditorSegment, patch: Partial<EditorSegment>): EditorSegment {
  const next: EditorSegment = {
    ...seg,
    ...patch,
    audioMix: patch.audioMix ? patch.audioMix.map((m) => ({ ...m })) : seg.audioMix,
  };
  const maxDur = Math.max(EDITOR_MIN_TRIM_SEC, next.clip.durationSec || EDITOR_MIN_TRIM_SEC);
  const startSec = Math.max(0, Math.min(next.startSec, maxDur - EDITOR_MIN_TRIM_SEC));
  const endSec = Math.max(startSec + EDITOR_MIN_TRIM_SEC, Math.min(maxDur, next.endSec));
  return {
    ...next,
    startSec,
    endSec,
    vibrance: clampVibrance(next.vibrance),
    saturation: clampSaturation(next.saturation),
    framing: normalizeEditorFraming(next.framing),
  };
}

function reconcileSelection(
  segments: EditorSegment[],
  selectedIds: string[],
  primaryId: string | null
): { selectedSegmentIds: string[]; primarySelectedSegmentId: string | null } {
  if (segments.length === 0) {
    return { selectedSegmentIds: [], primarySelectedSegmentId: null };
  }
  const validSet = new Set(segments.map((s) => s.id));
  const filtered = selectedIds.filter((id) => validSet.has(id));
  if (filtered.length === 0) {
    const fallback = segments[0].id;
    return { selectedSegmentIds: [fallback], primarySelectedSegmentId: fallback };
  }
  const nextPrimary =
    primaryId && filtered.includes(primaryId)
      ? primaryId
      : filtered[filtered.length - 1];
  return { selectedSegmentIds: filtered, primarySelectedSegmentId: nextPrimary };
}

function normalizeExportOptions(raw: unknown): EditorExportOptions {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_EDITOR_EXPORT_OPTIONS };
  }
  const obj = raw as Partial<EditorExportOptions>;
  return {
    preset:
      obj.preset === "discord_10mb" || obj.preset === "discord_25mb"
        ? obj.preset
        : "original",
    vertical916: Boolean(obj.vertical916),
    verticalStyle: obj.verticalStyle === "crop" ? "crop" : "blur",
    normalizeAudio: Boolean(obj.normalizeAudio),
    copyToClipboard:
      typeof obj.copyToClipboard === "boolean"
        ? obj.copyToClipboard
        : DEFAULT_EDITOR_EXPORT_OPTIONS.copyToClipboard,
    addToLibrary:
      typeof obj.addToLibrary === "boolean"
        ? obj.addToLibrary
        : DEFAULT_EDITOR_EXPORT_OPTIONS.addToLibrary,
    outputName: typeof obj.outputName === "string" ? obj.outputName : "",
  };
}

export function serializeProjectState(
  segments: EditorSegment[],
  exportOptions: EditorExportOptions,
  audioLayers: EditorAudioLayer[] = []
): string {
  return JSON.stringify({
    segments: segments.map((seg) => ({
      clipId: seg.clipId,
      startSec: Number(seg.startSec.toFixed(4)),
      endSec: Number(seg.endSec.toFixed(4)),
      speed: seg.speed,
      audioMix: seg.audioMix.map((m) => ({
        trackOrder: m.trackOrder,
        streamIndex: m.streamIndex,
        muted: Boolean(m.muted),
        volume: Number(m.volume.toFixed(4)),
      })),
      masterVolume: Number(seg.masterVolume.toFixed(2)),
      masterMuted: Boolean(seg.masterMuted),
      transitionIn: seg.transitionIn,
      transitionInDurationSec: Number((seg.transitionInDurationSec ?? 0).toFixed(3)),
      transitionOut: seg.transitionOut ?? "cut",
      transitionOutDurationSec: Number((seg.transitionOutDurationSec ?? 0).toFixed(3)),
      vibrance: clampVibrance(seg.vibrance),
      saturation: clampSaturation(seg.saturation),
      framing: normalizeEditorFraming(seg.framing),
    })),
    audioLayers: audioLayers.map((layer) => ({
      filePath: layer.filePath,
      timelineOffsetSec: Number(layer.timelineOffsetSec.toFixed(4)),
      trimStartSec: Number(layer.trimStartSec.toFixed(4)),
      trimEndSec: Number(layer.trimEndSec.toFixed(4)),
      volume: Number(layer.volume.toFixed(2)),
      muted: Boolean(layer.muted),
    })),
    exportOptions: {
      preset: exportOptions.preset,
      vertical916: exportOptions.vertical916,
      verticalStyle: exportOptions.verticalStyle,
      normalizeAudio: exportOptions.normalizeAudio,
      copyToClipboard: exportOptions.copyToClipboard,
      addToLibrary: exportOptions.addToLibrary,
      outputName: exportOptions.outputName,
    },
  });
}

function toProjectAudioLayerData(layer: EditorAudioLayer): EditorAudioLayerData {
  return {
    id: layer.id,
    filePath: layer.filePath,
    title: layer.title,
    durationSec: layer.durationSec,
    timelineOffsetSec: layer.timelineOffsetSec,
    trimStartSec: layer.trimStartSec,
    trimEndSec: layer.trimEndSec,
    volume: layer.volume,
    muted: layer.muted,
  };
}

function normalizeAudioLayerList(raw: unknown): EditorAudioLayer[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (l): l is EditorAudioLayer =>
        Boolean(l && typeof l.id === "string" && typeof l.filePath === "string")
    )
    .map(normalizeEditorAudioLayer);
}

function toProjectSegmentData(seg: EditorSegment): EditorProjectSegmentData {
  return {
    id: seg.id,
    clipId: seg.clipId,
    startSec: seg.startSec,
    endSec: seg.endSec,
    speed: seg.speed,
    audioMix: seg.audioMix.map((m) => ({ ...m })),
    masterVolume: seg.masterVolume,
    masterMuted: seg.masterMuted,
    transitionIn: seg.transitionIn,
    transitionInDurationSec: seg.transitionInDurationSec ?? 0,
    transitionOut: seg.transitionOut ?? "cut",
    transitionOutDurationSec: seg.transitionOutDurationSec ?? 0,
    vibrance: clampVibrance(seg.vibrance),
    saturation: clampSaturation(seg.saturation),
    framing: normalizeEditorFraming(seg.framing),
    clipSnapshot: {
      title: seg.clip.title ?? null,
      fileName: seg.clip.fileName,
      durationSec: seg.clip.durationSec,
      gameName: seg.clip.gameName,
    },
  };
}

function normalizeSegmentList(raw: unknown): EditorSegment[] {
  if (!Array.isArray(raw)) return [];
  const valid = raw
    .filter(
      (s): s is EditorSegment =>
        Boolean(s && typeof s.id === "string" && typeof s.clipId === "string" && s.clip)
    )
    .map(normalizeEditorSegment);
  return sanitizeTransitions(valid);
}

function loadSavedWorkspace(): StoredEditorWorkspace {
  const empty: StoredEditorWorkspace = {
    version: 2,
    activeProjectId: null,
    activeProjectName: null,
    activeProjectUpdatedAt: null,
    savedBaselineJson: null,
    segments: [],
    audioLayers: [],
    exportOptions: { ...DEFAULT_EDITOR_EXPORT_OPTIONS },
  };
  try {
    const rawV2 = window.localStorage.getItem(EDITOR_WORKSPACE_STORAGE_KEY);
    if (rawV2) {
      const parsed = JSON.parse(rawV2) as Partial<StoredEditorWorkspace>;
      const segments = normalizeSegmentList(parsed.segments);
      const audioLayers = normalizeAudioLayerList(parsed.audioLayers);
      return {
        version: 2,
        activeProjectId: typeof parsed.activeProjectId === "string" ? parsed.activeProjectId : null,
        activeProjectName:
          typeof parsed.activeProjectName === "string" ? parsed.activeProjectName : null,
        activeProjectUpdatedAt:
          typeof parsed.activeProjectUpdatedAt === "string"
            ? parsed.activeProjectUpdatedAt
            : null,
        savedBaselineJson:
          typeof parsed.savedBaselineJson === "string" ? parsed.savedBaselineJson : null,
        segments,
        audioLayers,
        exportOptions: normalizeExportOptions(parsed.exportOptions),
      };
    }

    const rawLegacy = window.localStorage.getItem(EDITOR_SEGMENTS_LEGACY_KEY);
    if (!rawLegacy) return empty;
    const legacySegments = normalizeSegmentList(JSON.parse(rawLegacy));
    return {
      ...empty,
      segments: legacySegments,
    };
  } catch {
    return empty;
  }
}

export function useEditorWorkspace() {
  const [initialWorkspace] = useState<StoredEditorWorkspace>(loadSavedWorkspace);
  const [editorMode, setEditorMode] = useState(false);
  const [editorSegments, setEditorSegments] = useState<EditorSegment[]>(
    () => initialWorkspace.segments
  );
  const [audioLayers, setAudioLayers] = useState<EditorAudioLayer[]>(
    () => initialWorkspace.audioLayers ?? []
  );
  const [exportOptions, setExportOptionsState] = useState<EditorExportOptions>(
    () => initialWorkspace.exportOptions
  );
  const [activeProjectId, setActiveProjectId] = useState<string | null>(
    () => initialWorkspace.activeProjectId
  );
  const [activeProjectName, setActiveProjectName] = useState<string | null>(
    () => initialWorkspace.activeProjectName
  );
  const [activeProjectUpdatedAt, setActiveProjectUpdatedAt] = useState<string | null>(
    () => initialWorkspace.activeProjectUpdatedAt
  );
  const [savedBaselineJson, setSavedBaselineJson] = useState<string | null>(
    () => initialWorkspace.savedBaselineJson
  );
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<string[]>(() =>
    initialWorkspace.segments[0] ? [initialWorkspace.segments[0].id] : []
  );
  const [primarySelectedSegmentId, setPrimarySelectedSegmentId] = useState<string | null>(
    () => initialWorkspace.segments[0]?.id ?? null
  );
  const [selectedAudioLayerId, setSelectedAudioLayerId] = useState<string | null>(
    () => initialWorkspace.audioLayers?.[0]?.id ?? null
  );
  const [history, setHistory] = useState<EditorHistoryState>({ past: [], future: [] });

  const segmentsRef = useRef(editorSegments);
  segmentsRef.current = editorSegments;
  const audioLayersRef = useRef(audioLayers);
  audioLayersRef.current = audioLayers;
  const exportOptionsRef = useRef(exportOptions);
  exportOptionsRef.current = exportOptions;
  const selectedIdsRef = useRef(selectedSegmentIds);
  selectedIdsRef.current = selectedSegmentIds;
  const primaryIdRef = useRef(primarySelectedSegmentId);
  primaryIdRef.current = primarySelectedSegmentId;
  const selectedAudioLayerIdRef = useRef(selectedAudioLayerId);
  selectedAudioLayerIdRef.current = selectedAudioLayerId;
  const transactionBaseRef = useRef<EditorHistorySnapshot | null>(null);

  const currentCanonical = useMemo(
    () => serializeProjectState(editorSegments, exportOptions, audioLayers),
    [audioLayers, editorSegments, exportOptions]
  );

  const isDirty = useMemo(() => {
    if (activeProjectId !== null) {
      return currentCanonical !== savedBaselineJson;
    }
    return editorSegments.length > 0 || audioLayers.length > 0;
  }, [activeProjectId, audioLayers.length, currentCanonical, editorSegments.length, savedBaselineJson]);

  useEffect(() => {
    try {
      const payload: StoredEditorWorkspace = {
        version: 2,
        activeProjectId,
        activeProjectName,
        activeProjectUpdatedAt,
        savedBaselineJson,
        segments: editorSegments,
        audioLayers,
        exportOptions,
      };
      window.localStorage.setItem(
        EDITOR_WORKSPACE_STORAGE_KEY,
        JSON.stringify(payload)
      );
    } catch {
      // Ignore storage persistence errors.
    }
  }, [
    activeProjectId,
    activeProjectName,
    activeProjectUpdatedAt,
    audioLayers,
    editorSegments,
    exportOptions,
    savedBaselineJson,
  ]);

  useEffect(() => {
    const reconciled = reconcileSelection(
      editorSegments,
      selectedSegmentIds,
      primarySelectedSegmentId
    );
    const idsChanged =
      reconciled.selectedSegmentIds.length !== selectedSegmentIds.length ||
      reconciled.selectedSegmentIds.some((id, i) => id !== selectedSegmentIds[i]);
    if (idsChanged) {
      setSelectedSegmentIds(reconciled.selectedSegmentIds);
    }
    if (reconciled.primarySelectedSegmentId !== primarySelectedSegmentId) {
      setPrimarySelectedSegmentId(reconciled.primarySelectedSegmentId);
    }
  }, [editorSegments, primarySelectedSegmentId, selectedSegmentIds]);

  const pushSnapshot = useCallback((snapshot: EditorHistorySnapshot) => {
    setHistory((prev) => ({
      past: [...prev.past.slice(-(MAX_HISTORY_STEPS - 1)), snapshot],
      future: [],
    }));
  }, []);

  const beginHistoryTransaction = useCallback(() => {
    if (transactionBaseRef.current) return;
    transactionBaseRef.current = makeSnapshot(
      segmentsRef.current,
      audioLayersRef.current,
      selectedIdsRef.current,
      primaryIdRef.current,
      selectedAudioLayerIdRef.current
    );
  }, []);

  const commitHistoryTransaction = useCallback(() => {
    const base = transactionBaseRef.current;
    transactionBaseRef.current = null;
    if (!base) return;
    const prevJson = JSON.stringify({
      segments: base.segments,
      audioLayers: base.audioLayers,
    });
    const currJson = JSON.stringify({
      segments: segmentsRef.current,
      audioLayers: audioLayersRef.current,
    });
    if (prevJson === currJson) return;
    pushSnapshot(base);
  }, [pushSnapshot]);

  const commitChange = useCallback(
    (
      nextSegments: EditorSegment[],
      nextSelection?: {
        selectedSegmentIds: string[];
        primarySelectedSegmentId: string | null;
      },
      recordHistory = true
    ) => {
      if (recordHistory && !transactionBaseRef.current) {
        pushSnapshot(
          makeSnapshot(
            segmentsRef.current,
            audioLayersRef.current,
            selectedIdsRef.current,
            primaryIdRef.current,
            selectedAudioLayerIdRef.current
          )
        );
      }
      const sanitized = sanitizeTransitions(nextSegments);
      segmentsRef.current = sanitized;
      setEditorSegments(sanitized);
      if (nextSelection) {
        selectedIdsRef.current = nextSelection.selectedSegmentIds;
        primaryIdRef.current = nextSelection.primarySelectedSegmentId;
        setSelectedSegmentIds(nextSelection.selectedSegmentIds);
        setPrimarySelectedSegmentId(nextSelection.primarySelectedSegmentId);
      }
    },
    [pushSnapshot]
  );

  const commitAudioLayers = useCallback(
    (
      nextLayers: EditorAudioLayer[],
      nextSelectedAudioId?: string | null,
      recordHistory = true
    ) => {
      if (recordHistory && !transactionBaseRef.current) {
        pushSnapshot(
          makeSnapshot(
            segmentsRef.current,
            audioLayersRef.current,
            selectedIdsRef.current,
            primaryIdRef.current,
            selectedAudioLayerIdRef.current
          )
        );
      }
      const normalized = nextLayers.map(normalizeEditorAudioLayer);
      audioLayersRef.current = normalized;
      setAudioLayers(normalized);
      if (nextSelectedAudioId !== undefined) {
        selectedAudioLayerIdRef.current = nextSelectedAudioId;
        setSelectedAudioLayerId(nextSelectedAudioId);
      }
    },
    [pushSnapshot]
  );

  const selectAudioLayer = useCallback((layerId: string | null) => {
    selectedAudioLayerIdRef.current = layerId;
    setSelectedAudioLayerId(layerId);
  }, []);

  const addAudioLayer = useCallback(
    (probed: ProbedAudioFile, initialOffsetSec = 0): EditorAudioLayer => {
      const layer = createAudioLayerFromProbed(probed, initialOffsetSec);
      const next = [...audioLayersRef.current, layer];
      commitAudioLayers(next, layer.id, true);
      return layer;
    },
    [commitAudioLayers]
  );

  const updateAudioLayer = useCallback(
    (
      layerId: string,
      patch: Partial<EditorAudioLayer>,
      options?: { recordHistory?: boolean }
    ) => {
      const next = audioLayersRef.current.map((layer) =>
        layer.id === layerId ? normalizeEditorAudioLayer({ ...layer, ...patch }) : layer
      );
      commitAudioLayers(next, undefined, options?.recordHistory ?? true);
    },
    [commitAudioLayers]
  );

  const removeAudioLayer = useCallback(
    (layerId: string) => {
      const remaining = audioLayersRef.current.filter((l) => l.id !== layerId);
      const nextSelected =
        selectedAudioLayerIdRef.current === layerId
          ? remaining[0]?.id ?? null
          : selectedAudioLayerIdRef.current;
      commitAudioLayers(remaining, nextSelected, true);
    },
    [commitAudioLayers]
  );

  const selectSegment = useCallback((segmentId: string | null) => {
    if (!segmentId) {
      setSelectedSegmentIds([]);
      setPrimarySelectedSegmentId(null);
      return;
    }
    setSelectedSegmentIds([segmentId]);
    setPrimarySelectedSegmentId(segmentId);
  }, []);

  const toggleSelectSegment = useCallback((segmentId: string) => {
    const current = selectedIdsRef.current;
    const exists = current.includes(segmentId);
    let nextIds: string[];
    let nextPrimary: string | null = primaryIdRef.current;

    if (exists) {
      nextIds = current.filter((id) => id !== segmentId);
      if (nextPrimary === segmentId) {
        nextPrimary = nextIds.length > 0 ? nextIds[nextIds.length - 1] : null;
      }
    } else {
      nextIds = [...current, segmentId];
      nextPrimary = segmentId;
    }

    setSelectedSegmentIds(nextIds);
    setPrimarySelectedSegmentId(nextPrimary);
  }, []);

  const selectRangeSegments = useCallback((targetSegmentId: string) => {
    const segs = segmentsRef.current;
    const targetIdx = segs.findIndex((s) => s.id === targetSegmentId);
    if (targetIdx < 0) return;

    const anchorId = primaryIdRef.current ?? selectedIdsRef.current[0] ?? targetSegmentId;
    const anchorIdx = segs.findIndex((s) => s.id === anchorId);
    const startIdx = anchorIdx >= 0 ? Math.min(anchorIdx, targetIdx) : targetIdx;
    const endIdx = anchorIdx >= 0 ? Math.max(anchorIdx, targetIdx) : targetIdx;

    const rangeIds = segs.slice(startIdx, endIdx + 1).map((s) => s.id);
    setSelectedSegmentIds(rangeIds);
    setPrimarySelectedSegmentId(targetSegmentId);
  }, []);

  const selectAllSegments = useCallback(() => {
    const segs = segmentsRef.current;
    if (segs.length === 0) return;
    setSelectedSegmentIds(segs.map((s) => s.id));
    setPrimarySelectedSegmentId((prev) =>
      prev && segs.some((s) => s.id === prev) ? prev : segs[0].id
    );
  }, []);

  const clearSegmentSelection = useCallback(() => {
    const segs = segmentsRef.current;
    if (segs.length === 0) {
      setSelectedSegmentIds([]);
      setPrimarySelectedSegmentId(null);
      return;
    }
    const keepId =
      (primaryIdRef.current && segs.some((s) => s.id === primaryIdRef.current)
        ? primaryIdRef.current
        : null) ??
      selectedIdsRef.current.find((id) => segs.some((s) => s.id === id)) ??
      segs[0].id;
    setSelectedSegmentIds([keepId]);
    setPrimarySelectedSegmentId(keepId);
  }, []);

  const addSegmentFromPlayer = useCallback(
    (params: {
      clip: ClipSummary;
      startSec: number;
      endSec: number;
      audioMix: AudioTrackMix[];
      masterVolume: number;
      masterMuted: boolean;
    }): { segment: EditorSegment; nextCount: number } => {
      const segment = createSegmentFromClip(params.clip, {
        startSec: params.startSec,
        endSec: params.endSec,
        audioMix: params.audioMix,
        masterVolume: params.masterVolume,
        masterMuted: params.masterMuted,
        transitionIn: "cut",
      });
      const nextList = [...segmentsRef.current, segment];
      commitChange(
        nextList,
        {
          selectedSegmentIds: [segment.id],
          primarySelectedSegmentId: segment.id,
        },
        true
      );
      return { segment, nextCount: nextList.length };
    },
    [commitChange]
  );

  const addClipsFromLibrary = useCallback(
    (clipsToAdd: ClipSummary[]) => {
      if (clipsToAdd.length === 0) return;
      const created = clipsToAdd.map((clip) => createSegmentFromClip(clip));
      commitChange(
        [...segmentsRef.current, ...created],
        {
          selectedSegmentIds: [created[0].id],
          primarySelectedSegmentId: created[0].id,
        },
        true
      );
    },
    [commitChange]
  );

  const updateSegment = useCallback(
    (
      segmentId: string,
      patch: Partial<EditorSegment>,
      options?: { recordHistory?: boolean }
    ) => {
      const next = segmentsRef.current.map((seg) =>
        seg.id === segmentId ? applySegmentPatch(seg, patch) : seg
      );
      commitChange(next, undefined, options?.recordHistory ?? true);
    },
    [commitChange]
  );

  const updateSegments = useCallback(
    (
      segmentIds: string[],
      patch: Partial<EditorSegment>,
      options?: { recordHistory?: boolean }
    ) => {
      if (segmentIds.length === 0) return;
      const idSet = new Set(segmentIds);
      const next = segmentsRef.current.map((seg) =>
        idSet.has(seg.id) ? applySegmentPatch(seg, patch) : seg
      );
      commitChange(next, undefined, options?.recordHistory ?? true);
    },
    [commitChange]
  );

  const splitSegment = useCallback(
    (segmentId: string, splitClipSec: number): EditorSegment | null => {
      const segs = segmentsRef.current;
      const idx = segs.findIndex((s) => s.id === segmentId);
      if (idx < 0) return null;
      const target = segs[idx];
      if (
        splitClipSec - target.startSec < EDITOR_MIN_TRIM_SEC ||
        target.endSec - splitClipSec < EDITOR_MIN_TRIM_SEC
      ) {
        return null;
      }
      const [leftSeg, rightSeg] = splitSegmentPair(target, splitClipSec);
      const next = [...segs];
      next.splice(idx, 1, leftSeg, rightSeg);
      commitChange(
        next,
        {
          selectedSegmentIds: [rightSeg.id],
          primarySelectedSegmentId: rightSeg.id,
        },
        true
      );
      return rightSeg;
    },
    [commitChange]
  );

  const moveSegment = useCallback(
    (index: number, delta: -1 | 1) => {
      const segs = segmentsRef.current;
      const targetIndex = index + delta;
      if (index < 0 || index >= segs.length || targetIndex < 0 || targetIndex >= segs.length) {
        return;
      }
      const next = [...segs];
      const [moved] = next.splice(index, 1);
      next.splice(targetIndex, 0, moved);
      commitChange(next, undefined, true);
    },
    [commitChange]
  );

  const reorderSegment = useCallback(
    (fromIndex: number, toIndex: number) => {
      const segs = segmentsRef.current;
      if (
        fromIndex < 0 ||
        fromIndex >= segs.length ||
        toIndex < 0 ||
        toIndex >= segs.length ||
        fromIndex === toIndex
      ) {
        return;
      }
      const next = [...segs];
      const [moved] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, moved);
      commitChange(next, undefined, true);
    },
    [commitChange]
  );

  const duplicateSegment = useCallback(
    (index: number) => {
      const segs = segmentsRef.current;
      const source = segs[index];
      if (!source) return;
      const copy: EditorSegment = {
        ...source,
        id: makeEditorSegmentId(),
        audioMix: source.audioMix.map((m) => ({ ...m })),
        transitionIn: "cut",
        transitionInDurationSec: 0,
        transitionOut: "cut",
        transitionOutDurationSec: 0,
      };
      const next = [...segs];
      next.splice(index + 1, 0, copy);
      commitChange(
        next,
        {
          selectedSegmentIds: [copy.id],
          primarySelectedSegmentId: copy.id,
        },
        true
      );
    },
    [commitChange]
  );

  const removeSegment = useCallback(
    (segmentId: string) => {
      const remaining = segmentsRef.current.filter((s) => s.id !== segmentId);
      const reconciled = reconcileSelection(
        remaining,
        selectedIdsRef.current.filter((id) => id !== segmentId),
        primaryIdRef.current === segmentId ? null : primaryIdRef.current
      );
      commitChange(remaining, reconciled, true);
    },
    [commitChange]
  );

  const removeSegments = useCallback(
    (segmentIds: string[]) => {
      if (segmentIds.length === 0) return;
      const removeSet = new Set(segmentIds);
      const remaining = segmentsRef.current.filter((s) => !removeSet.has(s.id));
      const reconciled = reconcileSelection(
        remaining,
        selectedIdsRef.current.filter((id) => !removeSet.has(id)),
        primaryIdRef.current && removeSet.has(primaryIdRef.current)
          ? null
          : primaryIdRef.current
      );
      commitChange(remaining, reconciled, true);
    },
    [commitChange]
  );

  const clearSegments = useCallback(() => {
    if (segmentsRef.current.length === 0) return;
    commitChange(
      [],
      {
        selectedSegmentIds: [],
        primarySelectedSegmentId: null,
      },
      true
    );
  }, [commitChange]);

  const applyHistoryTarget = useCallback(
    (target: EditorHistorySnapshot) => {
      const restoredSegments = sanitizeTransitions(cloneSegments(target.segments));
      const restoredAudioLayers = cloneAudioLayers(target.audioLayers ?? []).map(
        normalizeEditorAudioLayer
      );
      const reconciled = reconcileSelection(
        restoredSegments,
        target.selectedSegmentIds,
        target.primarySelectedSegmentId
      );
      const validAudioIds = new Set(restoredAudioLayers.map((l) => l.id));
      const nextAudioSelected =
        target.selectedAudioLayerId && validAudioIds.has(target.selectedAudioLayerId)
          ? target.selectedAudioLayerId
          : restoredAudioLayers[0]?.id ?? null;

      segmentsRef.current = restoredSegments;
      audioLayersRef.current = restoredAudioLayers;
      selectedIdsRef.current = reconciled.selectedSegmentIds;
      primaryIdRef.current = reconciled.primarySelectedSegmentId;
      selectedAudioLayerIdRef.current = nextAudioSelected;

      setEditorSegments(restoredSegments);
      setAudioLayers(restoredAudioLayers);
      setSelectedSegmentIds(reconciled.selectedSegmentIds);
      setPrimarySelectedSegmentId(reconciled.primarySelectedSegmentId);
      setSelectedAudioLayerId(nextAudioSelected);
    },
    []
  );

  const undo = useCallback(() => {
    transactionBaseRef.current = null;
    setHistory((prev) => {
      if (prev.past.length === 0) return prev;
      const target = prev.past[prev.past.length - 1];
      const currentSnapshot = makeSnapshot(
        segmentsRef.current,
        audioLayersRef.current,
        selectedIdsRef.current,
        primaryIdRef.current,
        selectedAudioLayerIdRef.current
      );
      applyHistoryTarget(target);
      return {
        past: prev.past.slice(0, -1),
        future: [currentSnapshot, ...prev.future].slice(0, MAX_HISTORY_STEPS),
      };
    });
  }, [applyHistoryTarget]);

  const redo = useCallback(() => {
    transactionBaseRef.current = null;
    setHistory((prev) => {
      if (prev.future.length === 0) return prev;
      const target = prev.future[0];
      const currentSnapshot = makeSnapshot(
        segmentsRef.current,
        audioLayersRef.current,
        selectedIdsRef.current,
        primaryIdRef.current,
        selectedAudioLayerIdRef.current
      );
      applyHistoryTarget(target);
      return {
        past: [...prev.past.slice(-(MAX_HISTORY_STEPS - 1)), currentSnapshot],
        future: prev.future.slice(1),
      };
    });
  }, [applyHistoryTarget]);

  const setExportOptions = useCallback(
    (
      updater:
        | Partial<EditorExportOptions>
        | ((prev: EditorExportOptions) => EditorExportOptions)
    ) => {
      setExportOptionsState((prev) =>
        typeof updater === "function" ? updater(prev) : { ...prev, ...updater }
      );
    },
    []
  );

  const saveProjectWithName = useCallback(
    async (
      name: string,
      options?: { asNew?: boolean }
    ): Promise<EditorProjectSummary> => {
      const currentSegments = segmentsRef.current;
      const currentAudioLayers = audioLayersRef.current;
      const currentExportOptions = exportOptionsRef.current;
      const layout = computeTimelineLayout(currentSegments);
      const targetId = options?.asNew ? null : activeProjectId;

      const summary = await api.saveEditorProject({
        id: targetId,
        name: name.trim(),
        segmentCount: currentSegments.length,
        totalDurationSec: layout.totalDurationSec,
        data: {
          version: 2,
          segments: currentSegments.map(toProjectSegmentData),
          audioLayers: currentAudioLayers.map(toProjectAudioLayerData),
          exportOptions: { ...currentExportOptions },
        },
      });

      const baseline = serializeProjectState(
        currentSegments,
        currentExportOptions,
        currentAudioLayers
      );
      setActiveProjectId(summary.id);
      setActiveProjectName(summary.name);
      setActiveProjectUpdatedAt(summary.updatedAt);
      setSavedBaselineJson(baseline);
      return summary;
    },
    [activeProjectId]
  );

  const saveCurrentProject = useCallback(async (): Promise<EditorProjectSummary | null> => {
    if (!activeProjectId || !activeProjectName) return null;
    return saveProjectWithName(activeProjectName, { asNew: false });
  }, [activeProjectId, activeProjectName, saveProjectWithName]);

  const openLoadedProject = useCallback(
    (project: EditorProjectDetail, options?: { markDirty?: boolean }) => {
      const sanitized = sanitizeTransitions(
        project.segments.map((seg) => normalizeEditorSegment(seg))
      );
      const normalizedAudio = (project.audioLayers ?? []).map(normalizeEditorAudioLayer);
      const normalizedOpts = normalizeExportOptions(project.exportOptions);
      const firstId = sanitized[0]?.id ?? null;
      const firstAudioId = normalizedAudio[0]?.id ?? null;

      transactionBaseRef.current = null;
      setHistory({ past: [], future: [] });
      segmentsRef.current = sanitized;
      audioLayersRef.current = normalizedAudio;
      exportOptionsRef.current = normalizedOpts;
      selectedIdsRef.current = firstId ? [firstId] : [];
      primaryIdRef.current = firstId;
      selectedAudioLayerIdRef.current = firstAudioId;

      setEditorSegments(sanitized);
      setAudioLayers(normalizedAudio);
      setExportOptionsState(normalizedOpts);
      setSelectedSegmentIds(firstId ? [firstId] : []);
      setPrimarySelectedSegmentId(firstId);
      setSelectedAudioLayerId(firstAudioId);
      setActiveProjectId(project.id);
      setActiveProjectName(project.name);
      setActiveProjectUpdatedAt(project.updatedAt);
      setSavedBaselineJson(
        options?.markDirty
          ? "__missing_clips_dirty__"
          : serializeProjectState(sanitized, normalizedOpts, normalizedAudio)
      );
    },
    []
  );

  const startNewProject = useCallback(() => {
    transactionBaseRef.current = null;
    setHistory({ past: [], future: [] });
    segmentsRef.current = [];
    audioLayersRef.current = [];
    exportOptionsRef.current = { ...DEFAULT_EDITOR_EXPORT_OPTIONS };
    selectedIdsRef.current = [];
    primaryIdRef.current = null;
    selectedAudioLayerIdRef.current = null;

    setEditorSegments([]);
    setAudioLayers([]);
    setExportOptionsState({ ...DEFAULT_EDITOR_EXPORT_OPTIONS });
    setSelectedSegmentIds([]);
    setPrimarySelectedSegmentId(null);
    setSelectedAudioLayerId(null);
    setActiveProjectId(null);
    setActiveProjectName(null);
    setActiveProjectUpdatedAt(null);
    setSavedBaselineJson(null);
  }, []);

  const unlinkActiveProject = useCallback(() => {
    setActiveProjectId(null);
    setActiveProjectName(null);
    setActiveProjectUpdatedAt(null);
    setSavedBaselineJson(null);
  }, []);

  return {
    editorMode,
    setEditorMode,
    editorSegments,
    audioLayers,
    selectedAudioLayerId,
    exportOptions,
    setExportOptions,
    activeProjectId,
    activeProjectName,
    activeProjectUpdatedAt,
    isDirty,
    selectedSegmentIds,
    primarySelectedSegmentId,
    canUndo: history.past.length > 0,
    canRedo: history.future.length > 0,
    selectSegment,
    toggleSelectSegment,
    selectRangeSegments,
    selectAllSegments,
    clearSegmentSelection,
    selectAudioLayer,
    addAudioLayer,
    updateAudioLayer,
    removeAudioLayer,
    addSegmentFromPlayer,
    addClipsFromLibrary,
    updateSegment,
    updateSegments,
    splitSegment,
    moveSegment,
    reorderSegment,
    duplicateSegment,
    removeSegment,
    removeSegments,
    clearSegments,
    beginHistoryTransaction,
    commitHistoryTransaction,
    undo,
    redo,
    saveCurrentProject,
    saveProjectWithName,
    openLoadedProject,
    startNewProject,
    unlinkActiveProject,
  };
}
