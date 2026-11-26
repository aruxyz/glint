import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { EditorClipPickerModal } from "./editor/EditorClipPickerModal";
import { EditorHeader } from "./editor/EditorHeader";
import { EditorPreviewStage } from "./editor/EditorPreviewStage";
import { EditorTimeline } from "./editor/EditorTimeline";
import { EditorWorkspacePanel } from "./editor/EditorWorkspacePanel";
import { MissingClipsModal } from "./editor/MissingClipsModal";
import { OpenProjectModal } from "./editor/OpenProjectModal";
import { SaveProjectModal } from "./editor/SaveProjectModal";
import { UnsavedChangesModal } from "./editor/UnsavedChangesModal";
import { api } from "../lib/api";
import {
  canEnableCrossfade,
  computeTimelineLayout,
  getSplitTargetAtPlayhead,
  mapTimelineTimeToSegment,
  MIN_TRANSITION_SEC,
} from "../lib/editor";
import type {
  ClipSummary,
  EditorAudioLayer,
  EditorExportOptions,
  EditorProjectDetail,
  EditorProjectSummary,
  EditorSegment,
  EditorWorkspaceTab,
  LoadEditorProjectResult,
  ProbedAudioFile,
  StartEditorExportRequest,
} from "../lib/types";

type PendingProjectAction =
  | { kind: "new" }
  | { kind: "open"; project: EditorProjectSummary };

interface EditorViewProps {
  segments: EditorSegment[];
  audioLayers: EditorAudioLayer[];
  selectedAudioLayerId: string | null;
  exportOptions: EditorExportOptions;
  activeProjectId: string | null;
  activeProjectName: string | null;
  activeProjectUpdatedAt: string | null;
  isDirty: boolean;
  selectedSegmentIds: string[];
  primarySelectedSegmentId: string | null;
  canUndo: boolean;
  canRedo: boolean;
  libraryClips: ClipSummary[];
  streamerBaseUrl: string;
  streamerToken: string;
  encoderInfo: {
    hasNvenc: boolean;
    hasAmf?: boolean;
    hasQsv?: boolean;
    hardwareEncoder?: string | null;
  };
  onChangeExportOptions: (patch: Partial<EditorExportOptions>) => void;
  onSaveCurrentProject: () => Promise<EditorProjectSummary | null>;
  onSaveProjectWithName: (
    name: string,
    options?: { asNew?: boolean }
  ) => Promise<EditorProjectSummary>;
  onOpenLoadedProject: (
    project: EditorProjectDetail,
    options?: { markDirty?: boolean }
  ) => void;
  onStartNewProject: () => void;
  onUnlinkActiveProject: () => void;
  onSelectSegment: (segmentId: string | null) => void;
  onToggleSelectSegment: (segmentId: string) => void;
  onSelectRangeSegments: (segmentId: string) => void;
  onSelectAllSegments: () => void;
  onClearSegmentSelection: () => void;
  onSelectAudioLayer: (layerId: string | null) => void;
  onAddAudioLayer: (probed: ProbedAudioFile, initialOffsetSec?: number) => EditorAudioLayer;
  onUpdateAudioLayer: (
    layerId: string,
    patch: Partial<EditorAudioLayer>,
    options?: { recordHistory?: boolean }
  ) => void;
  onRemoveAudioLayer: (layerId: string) => void;
  onAddClipsFromLibrary: (clips: ClipSummary[]) => void;
  onUpdateSegment: (
    segmentId: string,
    patch: Partial<EditorSegment>,
    options?: { recordHistory?: boolean }
  ) => void;
  onUpdateSegments: (
    segmentIds: string[],
    patch: Partial<EditorSegment>,
    options?: { recordHistory?: boolean }
  ) => void;
  onSplitSegment: (segmentId: string, splitClipSec: number) => EditorSegment | null;
  onBeginHistoryTransaction: () => void;
  onCommitHistoryTransaction: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onMoveSegment: (index: number, delta: -1 | 1) => void;
  onReorderSegment: (fromIndex: number, toIndex: number) => void;
  onDuplicateSegment: (index: number) => void;
  onRemoveSegment: (segmentId: string) => void;
  onRemoveSegments: (segmentIds: string[]) => void;
  onClearSegments: () => void;
  onRequestConfirmClear: (count: number, onConfirm: () => void) => void;
  onRequestConfirmRemoveSelected: (count: number, onConfirm: () => void) => void;
  onStartEditorExport: (request: StartEditorExportRequest) => Promise<void>;
}

const MIN_TIMELINE_HEIGHT_PX = 136;
const MIN_MULTI_TRACK_TIMELINE_HEIGHT_PX = 196;
const MIN_PREVIEW_HEIGHT_PX = 180;

