import { EditorAdjustTab } from "./EditorAdjustTab";
import { EditorExportTab } from "./EditorExportTab";
import { EditorSegmentsTab } from "./EditorSegmentsTab";
import type {
  EditorExportOptions,
  EditorSegment,
  EditorWorkspaceTab,
} from "../../lib/types";

interface EditorWorkspacePanelProps {
  activeTab: EditorWorkspaceTab;
  onTabChange: (tab: EditorWorkspaceTab) => void;
  segments: EditorSegment[];
  selectedSegmentIds: string[];
  primarySelectedSegmentId: string | null;
  selectedSegments: EditorSegment[];
  primarySelectedSegment: EditorSegment | null;
  selectedIndex: number;
  localClipTimeSec: number;
  totalDurationSec: number;
  streamerBaseUrl: string;
  streamerToken: string;
  isNarrow: boolean;
  isMedium: boolean;
  exportOptions: EditorExportOptions;
  exporting: boolean;
  encoderInfo: {
    hasNvenc: boolean;
    hasAmf?: boolean;
    hasQsv?: boolean;
    hardwareEncoder?: string | null;
  };
  onSelectSegment: (segmentId: string, mode?: "single" | "toggle" | "range") => void;
  onSelectAllSegments: () => void;
  onClearSegmentSelection: () => void;
  onSeekLocalClip: (clipTimeSec: number) => void;
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
  onBeginTransaction: () => void;
  onCommitTransaction: () => void;
  onMoveSegment: (index: number, delta: -1 | 1) => void;
  onDuplicateSegment: (index: number) => void;
  onRemoveSegment: (segmentId: string) => void;
  onRemoveSelectedSegments: () => void;
  onOpenClipPicker: () => void;
  onChangeExportOptions: (patch: Partial<EditorExportOptions>) => void;
  onExport: () => void;
}

const TABS: ReadonlyArray<{ id: EditorWorkspaceTab; label: string }> = [
  { id: "segments", label: "Segments" },
  { id: "adjust", label: "Adjust" },
  { id: "export", label: "Export" },
];

export function EditorWorkspacePanel({
  activeTab,
  onTabChange,
  segments,
  selectedSegmentIds,
  primarySelectedSegmentId,
  selectedSegments,
  primarySelectedSegment,
  selectedIndex,
  localClipTimeSec,
  totalDurationSec,
  streamerBaseUrl,
  streamerToken,
  isNarrow,
  isMedium,
  exportOptions,
  exporting,
  encoderInfo,
  onSelectSegment,
  onSelectAllSegments,
  onClearSegmentSelection,
  onSeekLocalClip,
  onUpdateSegment,
  onUpdateSegments,
  onBeginTransaction,
  onCommitTransaction,
  onMoveSegment,
  onDuplicateSegment,
  onRemoveSegment,
  onRemoveSelectedSegments,
  onOpenClipPicker,
  onChangeExportOptions,
  onExport,
}: EditorWorkspacePanelProps) {
  const widthClass = isNarrow
    ? "w-full min-h-[380px] border-t border-[var(--border-hairline)]"
    : isMedium
      ? "w-[288px] shrink-0 border-l border-[var(--border-hairline)]"
      : "w-[320px] xl:w-[344px] shrink-0 border-l border-[var(--border-hairline)]";

  return (
    <aside
      aria-label="Editor workspace panel"
      className={`glass-chrome flex flex-col ${widthClass} ${isNarrow ? "" : "h-full"}`}
    >
      <div
        role="tablist"
        aria-label="Editor sections"
        className="grid grid-cols-3 gap-1 border-b border-[var(--border-hairline)] p-2"
      >
        {TABS.map((tab) => {
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(tab.id)}
              className={`nav-item-press h-9 rounded-[8px] text-[12px] ${
                isNarrow ? "min-h-[44px]" : ""
              } ${
                active
                  ? "bg-[var(--surface-control-hover)] font-semibold text-[var(--text-primary)] shadow-[0_1px_3px_rgba(15,23,42,0.08),inset_0_1px_0_rgba(255,255,255,0.95)]"
                  : "font-medium text-[var(--text-secondary)] hover:bg-slate-900/5 hover:text-[var(--text-primary)]"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </div>

      <div key={activeTab} className="tab-enter flex min-h-0 flex-1 flex-col">
        {activeTab === "segments" && (
          <EditorSegmentsTab
            segments={segments}
            selectedSegmentIds={selectedSegmentIds}
            primarySelectedSegmentId={primarySelectedSegmentId}
            streamerBaseUrl={streamerBaseUrl}
            streamerToken={streamerToken}
            isNarrow={isNarrow}
            onSelectSegment={onSelectSegment}
            onSelectAllSegments={onSelectAllSegments}
            onClearSegmentSelection={onClearSegmentSelection}
            onMoveSegment={onMoveSegment}
            onDuplicateSegment={onDuplicateSegment}
            onRemoveSegment={onRemoveSegment}
            onBatchAdjustSelected={() => onTabChange("adjust")}
            onRemoveSelectedSegments={onRemoveSelectedSegments}
            onOpenClipPicker={onOpenClipPicker}
            onUpdateSegment={onUpdateSegment}
            onBeginTransaction={onBeginTransaction}
            onCommitTransaction={onCommitTransaction}
          />
        )}

        {activeTab === "adjust" && (
          <EditorAdjustTab
            segments={segments}
            selectedSegments={selectedSegments}
            primarySelectedSegment={primarySelectedSegment}
            selectedIndex={selectedIndex}
            localClipTimeSec={localClipTimeSec}
            streamerBaseUrl={streamerBaseUrl}
            streamerToken={streamerToken}
            onSeekLocalClip={onSeekLocalClip}
            onUpdateSegment={onUpdateSegment}
            onUpdateSegments={onUpdateSegments}
            onBeginTransaction={onBeginTransaction}
            onCommitTransaction={onCommitTransaction}
            onSwitchToSegments={() => onTabChange("segments")}
            onClearMultiSelection={onClearSegmentSelection}
          />
        )}

        {activeTab === "export" && (
          <EditorExportTab
            options={exportOptions}
            segments={segments}
            totalDurationSec={totalDurationSec}
            exporting={exporting}
            encoderInfo={encoderInfo}
            onChangeOptions={onChangeExportOptions}
            onExport={onExport}
          />
        )}
      </div>
    </aside>
  );
}
