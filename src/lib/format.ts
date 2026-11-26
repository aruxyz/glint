import type { ExportPreset, SourceType } from "./types";

const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  nvidia: "NVIDIA",
  amd_relive: "AMD ReLive",
  obs: "OBS",
  steam: "Steam",
  medal: "Medal.tv",
  ascent: "Ascent.gg",
  outplayed: "Outplayed",
  steelseries: "SteelSeries",
  xbox: "Xbox",
  custom: "Custom",
};

export function formatSourceTypeLabel(sourceType: SourceType): string {
  return SOURCE_TYPE_LABELS[sourceType] ?? sourceType;
}

export function formatHardwareEncoderLabel(
  encoder: string | null | undefined,
  hasNvenc?: boolean,
  hasAmf?: boolean,
  hasQsv?: boolean
): string {
  if (encoder === "h264_nvenc") return "NVIDIA NVENC";
  if (encoder === "h264_amf") return "AMD AMF";
  if (encoder === "h264_qsv") return "Intel QuickSync";
  if (hasNvenc) return "NVIDIA NVENC";
  if (hasAmf) return "AMD AMF";
  if (hasQsv) return "Intel QuickSync";
  return "CPU x264";
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const rounded = Math.floor(seconds);
  const hrs = Math.floor(rounded / 3600);
  const mins = Math.floor((rounded % 3600) / 60);
  const secs = rounded % 60;
  if (hrs > 0) {
    return `${hrs}:${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}

export function formatTimecode(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00.00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const centis = Math.floor((seconds - Math.floor(seconds)) * 100);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(centis).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 MB";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIdx = 0;
  while (value >= 1024 && unitIdx < units.length - 1) {
    value /= 1024;
    unitIdx += 1;
  }
  const decimals = unitIdx <= 1 ? 0 : value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${units[unitIdx]}`;
}

export function formatGb(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0.0";
  return (bytes / (1024 * 1024 * 1024)).toFixed(1);
}

export function formatRelativeTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const now = new Date();
  const timeStr = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const dayDiff = Math.round((startOfToday - startOfDate) / 86_400_000);

  if (dayDiff === 0) return `Today ${timeStr}`;
  if (dayDiff === 1) return `Yesterday ${timeStr}`;

  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${months[date.getMonth()]} ${date.getDate()}, ${timeStr}`;
}

export function estimateExportBytes(
  trimDurationSec: number,
  totalSizeBytes: number,
  totalDurationSec: number,
  preset: ExportPreset
): number {
  const safeTotalDur = totalDurationSec > 0 ? totalDurationSec : 1;
  const ratio = Math.min(1, Math.max(0.01, trimDurationSec / safeTotalDur));
  const proportionalBytes = Math.round(totalSizeBytes * ratio);

  if (preset === "lossless_trim") {
    return proportionalBytes;
  }
  if (preset === "discord_10mb") {
    const cap = Math.round(9.5 * 1024 * 1024);
    return Math.min(cap, proportionalBytes);
  }
  const cap25 = Math.round(23.8 * 1024 * 1024);
  return Math.min(cap25, proportionalBytes);
}

export function getWindowsDrive(path: string): string | null {
  const match = path.trim().match(/^([A-Za-z]:)/);
  return match ? match[1].toUpperCase() : null;
}

export function joinSuggestedHardlinkDir(watchPath: string): string {
  const trimmed = watchPath.trim().replace(/[\\/]+$/, "");
  const drive = getWindowsDrive(trimmed);
  if (!drive) return "Glint Links";
  const parts = trimmed.split(/[\\/]/).filter(Boolean);
  if (parts.length >= 2 && parts[1].toLowerCase() === "videos") {
    return `${drive}\\Videos\\Glint Links`;
  }
  return `${drive}\\Glint Links`;
}
