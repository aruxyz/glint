import type { CustomExportPreset, CustomPresetResolution } from "./types";

export const RESOLUTION_LABELS: Record<CustomPresetResolution, string> = {
  source: "Source (Keep original)",
  "1080p": "1080p (1920x1080)",
  "720p": "720p (1280x720)",
  vertical_blur_9_16: "9:16 Blur (1080x1920)",
  vertical_crop_9_16: "9:16 Crop (1080x1920)",
};

const SHORT_RES_LABELS: Record<CustomPresetResolution, string> = {
  source: "Source",
  "1080p": "1080p",
  "720p": "720p",
  vertical_blur_9_16: "9:16 Blur",
  vertical_crop_9_16: "9:16 Crop",
};

export function formatCustomPresetSpec(preset: CustomExportPreset): string {
  const parts: string[] = [preset.container.toUpperCase()];
  if (preset.targetSizeMb !== null && preset.targetSizeMb > 0) {
    parts.push(`${preset.targetSizeMb} MB target`);
  } else if (preset.videoBitrateKbps !== null && preset.videoBitrateKbps > 0) {
    parts.push(`${preset.videoBitrateKbps} kbps`);
  }
  parts.push(SHORT_RES_LABELS[preset.resolution] ?? preset.resolution);
  parts.push(preset.fps === "source" ? "Source fps" : `${preset.fps} fps`);
  if (preset.audioNormalize) parts.push("Normalize");
  if (preset.stretch169) parts.push("Stretch 16:9");
  return parts.join(" · ");
}