export function EditorView({
  segments,
  audioLayers,
  selectedAudioLayerId,
  exportOptions,
  activeProjectId,
  activeProjectName,
  activeProjectUpdatedAt,
  isDirty,
  selectedSegmentIds,
  primarySelectedSegmentId,
  canUndo,
  canRedo,
  libraryClips,
  streamerBaseUrl,
  streamerToken,
  encoderInfo,
  onChangeExportOptions,
  onSaveCurrentProject,
  onSaveProjectWithName,
  onOpenLoadedProject,
  onStartNewProject,
  onUnlinkActiveProject,
  onSelectSegment,
  onToggleSelectSegment,
  onSelectRangeSegments,
  onSelectAllSegments,
  onClearSegmentSelection,
  onSelectAudioLayer,
  onAddAudioLayer,
  onUpdateAudioLayer,
  onRemoveAudioLayer,
  onAddClipsFromLibrary,
  onUpdateSegment,
  onUpdateSegments,
  onSplitSegment,
  onBeginHistoryTransaction,
  onCommitHistoryTransaction,
  onUndo,
  onRedo,
  onMoveSegment,
  onReorderSegment,
  onDuplicateSegment,
  onRemoveSegment,
  onRemoveSegments,
  onClearSegments,
  onRequestConfirmClear,
  onRequestConfirmRemoveSelected,
  onStartEditorExport,
}: EditorViewProps) {
  const [viewportWidth, setViewportWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 1280
  );
  const [activeTab, setActiveTab] = useState<EditorWorkspaceTab>("segments");
  const [playheadSec, setPlayheadSec] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [timelineHeightPx, setTimelineHeightPx] = useState<number | null>(null);
  const [isResizingSplitter, setIsResizingSplitter] = useState(false);
  const [pulseIcon, setPulseIcon] = useState<"play" | "pause" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [savingDirect, setSavingDirect] = useState(false);
  const [saveModal, setSaveModal] = useState<{
    open: boolean;
    mode: "save" | "save_as";
    initialName: string;
  }>({ open: false, mode: "save", initialName: "" });
  const [saveModalBusy, setSaveModalBusy] = useState(false);
  const [saveModalError, setSaveModalError] = useState<string | null>(null);
  const [openProjectModalOpen, setOpenProjectModalOpen] = useState(false);
  const [openProjectError, setOpenProjectError] = useState<string | null>(null);
  const [unsavedModal, setUnsavedModal] = useState<{
    open: boolean;
    pendingAction: PendingProjectAction | null;
    busy: boolean;
  }>({ open: false, pendingAction: null, busy: false });
  const [pendingAfterSave, setPendingAfterSave] = useState<PendingProjectAction | null>(null);
  const [missingClipsModal, setMissingClipsModal] = useState<{
    open: boolean;
    result: LoadEditorProjectResult | null;
    busy: boolean;
  }>({ open: false, result: null, busy: false });

  const leftColRef = useRef<HTMLDivElement>(null);
  const pulseTimerRef = useRef<number | null>(null);
  const playheadRef = useRef(playheadSec);
  playheadRef.current = playheadSec;
  const splitterDragRef = useRef<{
    startY: number;
    startHeight: number;
    maxHeight: number;
  } | null>(null);

  const minTimelineHeightPx =
    audioLayers.length > 0 ? MIN_MULTI_TRACK_TIMELINE_HEIGHT_PX : MIN_TIMELINE_HEIGHT_PX;

  useEffect(() => {
    const onResize = () => {
      setViewportWidth(window.innerWidth);
      const col = leftColRef.current;
      if (col && timelineHeightPx !== null) {
        const maxH = Math.max(
          minTimelineHeightPx,
          Math.min(Math.floor(col.clientHeight * 0.55), col.clientHeight - MIN_PREVIEW_HEIGHT_PX - 76)
        );
        if (timelineHeightPx > maxH) {
          setTimelineHeightPx(maxH);
        }
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [minTimelineHeightPx, timelineHeightPx]);

  useEffect(() => {
    if (audioLayers.length > 0 && timelineHeightPx !== null && timelineHeightPx < MIN_MULTI_TRACK_TIMELINE_HEIGHT_PX) {
      setTimelineHeightPx(MIN_MULTI_TRACK_TIMELINE_HEIGHT_PX);
    }
  }, [audioLayers.length, timelineHeightPx]);

  const isNarrow = viewportWidth < 840;
  const isMedium = viewportWidth >= 840 && viewportWidth < 1160;

  const layout = useMemo(() => computeTimelineLayout(segments), [segments]);

  useEffect(() => {
    if (playheadSec > layout.totalDurationSec) {
      setPlayheadSec(layout.totalDurationSec);
    }
    if (layout.items.length === 0 && isPlaying) {
      setIsPlaying(false);
    }
  }, [layout.items.length, layout.totalDurationSec, isPlaying, playheadSec]);

  useEffect(() => {
    if (!isPlaying || layout.totalDurationSec <= 0) return;
    let rafId = 0;
    let lastTs = performance.now();

    const step = (now: number) => {
      const dt = Math.min(0.1, Math.max(0, (now - lastTs) / 1000));
      lastTs = now;
      const next = playheadRef.current + dt;
      if (next >= layout.totalDurationSec) {
        playheadRef.current = layout.totalDurationSec;
        setPlayheadSec(layout.totalDurationSec);
        setIsPlaying(false);
        return;
      }
      playheadRef.current = next;
      setPlayheadSec(next);
      rafId = window.requestAnimationFrame(step);
    };

    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [isPlaying, layout.totalDurationSec]);

  const mapped = useMemo(
    () => mapTimelineTimeToSegment(layout, playheadSec, primarySelectedSegmentId),
    [layout, playheadSec, primarySelectedSegmentId]
  );

  const activeItem = mapped.item;
  const activeIndex = activeItem?.index ?? -1;
  const activeSegment = activeItem?.segment ?? null;

  const splitTarget = useMemo(
    () => getSplitTargetAtPlayhead(layout, playheadSec, primarySelectedSegmentId),
    [layout, playheadSec, primarySelectedSegmentId]
  );
  const canSplit = Boolean(splitTarget);

  const outgoingItem =
    activeItem &&
    activeItem.overlapInSec > 0 &&
    mapped.localEffectiveSec < activeItem.overlapInSec &&
    activeItem.index > 0
      ? layout.items[activeItem.index - 1]
      : null;

  const crossfadeProgress =
    outgoingItem && activeItem && activeItem.overlapInSec > 0
      ? Math.max(0, Math.min(1, (playheadSec - activeItem.timelineStart) / activeItem.overlapInSec))
      : null;

  const firstFadeInSec = layout.items[0]?.fadeInSec ?? 0;
  const lastFadeOutSec = layout.items[layout.items.length - 1]?.fadeOutSec ?? 0;
  const fadeInFactor =
    firstFadeInSec >= MIN_TRANSITION_SEC && playheadSec < firstFadeInSec
      ? Math.max(0, Math.min(1, playheadSec / firstFadeInSec))
      : 1;
  const fadeOutFactor =
    lastFadeOutSec >= MIN_TRANSITION_SEC &&
    layout.totalDurationSec > 0 &&
    playheadSec > layout.totalDurationSec - lastFadeOutSec
      ? Math.max(0, Math.min(1, (layout.totalDurationSec - playheadSec) / lastFadeOutSec))
      : 1;
  const edgeFadeOpacity = Math.min(fadeInFactor, fadeOutFactor);

  const outgoingClipLocalTimeSec = outgoingItem
    ? Math.min(
        outgoingItem.segment.endSec,
        outgoingItem.segment.startSec +
          Math.max(0, playheadSec - outgoingItem.timelineStart) * outgoingItem.segment.speed
      )
    : 0;

  const selectedSegments = useMemo(() => {
    const idSet = new Set(selectedSegmentIds);
    return segments.filter((s) => idSet.has(s.id));
  }, [segments, selectedSegmentIds]);

  const selectedIndex = useMemo(
    () => segments.findIndex((s) => s.id === primarySelectedSegmentId),
    [segments, primarySelectedSegmentId]
  );
  const primarySelectedSegment =
    selectedIndex >= 0 ? segments[selectedIndex] : selectedSegments[0] ?? null;
  const selectedLayoutItem =
    selectedIndex >= 0 ? layout.items[selectedIndex] ?? null : null;

  const selectedLocalClipTimeSec = useMemo(() => {
    if (!selectedLayoutItem) return 0;
    const clampedTimeline = Math.max(
      selectedLayoutItem.timelineStart,
      Math.min(selectedLayoutItem.timelineEnd, playheadSec)
    );
    const localEff = clampedTimeline - selectedLayoutItem.timelineStart;
    return Math.min(
      selectedLayoutItem.segment.endSec,
      selectedLayoutItem.segment.startSec +
        localEff * selectedLayoutItem.segment.speed
    );
  }, [playheadSec, selectedLayoutItem]);

  const triggerPulse = useCallback((kind: "play" | "pause") => {
    setPulseIcon(kind);
    if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    pulseTimerRef.current = window.setTimeout(() => setPulseIcon(null), 350);
  }, []);

  useEffect(() => {
    return () => {
      if (pulseTimerRef.current) window.clearTimeout(pulseTimerRef.current);
    };
  }, []);

  const togglePlay = useCallback(() => {
    if (layout.items.length === 0) return;
    setIsPlaying((prev) => {
      if (!prev) {
        if (playheadRef.current >= layout.totalDurationSec - 0.03) {
          playheadRef.current = 0;
          setPlayheadSec(0);
        }
        triggerPulse("play");
        return true;
      }
      triggerPulse("pause");
      return false;
    });
  }, [layout.items.length, layout.totalDurationSec, triggerPulse]);

  const handleSelectWithMode = useCallback(
    (segmentId: string, mode: "single" | "toggle" | "range" = "single") => {
      if (mode === "toggle") {
        onToggleSelectSegment(segmentId);
      } else if (mode === "range") {
        onSelectRangeSegments(segmentId);
      } else {
        onSelectSegment(segmentId);
      }
    },
    [onSelectRangeSegments, onSelectSegment, onToggleSelectSegment]
  );

  const scrubTimeline = useCallback(
    (timelineSec: number, segId?: string) => {
      const clamped = Math.max(0, Math.min(layout.totalDurationSec, timelineSec));
      playheadRef.current = clamped;
      setPlayheadSec(clamped);
      if (segId) {
        onSelectSegment(segId);
      } else {
        const hit = mapTimelineTimeToSegment(layout, clamped);
        if (hit.item) onSelectSegment(hit.item.segment.id);
      }
    },
    [layout, onSelectSegment]
  );

  const jumpToSegment = useCallback(
    (idx: number) => {
      const target = layout.items[idx];
      if (!target) return;
      onSelectSegment(target.segment.id);
      playheadRef.current = target.timelineStart;
      setPlayheadSec(target.timelineStart);
    },
    [layout.items, onSelectSegment]
  );

  const handleSplitAtPlayhead = useCallback(() => {
    if (!splitTarget) return;
    setIsPlaying(false);
    onSplitSegment(splitTarget.segment.id, splitTarget.splitClipSec);
  }, [onSplitSegment, splitTarget]);

  const handleToggleTransition = useCallback(
    (segmentId: string) => {
      const idx = segments.findIndex((s) => s.id === segmentId);
      if (idx <= 0) return;
      const seg = segments[idx];
      if (seg.transitionIn === "crossfade") {
        onUpdateSegment(segmentId, { transitionIn: "cut" });
        return;
      }
      if (canEnableCrossfade(segments, idx).allowed) {
        onUpdateSegment(segmentId, { transitionIn: "crossfade" });
      }
    },
    [onUpdateSegment, segments]
  );

  const handleSelectSegmentFromPanel = useCallback(
    (segmentId: string, mode: "single" | "toggle" | "range" = "single") => {
      handleSelectWithMode(segmentId, mode);
      if (mode === "single") {
        const item = layout.items.find((it) => it.segment.id === segmentId);
        if (
          item &&
          (playheadRef.current < item.timelineStart - 0.01 ||
            playheadRef.current > item.timelineEnd + 0.01)
        ) {
          playheadRef.current = item.timelineStart;
          setPlayheadSec(item.timelineStart);
        }
      }
    },
    [handleSelectWithMode, layout.items]
  );

  const handleSeekLocalClip = useCallback(
    (clipLocalSec: number) => {
      if (!selectedLayoutItem) return;
      const seg = selectedLayoutItem.segment;
      const clampedClip = Math.max(seg.startSec, Math.min(seg.endSec, clipLocalSec));
      const timelineOffset = (clampedClip - seg.startSec) / seg.speed;
      const nextGlobal = selectedLayoutItem.timelineStart + timelineOffset;
      playheadRef.current = nextGlobal;
      setPlayheadSec(nextGlobal);
    },
    [selectedLayoutItem]
  );

  const hasPrevSegment = activeIndex > 0;
  const hasNextSegment = activeIndex >= 0 && activeIndex < layout.items.length - 1;

  // Resizable splitter between Preview Stage (top) and Timeline (bottom).
  useEffect(() => {
    if (!isResizingSplitter) return;

    const handleMove = (e: PointerEvent) => {
      const drag = splitterDragRef.current;
      if (!drag) return;
      const deltaUp = drag.startY - e.clientY;
      const nextHeight = Math.round(
        Math.max(minTimelineHeightPx, Math.min(drag.maxHeight, drag.startHeight + deltaUp))
      );
      setTimelineHeightPx(nextHeight);
    };

    const handleUp = () => {
      splitterDragRef.current = null;
      setIsResizingSplitter(false);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [isResizingSplitter, minTimelineHeightPx]);

  const handleSplitterPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (isNarrow) return;
    e.preventDefault();
    const col = leftColRef.current;
    const timelineEl = col?.querySelector('[aria-label="Editor timeline"]') as HTMLElement | null;
    const currentH = timelineHeightPx ?? timelineEl?.offsetHeight ?? minTimelineHeightPx;
    const colH = col?.clientHeight ?? 680;
    const maxH = Math.max(
      minTimelineHeightPx,
      Math.min(Math.floor(colH * 0.55), colH - MIN_PREVIEW_HEIGHT_PX - 76)
    );
    splitterDragRef.current = {
      startY: e.clientY,
      startHeight: currentH,
      maxHeight: maxH,
    };
    setIsResizingSplitter(true);
  };

  const executeOpenProject = useCallback(
    async (projectId: string) => {
      setOpenProjectError(null);
      try {
        const result = await api.loadEditorProject(projectId);
        setIsPlaying(false);
        if (result.missingSegments.length > 0) {
          setOpenProjectModalOpen(false);
          setMissingClipsModal({ open: true, result, busy: false });
          return;
        }
        onOpenLoadedProject(result.project, { markDirty: false });
        playheadRef.current = 0;
        setPlayheadSec(0);
        setOpenProjectModalOpen(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setOpenProjectError(message || "Could not open project.");
        setOpenProjectModalOpen(true);
      }
    },
    [onOpenLoadedProject]
  );

  const runPendingProjectAction = useCallback(
    async (action: PendingProjectAction) => {
      if (action.kind === "new") {
        setIsPlaying(false);
        onStartNewProject();
        playheadRef.current = 0;
        setPlayheadSec(0);
        return;
      }
      await executeOpenProject(action.project.id);
    },
    [executeOpenProject, onStartNewProject]
  );

  const openSaveDialog = useCallback(
    (mode: "save" | "save_as") => {
      setSaveModalError(null);
      const initialName =
        mode === "save_as"
          ? `${activeProjectName || "Untitled Project"} (Copy)`
          : activeProjectName || "";
      setSaveModal({ open: true, mode, initialName });
    },
    [activeProjectName]
  );

  const handleSaveTrigger = useCallback(async () => {
    if ((segments.length === 0 && !activeProjectId) || savingDirect) return;
    if (activeProjectId !== null) {
      setSavingDirect(true);
      try {
        await onSaveCurrentProject();
      } catch (err) {
        setSaveModalError(err instanceof Error ? err.message : String(err));
        setSaveModal({
          open: true,
          mode: "save",
          initialName: activeProjectName || "",
        });
      } finally {
        setSavingDirect(false);
      }
      return;
    }
    openSaveDialog("save");
  }, [
    activeProjectId,
    activeProjectName,
    onSaveCurrentProject,
    openSaveDialog,
    savingDirect,
    segments.length,
  ]);

  const handleSaveAsTrigger = useCallback(() => {
    if (segments.length === 0) return;
    openSaveDialog("save_as");
  }, [openSaveDialog, segments.length]);

  const handleNewProjectTrigger = useCallback(() => {
    if (activeProjectId === null && segments.length === 0) return;
    if (isDirty) {
      setUnsavedModal({
        open: true,
        pendingAction: { kind: "new" },
        busy: false,
      });
      return;
    }
    setIsPlaying(false);
    onStartNewProject();
    playheadRef.current = 0;
    setPlayheadSec(0);
  }, [activeProjectId, isDirty, onStartNewProject, segments.length]);

  // Global keyboard shortcuts inside EditorView (ignored inside editable fields, except Escape).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (document.querySelector('[role="dialog"]')) return;

      const target = e.target as HTMLElement | null;
      const inEditable = Boolean(
        target &&
          (target.closest("input, textarea, select, [contenteditable='true']") ||
            target.isContentEditable)
      );

      if (e.key === "Escape") {
        if (selectedSegmentIds.length > 1) {
          e.preventDefault();
          onClearSegmentSelection();
        }
        return;
      }

      if (inEditable) return;

      const lower = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && !e.altKey) {
        if (lower === "s") {
          e.preventDefault();
          if (e.shiftKey) {
            handleSaveAsTrigger();
          } else {
            void handleSaveTrigger();
          }
          return;
        }
        if (lower === "o" && !e.shiftKey) {
          e.preventDefault();
          setOpenProjectError(null);
          setOpenProjectModalOpen(true);
          return;
        }
        if (lower === "a" && !e.shiftKey) {
          e.preventDefault();
          onSelectAllSegments();
          return;
        }
        if (lower === "z") {
          e.preventDefault();
          if (e.shiftKey) {
            if (canRedo) onRedo();
          } else if (canUndo) {
            onUndo();
          }
          return;
        }
        if (lower === "y" && !e.shiftKey) {
          e.preventDefault();
          if (canRedo) onRedo();
          return;
        }
        return;
      }

      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === " " || lower === "k") {
        e.preventDefault();
        togglePlay();
      } else if (lower === "s") {
        e.preventDefault();
        handleSplitAtPlayhead();
      } else if (lower === "j" || e.key === "ArrowLeft") {
        e.preventDefault();
        scrubTimeline(playheadRef.current - 5);
      } else if (lower === "l" || e.key === "ArrowRight") {
        e.preventDefault();
        scrubTimeline(playheadRef.current + 5);
      } else if (e.key === "," || e.key === ".") {
        e.preventDefault();
        setIsPlaying(false);
        const fps = activeSegment?.clip.fps && activeSegment.clip.fps > 0 ? activeSegment.clip.fps : 60;
        const dir = e.key === "," ? -1 : 1;
        scrubTimeline(playheadRef.current + dir * (1 / fps));
      } else if (e.key === "[" && hasPrevSegment) {
        e.preventDefault();
        jumpToSegment(activeIndex - 1);
      } else if (e.key === "]" && hasNextSegment) {
        e.preventDefault();
        jumpToSegment(activeIndex + 1);
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    activeIndex,
    activeSegment?.clip.fps,
    canRedo,
    canUndo,
    handleSaveAsTrigger,
    handleSaveTrigger,
    handleSplitAtPlayhead,
    hasNextSegment,
    hasPrevSegment,
    jumpToSegment,
    onClearSegmentSelection,
    onRedo,
    onSelectAllSegments,
    onUndo,
    scrubTimeline,
    selectedSegmentIds.length,
    togglePlay,
  ]);

  const handleRequestClear = () => {
    if (segments.length === 0) return;
    setIsPlaying(false);
    if (segments.length === 1) {
      onClearSegments();
      return;
    }
    onRequestConfirmClear(segments.length, () => {
      onClearSegments();
    });
  };

  const handleRemoveSelectedSegments = () => {
    if (selectedSegmentIds.length === 0) return;
    setIsPlaying(false);
    if (selectedSegmentIds.length === 1) {
      onRemoveSegment(selectedSegmentIds[0]);
      return;
    }
    onRequestConfirmRemoveSelected(selectedSegmentIds.length, () => {
      onRemoveSegments(selectedSegmentIds);
    });
  };

  const handleAddAudioLayer = useCallback(async () => {
    try {
      const filePath = await api.pickAudioFile();
      if (!filePath) return;
      const probed = await api.probeAudioFile(filePath);
      onAddAudioLayer(probed, playheadRef.current);
    } catch {
      // Ignore canceled or invalid audio file selection.
    }
  }, [onAddAudioLayer]);

  const handleLocateAudioLayer = useCallback(
    async (layerId: string) => {
      try {
        const filePath = await api.pickAudioFile();
        if (!filePath) return;
        const probed = await api.probeAudioFile(filePath);
        onUpdateAudioLayer(layerId, {
          filePath: probed.filePath,
          title: probed.title,
          durationSec: probed.durationSec,
          trimStartSec: 0,
          trimEndSec: probed.durationSec,
          isMissing: false,
        });
      } catch {
        // Ignore canceled or invalid audio file selection.
      }
    },
    [onUpdateAudioLayer]
  );

  const handleExport = async () => {
    if (segments.length === 0 || exporting) return;
    setExporting(true);
    try {
      await onStartEditorExport({
        segments: segments.map((seg, idx) => {
          const item = layout.items[idx];
          const isCrossfade = idx > 0 && seg.transitionIn === "crossfade" && (item?.overlapInSec ?? 0) >= MIN_TRANSITION_SEC;
          const isFadeIn = idx === 0 && seg.transitionIn === "fade" && (item?.fadeInSec ?? 0) >= MIN_TRANSITION_SEC;
          const isFadeOut =
            idx === segments.length - 1 &&
            seg.transitionOut === "fade" &&
            (item?.fadeOutSec ?? 0) >= MIN_TRANSITION_SEC;
          const transitionInType = isCrossfade ? "crossfade" : isFadeIn ? "fade" : "cut";
          const transitionInDur = isCrossfade
            ? item?.overlapInSec ?? 0
            : isFadeIn
              ? item?.fadeInSec ?? 0
              : 0;
          const transitionOutType = isFadeOut ? "fade" : "cut";
          const transitionOutDur = isFadeOut ? item?.fadeOutSec ?? 0 : 0;

          return {
            clipId: seg.clipId,
            startSec: seg.startSec,
            endSec: seg.endSec,
            speed: seg.speed,
            audioMix: seg.audioMix,
            masterVolume: seg.masterVolume,
            masterMuted: seg.masterMuted,
            transitionIn: transitionInType,
            transitionInDurationSec: transitionInDur,
            crossfadeDurationSec: isCrossfade ? transitionInDur : 0,
            transitionOut: transitionOutType,
            transitionOutDurationSec: transitionOutDur,
            vibrance: seg.vibrance,
            saturation: seg.saturation,
            framing: seg.framing,
          };
        }),
        audioLayers: audioLayers
          .filter((layer) => !layer.isMissing && Boolean(layer.filePath))
          .map((layer) => ({
            filePath: layer.filePath,
            timelineOffsetSec: layer.timelineOffsetSec,
            trimStartSec: layer.trimStartSec,
            trimEndSec: layer.trimEndSec,
            volume: layer.volume,
            muted: layer.muted,
          })),
        preset: exportOptions.preset,
        verticalStyle: exportOptions.vertical916 ? exportOptions.verticalStyle : "none",
        normalizeAudio: exportOptions.normalizeAudio,
        copyToClipboard: exportOptions.copyToClipboard,
        addToLibrary: exportOptions.addToLibrary,
        outputName: exportOptions.outputName.trim() || null,
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <main
      data-testid="editor-view"
      className={`view-enter flex min-h-0 flex-1 bg-[var(--surface-canvas)] ${
        isNarrow ? "glint-scroll flex-col overflow-y-auto" : "overflow-hidden"
      }`}
    >
      <div
        ref={leftColRef}
        className={`flex min-w-0 flex-1 flex-col ${
          isNarrow
            ? "shrink-0 gap-2.5 p-3"
            : isMedium
              ? "gap-2 overflow-hidden p-3"
              : "gap-2.5 overflow-hidden p-4"
        }`}
      >
        <EditorHeader
          activeProjectId={activeProjectId}
          activeProjectName={activeProjectName}
          activeProjectUpdatedAt={activeProjectUpdatedAt}
          isDirty={isDirty}
          saving={savingDirect}
          segmentCount={segments.length}
          totalDurationSec={layout.totalDurationSec}
          isNarrow={isNarrow}
          onOpenProject={() => {
            setOpenProjectError(null);
            setOpenProjectModalOpen(true);
          }}
          onSaveProject={() => void handleSaveTrigger()}
          onSaveProjectAs={handleSaveAsTrigger}
          onNewProject={handleNewProjectTrigger}
          onOpenClipPicker={() => setPickerOpen(true)}
          onRequestClear={handleRequestClear}
        />

        <div className={isNarrow ? "flex aspect-video min-h-[180px] shrink-0" : "flex min-h-[180px] flex-1"}>
          <EditorPreviewStage
            segments={segments}
            audioLayers={audioLayers}
            playheadSec={playheadSec}
            activeIndex={activeIndex}
            activeSegment={activeSegment}
            outgoingSegment={outgoingItem?.segment ?? null}
            crossfadeProgress={crossfadeProgress}
            edgeFadeOpacity={edgeFadeOpacity}
            clipLocalTimeSec={mapped.clipLocalSec}
            outgoingClipLocalTimeSec={outgoingClipLocalTimeSec}
            isPlaying={isPlaying}
            streamerBaseUrl={streamerBaseUrl}
            streamerToken={streamerToken}
            pulseIcon={pulseIcon}
            showVerticalGuide={activeTab === "export" && exportOptions.vertical916}
            exportOptions={exportOptions}
            onTogglePlay={togglePlay}
            onOpenClipPicker={() => setPickerOpen(true)}
          />
        </div>

        {!isNarrow && (
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize preview and timeline"
            data-testid="editor-stage-timeline-splitter"
            onPointerDown={handleSplitterPointerDown}
            title="Drag up or down to resize preview and timeline"
            className="group -my-1 flex h-2.5 shrink-0 cursor-row-resize items-center justify-center select-none"
          >
            <span
              className={`h-1 w-10 rounded-full ${
                isResizingSplitter
                  ? "bg-[var(--accent-primary)] transition-none"
                  : "bg-slate-900/20 transition-colors duration-[120ms] group-hover:bg-[var(--accent-primary)]"
              }`}
            />
          </div>
        )}

        <EditorTimeline
          layout={layout}
          audioLayers={audioLayers}
          selectedAudioLayerId={selectedAudioLayerId}
          playheadSec={playheadSec}
          isPlaying={isPlaying}
          selectedSegmentIds={selectedSegmentIds}
          primarySelectedSegmentId={primarySelectedSegmentId}
          activeSegmentTitle={
            activeSegment ? activeSegment.clip.title?.trim() || activeSegment.clip.fileName : null
          }
          hasPrevSegment={hasPrevSegment}
          hasNextSegment={hasNextSegment}
          canSplit={canSplit}
          canUndo={canUndo}
          canRedo={canRedo}
          zoom={timelineZoom}
          timelineHeightPx={timelineHeightPx}
          isResizingHeight={isResizingSplitter}
          streamerBaseUrl={streamerBaseUrl}
          streamerToken={streamerToken}
          isNarrow={isNarrow}
          isMedium={isMedium}
          onTogglePlay={togglePlay}
          onPrevSegment={() => {
            if (hasPrevSegment) jumpToSegment(activeIndex - 1);
          }}
          onNextSegment={() => {
            if (hasNextSegment) jumpToSegment(activeIndex + 1);
          }}
          onSplitAtPlayhead={handleSplitAtPlayhead}
          onUndo={onUndo}
          onRedo={onRedo}
          onChangeZoom={(next) => setTimelineZoom(Math.max(1, Math.min(4, next)))}
          onScrubTimeline={scrubTimeline}
          onSelectSegment={handleSelectWithMode}
          onUpdateSegment={onUpdateSegment}
          onAddAudioLayer={() => void handleAddAudioLayer()}
          onSelectAudioLayer={onSelectAudioLayer}
          onUpdateAudioLayer={onUpdateAudioLayer}
          onRemoveAudioLayer={onRemoveAudioLayer}
          onLocateAudioLayer={(layerId) => void handleLocateAudioLayer(layerId)}
          onBeginTrimTransaction={onBeginHistoryTransaction}
          onCommitTrimTransaction={onCommitHistoryTransaction}
          onReorderSegment={onReorderSegment}
          onToggleTransition={handleToggleTransition}
        />
      </div>

      <EditorWorkspacePanel
        activeTab={activeTab}
        onTabChange={setActiveTab}
        segments={segments}
        selectedSegmentIds={selectedSegmentIds}
        primarySelectedSegmentId={primarySelectedSegmentId}
        selectedSegments={selectedSegments}
        primarySelectedSegment={primarySelectedSegment}
        selectedIndex={selectedIndex}
        localClipTimeSec={selectedLocalClipTimeSec}
        totalDurationSec={layout.totalDurationSec}
        streamerBaseUrl={streamerBaseUrl}
        streamerToken={streamerToken}
        isNarrow={isNarrow}
        isMedium={isMedium}
        exportOptions={exportOptions}
        exporting={exporting}
        encoderInfo={encoderInfo}
        onSelectSegment={handleSelectSegmentFromPanel}
        onSelectAllSegments={onSelectAllSegments}
        onClearSegmentSelection={onClearSegmentSelection}
        onSeekLocalClip={handleSeekLocalClip}
        onUpdateSegment={onUpdateSegment}
        onUpdateSegments={onUpdateSegments}
        onBeginTransaction={onBeginHistoryTransaction}
        onCommitTransaction={onCommitHistoryTransaction}
        onMoveSegment={onMoveSegment}
        onDuplicateSegment={onDuplicateSegment}
        onRemoveSegment={onRemoveSegment}
        onRemoveSelectedSegments={handleRemoveSelectedSegments}
        onOpenClipPicker={() => setPickerOpen(true)}
        onChangeExportOptions={onChangeExportOptions}
        onExport={() => void handleExport()}
      />

      <EditorClipPickerModal
        open={pickerOpen}
        clips={libraryClips}
        streamerBaseUrl={streamerBaseUrl}
        streamerToken={streamerToken}
        onClose={() => setPickerOpen(false)}
        onAddClips={onAddClipsFromLibrary}
      />

      <SaveProjectModal
        open={saveModal.open}
        mode={saveModal.mode}
        initialName={saveModal.initialName}
        segmentCount={segments.length}
        totalDurationSec={layout.totalDurationSec}
        busy={saveModalBusy}
        error={saveModalError}
        onSave={async (projectName) => {
          setSaveModalBusy(true);
          setSaveModalError(null);
          try {
            await onSaveProjectWithName(projectName, {
              asNew: saveModal.mode === "save_as",
            });
            setSaveModal((prev) => ({ ...prev, open: false }));
            const nextPending = pendingAfterSave;
            setPendingAfterSave(null);
            if (nextPending) {
              await runPendingProjectAction(nextPending);
            }
          } catch (err) {
            setSaveModalError(err instanceof Error ? err.message : String(err));
          } finally {
            setSaveModalBusy(false);
          }
        }}
        onClose={() => {
          setPendingAfterSave(null);
          setSaveModalError(null);
          setSaveModal((prev) => ({ ...prev, open: false }));
        }}
      />

      <OpenProjectModal
        open={openProjectModalOpen}
        activeProjectId={activeProjectId}
        isDirty={isDirty}
        currentSegmentCount={segments.length}
        openError={openProjectError}
        onSelectProject={async (projectSummary) => {
          setOpenProjectError(null);
          if (isDirty) {
            setOpenProjectModalOpen(false);
            setUnsavedModal({
              open: true,
              pendingAction: { kind: "open", project: projectSummary },
              busy: false,
            });
            return;
          }
          await executeOpenProject(projectSummary.id);
        }}
        onDeleteProject={async (projectSummary) => {
          await api.deleteEditorProject(projectSummary.id);
          if (projectSummary.id === activeProjectId) {
            onUnlinkActiveProject();
          }
        }}
        onRequestSaveCurrent={() => openSaveDialog("save")}
        onClose={() => {
          setOpenProjectError(null);
          setOpenProjectModalOpen(false);
        }}
      />

      <UnsavedChangesModal
        open={unsavedModal.open}
        activeProjectName={activeProjectName}
        busy={unsavedModal.busy}
        onSaveAndContinue={async () => {
          const action = unsavedModal.pendingAction;
          if (!action) return;
          if (activeProjectId !== null) {
            setUnsavedModal((prev) => ({ ...prev, busy: true }));
            try {
              await onSaveCurrentProject();
              setUnsavedModal({ open: false, pendingAction: null, busy: false });
              await runPendingProjectAction(action);
            } catch {
              setUnsavedModal({ open: false, pendingAction: null, busy: false });
              setPendingAfterSave(action);
              openSaveDialog("save");
            }
            return;
          }
          setUnsavedModal({ open: false, pendingAction: null, busy: false });
          setPendingAfterSave(action);
          openSaveDialog("save");
        }}
        onDiscard={() => {
          const action = unsavedModal.pendingAction;
          setUnsavedModal({ open: false, pendingAction: null, busy: false });
          if (action) {
            void runPendingProjectAction(action);
          }
        }}
        onCancel={() => {
          setUnsavedModal({ open: false, pendingAction: null, busy: false });
        }}
      />

      <MissingClipsModal
        open={missingClipsModal.open}
        projectName={missingClipsModal.result?.project.name ?? ""}
        availableCount={missingClipsModal.result?.project.segments.length ?? 0}
        missingSegments={missingClipsModal.result?.missingSegments ?? []}
        busy={missingClipsModal.busy}
        onOpenAvailable={() => {
          const res = missingClipsModal.result;
          if (!res) return;
          onOpenLoadedProject(res.project, { markDirty: true });
          playheadRef.current = 0;
          setPlayheadSec(0);
          setMissingClipsModal({ open: false, result: null, busy: false });
        }}
        onDeleteProject={async () => {
          const res = missingClipsModal.result;
          if (!res) return;
          setMissingClipsModal((prev) => ({ ...prev, busy: true }));
          try {
            await api.deleteEditorProject(res.project.id);
            if (res.project.id === activeProjectId) {
              onUnlinkActiveProject();
            }
            setMissingClipsModal({ open: false, result: null, busy: false });
          } catch {
            setMissingClipsModal((prev) => ({ ...prev, busy: false }));
          }
        }}
        onClose={() => {
          setMissingClipsModal({ open: false, result: null, busy: false });
        }}
      />
    </main>
  );
}
