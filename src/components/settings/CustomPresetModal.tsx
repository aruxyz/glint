import { useEffect, useRef, useState, type FormEvent } from "react";
import { Sliders, X } from "lucide-react";
import { useDialogModal } from "../../hooks/useDialogModal";
import { usePresence } from "../../hooks/usePresence";
import { RESOLUTION_LABELS } from "../../lib/presets";
import type {
  CustomExportPreset,
  CustomPresetContainer,
  CustomPresetFps,
  CustomPresetInput,
  CustomPresetResolution,
} from "../../lib/types";
import { GlassSelect } from "../GlassSelect";

interface CustomPresetModalProps {
  open: boolean;
  initialPreset: CustomExportPreset | null;
  busy?: boolean;
  onClose: () => void;
  onSave: (input: CustomPresetInput) => Promise<void>;
}

const CONTAINER_OPTIONS: CustomPresetContainer[] = ["mp4", "mkv", "webm"];
const FPS_OPTIONS: Array<{ value: CustomPresetFps; label: string }> = [
  { value: "source", label: "Source" },
  { value: "60", label: "60 fps" },
  { value: "30", label: "30 fps" },
];
const RESOLUTION_OPTIONS: Array<{ value: CustomPresetResolution; label: string }> = (
  Object.keys(RESOLUTION_LABELS) as CustomPresetResolution[]
).map((value) => ({
  value,
  label: RESOLUTION_LABELS[value],
}));

