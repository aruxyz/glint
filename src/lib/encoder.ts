import type { AppSettings, AspectMode, ExportPreset } from "./types";

export const DEFAULT_SETTINGS: AppSettings = {
  maxStorageGb: 0,
  hardlinkBaseDir: "",
  exportOutputDir: "",
  autoCopyExportToClipboard: true,
  defaultAutoNext: true,
  minimizeToTray: false,
};

export function getEncoderLabel(
  preset: ExportPreset | "montage" | "editor",
  encoderInfo: {
    hasNvenc: boolean;
    hasAmf?: boolean;
    hasQsv?: boolean;
    hardwareEncoder?: string | null;
  },
  aspectMode: AspectMode = "original",
  normalizeAudio = false
): string {
  let base = "CPU x264";
  if (
    encoderInfo.hardwareEncoder === "h264_nvenc" ||
    (!encoderInfo.hardwareEncoder && encoderInfo.hasNvenc)
  ) {
    base = "GPU NVENC";
  } else if (
    encoderInfo.hardwareEncoder === "h264_amf" ||
    (!encoderInfo.hardwareEncoder && encoderInfo.hasAmf)
  ) {
    base = "GPU AMD AMF";
  } else if (
    encoderInfo.hardwareEncoder === "h264_qsv" ||
    (!encoderInfo.hardwareEncoder && encoderInfo.hasQsv)
  ) {
    base = "GPU Intel QSV";
  }
  if (preset === "vertical_blur_9_16" || preset === "vertical_crop_9_16") {
    return normalizeAudio ? `${base} (9:16, Norm)` : `${base} (9:16)`;
  }
  if (preset === "lossless_trim" && aspectMode !== "stretch_16_9" && !normalizeAudio) {
    return "Stream Copy (Lossless)";
  }
  const tags: string[] = [];
  if (aspectMode === "stretch_16_9") tags.push("16:9");
  if (normalizeAudio) tags.push("Norm");
  return tags.length > 0 ? `${base} (${tags.join(", ")})` : base;
}
