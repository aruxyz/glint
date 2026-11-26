import { Download } from "lucide-react";
import { isTauriRuntime } from "../../lib/api";
import { estimateEditorExportBytes } from "../../lib/editor";
import { getEncoderLabel } from "../../lib/encoder";
import { formatBytes, formatDuration } from "../../lib/format";
import type {
  EditorExportOptions,
  EditorExportPreset,
  EditorSegment,
  EditorVerticalStyle,
} from "../../lib/types";

interface EditorExportTabProps {
  options: EditorExportOptions;
  segments: EditorSegment[];
  totalDurationSec: number;
  exporting: boolean;
  encoderInfo: {
    hasNvenc: boolean;
    hasAmf?: boolean;
    hasQsv?: boolean;
    hardwareEncoder?: string | null;
  };
  onChangeOptions: (patch: Partial<EditorExportOptions>) => void;
  onExport: () => void;
}

const PRESET_CARDS: ReadonlyArray<{
  value: EditorExportPreset;
  title: string;
  desc: string;
}> = [
  {
    value: "original",
    title: "Original",
    desc: "Highest quality · GPU/Stream Copy",
  },
  {
    value: "discord_10mb",
    title: "Discord 10 MB",
    desc: "Target <= 10 MB for free Discord upload",
  },
  {
    value: "discord_25mb",
    title: "Discord 25 MB",
    desc: "Target <= 25 MB for Discord Nitro",
  },
];