export function CustomPresetModal({
  open,
  initialPreset,
  busy = false,
  onClose,
  onSave,
}: CustomPresetModalProps) {
  const [name, setName] = useState("");
  const [container, setContainer] = useState<CustomPresetContainer>("mp4");
  const [qualityMode, setQualityMode] = useState<"size" | "bitrate">("size");
  const [targetSizeMb, setTargetSizeMb] = useState("15");
  const [videoBitrateKbps, setVideoBitrateKbps] = useState("8000");
  const [resolution, setResolution] = useState<CustomPresetResolution>("1080p");
  const [fps, setFps] = useState<CustomPresetFps>("60");
  const [audioNormalize, setAudioNormalize] = useState(false);
  const [stretch169, setStretch169] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLFormElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const { present, isExiting } = usePresence(open, 130);

  useEffect(() => {
    if (!open) return;
    setError(null);
    if (initialPreset) {
      setName(initialPreset.name);
      setContainer(initialPreset.container);
      if (initialPreset.videoBitrateKbps !== null && initialPreset.videoBitrateKbps > 0) {
        setQualityMode("bitrate");
        setVideoBitrateKbps(String(initialPreset.videoBitrateKbps));
        setTargetSizeMb("15");
      } else {
        setQualityMode("size");
        setTargetSizeMb(String(initialPreset.targetSizeMb ?? 15));
        setVideoBitrateKbps("8000");
      }
      setResolution(initialPreset.resolution);
      setFps(initialPreset.fps);
      setAudioNormalize(initialPreset.audioNormalize);
      setStretch169(initialPreset.stretch169);
    } else {
      setName("");
      setContainer("mp4");
      setQualityMode("size");
      setTargetSizeMb("15");
      setVideoBitrateKbps("8000");
      setResolution("1080p");
      setFps("60");
      setAudioNormalize(false);
      setStretch169(false);
    }
  }, [initialPreset, open]);

  useDialogModal({
    open,
    containerRef,
    initialFocusRef: nameInputRef,
    onClose: () => {
      if (!busy) onClose();
    },
  });

  if (!present) return null;

  const trimmedName = name.trim();
  const parsedSize = Number(targetSizeMb);
  const parsedBitrate = Number(videoBitrateKbps);
  const numericValid =
    qualityMode === "size"
      ? Number.isFinite(parsedSize) && parsedSize >= 1 && parsedSize <= 4096
      : Number.isFinite(parsedBitrate) && parsedBitrate >= 500 && parsedBitrate <= 100000;
  const isValid = trimmedName.length > 0 && trimmedName.length <= 32 && numericValid;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValid || busy) return;
    setError(null);
    try {
      await onSave({
        name: trimmedName,
        container,
        targetSizeMb: qualityMode === "size" ? Math.round(parsedSize) : null,
        videoBitrateKbps: qualityMode === "bitrate" ? Math.round(parsedBitrate) : null,
        resolution,
        fps,
        audioNormalize,
        stretch169,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save preset.");
    }
  };

  return (
    <div
      className={`modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-[var(--surface-scrim-light)] p-4 ${
        isExiting ? "modal-exit pointer-events-none" : ""
      }`}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="custom-preset-modal-title"
        onSubmit={handleSubmit}
        className={`glass-dock w-full max-w-[460px] rounded-[16px] p-6 ${
          isExiting ? "modal-exit" : "modal-enter"
        }`}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] bg-[var(--accent-tint-bg)] text-[var(--accent-primary)]">
              <Sliders className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <h2
                id="custom-preset-modal-title"
                className="text-[16px] font-semibold text-[var(--text-primary)]"
              >
                {initialPreset ? "Edit Custom Preset" : "New Custom Preset"}
              </h2>
              <p className="text-[12px] text-[var(--text-secondary)]">
                Reusable target for Player and Batch Export.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Close preset modal"
            className="flex h-8 w-8 items-center justify-center rounded-[8px] text-[var(--text-secondary)] hover:bg-slate-900/5 hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="mt-4 space-y-3.5">
          <div>
            <label
              htmlFor="preset-name-input"
              className="block text-[12px] font-semibold text-[var(--text-primary)]"
            >
              Preset Name
            </label>
            <input
              ref={nameInputRef}
              id="preset-name-input"
              type="text"
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="YouTube 1080p60"
              className="glint-input mt-1 h-9 w-full rounded-[8px] px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
            />
          </div>

          <div>
            <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
              Container
            </span>
            <div className="mt-1 grid grid-cols-3 gap-1 rounded-[9px] border border-[var(--border-hairline)] bg-[var(--surface-control)] p-1">
              {CONTAINER_OPTIONS.map((opt) => {
                const active = container === opt;
                return (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => setContainer(opt)}
                    aria-pressed={active}
                    className={`h-7 rounded-[6px] text-[12px] font-semibold uppercase transition-colors ${
                      active
                        ? "bg-[var(--accent-primary)] text-white"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
            {container === "webm" && (
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                WebM encodes with VP9/Opus (CPU) when hardware VP9 is unavailable.
              </p>
            )}
          </div>

          <div>
            <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
              Quality Target
            </span>
            <div className="mt-1 grid grid-cols-2 gap-1 rounded-[9px] border border-[var(--border-hairline)] bg-[var(--surface-control)] p-1">
              <button
                type="button"
                onClick={() => setQualityMode("size")}
                aria-pressed={qualityMode === "size"}
                className={`h-7 rounded-[6px] text-[12px] font-medium transition-colors ${
                  qualityMode === "size"
                    ? "bg-[var(--accent-primary)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Target Size (MB)
              </button>
              <button
                type="button"
                onClick={() => setQualityMode("bitrate")}
                aria-pressed={qualityMode === "bitrate"}
                className={`h-7 rounded-[6px] text-[12px] font-medium transition-colors ${
                  qualityMode === "bitrate"
                    ? "bg-[var(--accent-primary)] text-white"
                    : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                }`}
              >
                Video Bitrate (kbps)
              </button>
            </div>

            {qualityMode === "size" ? (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={4096}
                  step={1}
                  value={targetSizeMb}
                  onChange={(e) => setTargetSizeMb(e.target.value)}
                  aria-label="Target size in MB"
                  className="glint-input font-mono-tabular h-9 flex-1 rounded-[8px] px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                />
                <span className="font-mono-tabular text-[12px] font-semibold text-[var(--text-secondary)]">
                  MB
                </span>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2">
                <input
                  type="number"
                  min={500}
                  max={100000}
                  step={500}
                  value={videoBitrateKbps}
                  onChange={(e) => setVideoBitrateKbps(e.target.value)}
                  aria-label="Video bitrate in kbps"
                  className="glint-input font-mono-tabular h-9 flex-1 rounded-[8px] px-3 text-[13px] text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none"
                />
                <span className="font-mono-tabular text-[12px] font-semibold text-[var(--text-secondary)]">
                  kbps
                </span>
              </div>
            )}
          </div>

          <div>
            <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
              Resolution
            </span>
            <div className="mt-1">
              <GlassSelect
                ariaLabel="Preset resolution"
                value={resolution}
                options={RESOLUTION_OPTIONS}
                onChange={setResolution}
                size="md"
              />
            </div>
          </div>

          <div>
            <span className="block text-[12px] font-semibold text-[var(--text-primary)]">
              Frame Rate
            </span>
            <div className="mt-1 grid grid-cols-3 gap-1 rounded-[9px] border border-[var(--border-hairline)] bg-[var(--surface-control)] p-1">
              {FPS_OPTIONS.map((opt) => {
                const active = fps === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFps(opt.value)}
                    aria-pressed={active}
                    className={`h-7 rounded-[6px] text-[12px] font-medium transition-colors ${
                      active
                        ? "bg-[var(--accent-primary)] text-white"
                        : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-1 border-t border-[var(--border-hairline)] pt-2">
            <label className="-mx-2 flex min-h-[36px] items-center gap-2.5 rounded-[8px] px-2 hover:bg-slate-900/5">
              <input
                type="checkbox"
                checked={audioNormalize}
                onChange={(e) => setAudioNormalize(e.target.checked)}
                className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
              />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                Normalize audio loudness
              </span>
            </label>
            <label className="-mx-2 flex min-h-[36px] items-center gap-2.5 rounded-[8px] px-2 hover:bg-slate-900/5">
              <input
                type="checkbox"
                checked={stretch169}
                onChange={(e) => setStretch169(e.target.checked)}
                className="h-4 w-4 shrink-0 accent-[var(--accent-primary)]"
              />
              <span className="text-[13px] font-medium text-[var(--text-primary)]">
                Stretch non-16:9 to 16:9
              </span>
            </label>
          </div>
        </div>

        {error && (
          <p className="mt-3 text-[12px] font-medium text-[var(--status-error-fg)]">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="btn-secondary h-9 px-4 text-[13px]"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!isValid || busy}
            className="btn-primary h-9 px-4 text-[13px]"
          >
            {busy ? "Saving..." : "Save Preset"}
          </button>
        </div>
      </form>
    </div>
  );
}