export function EditorExportTab({
  options,
  segments,
  totalDurationSec,
  exporting,
  encoderInfo,
  onChangeOptions,
  onExport,
}: EditorExportTabProps) {
  const segmentCount = segments.length;
  const inTauri = isTauriRuntime();
  const encoderPreset = options.vertical916
    ? options.verticalStyle === "crop"
      ? "vertical_crop_9_16"
      : "vertical_blur_9_16"
    : "editor";
  const encoderLabel = getEncoderLabel(
    encoderPreset,
    encoderInfo,
    "original",
    options.normalizeAudio
  );
  const estBytes = estimateEditorExportBytes(segments, totalDurationSec, options.preset);
  const showEstimatedSize =
    options.preset === "discord_10mb" || options.preset === "discord_25mb";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="glint-scroll flex-1 space-y-4 overflow-y-auto p-3.5">
        <div>
          <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
            Format & Size
          </span>
          <div role="radiogroup" aria-label="Export preset" className="mt-2 space-y-2">
            {PRESET_CARDS.map((card) => {
              const selected = options.preset === card.value;
              return (
                <button
                  key={card.value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => onChangeOptions({ preset: card.value })}
                  className={`nav-item-press flex w-full flex-col items-start rounded-[10px] border p-3 text-left ${
                    selected
                      ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)]"
                      : "border-[var(--border-hairline)] bg-[var(--surface-card)] shadow-[var(--border-card-specular),var(--shadow-card-rest)] hover:bg-[var(--surface-card-hover)]"
                  }`}
                >
                  <span
                    className={`text-[13px] font-semibold ${
                      selected ? "text-[var(--accent-text)]" : "text-[var(--text-primary)]"
                    }`}
                  >
                    {card.title}
                  </span>
                  <span className="mt-0.5 text-[11px] text-[var(--text-secondary)]">
                    {card.desc}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-2.5 border-t border-[var(--border-hairline)] pt-3.5">
          <div className="rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2.5 shadow-[var(--border-card-specular)]">
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-[12px] font-semibold text-[var(--text-primary)]">
                  9:16 Vertical
                </p>
                <p className="text-[11px] text-[var(--text-secondary)]">
                  Format output at 1080x1920
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={options.vertical916}
                aria-label="9:16 Vertical"
                onClick={() =>
                  onChangeOptions({ vertical916: !options.vertical916 })
                }
                className={`relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-[130ms] ${
                  options.vertical916 ? "bg-[var(--accent-primary)]" : "bg-slate-900/20"
                }`}
              >
                <span
                  className={`block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-[130ms] ${
                    options.vertical916 ? "translate-x-4" : "translate-x-0"
                  }`}
                />
              </button>
            </div>

            {options.vertical916 && (
              <div
                role="radiogroup"
                aria-label="9:16 framing style"
                className="mt-2.5 grid grid-cols-2 gap-1.5 border-t border-[var(--border-hairline)] pt-2.5"
              >
                {(
                  [
                    { value: "blur", label: "Blurred Backdrop" },
                    { value: "crop", label: "Center Crop" },
                  ] satisfies ReadonlyArray<{
                    value: EditorVerticalStyle;
                    label: string;
                  }>
                ).map((styleOpt) => {
                  const active = options.verticalStyle === styleOpt.value;
                  return (
                    <button
                      key={styleOpt.value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() =>
                        onChangeOptions({ verticalStyle: styleOpt.value })
                      }
                      className={`btn-toggle-pill h-7 rounded-[7px] border px-2 text-[11px] ${
                        active
                          ? "border-[var(--accent-primary)] bg-[var(--accent-tint-bg)] font-semibold text-[var(--accent-text)]"
                          : "border-[var(--border-control)] bg-[var(--surface-control)] font-medium text-[var(--text-primary)]"
                      }`}
                    >
                      {styleOpt.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-2 rounded-[10px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2.5 shadow-[var(--border-card-specular)]">
            <div>
              <p className="text-[12px] font-semibold text-[var(--text-primary)]">
                Normalize Audio
              </p>
              <p className="text-[11px] text-[var(--text-secondary)]">
                Balance segment loudness (-14 LUFS)
              </p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={options.normalizeAudio}
              aria-label="Normalize Audio"
              onClick={() =>
                onChangeOptions({ normalizeAudio: !options.normalizeAudio })
              }
              className={`relative h-5 w-9 shrink-0 rounded-full p-0.5 transition-colors duration-[130ms] ${
                options.normalizeAudio ? "bg-[var(--accent-primary)]" : "bg-slate-900/20"
              }`}
            >
              <span
                className={`block h-4 w-4 rounded-full bg-white shadow-sm transition-transform duration-[130ms] ${
                  options.normalizeAudio ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        </div>

        <div className="space-y-1 border-t border-[var(--border-hairline)] pt-3">
          <label className="flex min-h-[34px] items-center gap-2.5 rounded-[7px] px-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-slate-900/5">
            <input
              type="checkbox"
              checked={options.copyToClipboard}
              onChange={(e) =>
                onChangeOptions({ copyToClipboard: e.target.checked })
              }
              className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
            />
            <span>Copy file to Clipboard</span>
          </label>

          <label className="flex min-h-[34px] items-center gap-2.5 rounded-[7px] px-1.5 text-[12px] font-medium text-[var(--text-primary)] hover:bg-slate-900/5">
            <input
              type="checkbox"
              checked={options.addToLibrary}
              onChange={(e) =>
                onChangeOptions({ addToLibrary: e.target.checked })
              }
              className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
            />
            <span>Save result to Library</span>
          </label>
        </div>

        <div className="border-t border-[var(--border-hairline)] pt-3">
          <label
            htmlFor="editor-output-name"
            className="block text-[12px] font-semibold text-[var(--text-primary)]"
          >
            File Name (optional)
          </label>
          <input
            id="editor-output-name"
            type="text"
            value={options.outputName}
            onChange={(e) => onChangeOptions({ outputName: e.target.value })}
            placeholder="Glint_Edit"
            maxLength={120}
            className="glint-input mt-1.5 h-9 w-full rounded-[8px] px-3 text-[12px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
          />
          <p className="mt-1 text-[11px] text-[var(--text-muted)]">
            Leave empty to name automatically with current date.
          </p>
        </div>
      </div>

      <div className="border-t border-[var(--border-hairline)] bg-[var(--surface-glass-toolbar)] p-3.5">
        <p className="font-mono-tabular mb-2.5 truncate text-[11px] text-[var(--text-secondary)]">
          Total {formatDuration(totalDurationSec)} · {segmentCount} seg · {encoderLabel}
          {showEstimatedSize && totalDurationSec > 0 ? ` · ~${formatBytes(estBytes)}` : ""}
        </p>

        <button
          type="button"
          onClick={onExport}
          disabled={segmentCount === 0 || exporting || !inTauri}
          title={!inTauri ? "Export requires Glint desktop app" : undefined}
          className="btn-primary h-10 w-full text-[13px] font-semibold"
        >
          <Download className="h-4 w-4" aria-hidden="true" />
          {exporting ? "Exporting..." : "Export"}
        </button>
      </div>
    </div>
  );
}
