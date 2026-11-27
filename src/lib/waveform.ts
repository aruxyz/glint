import type { AudioTrack, AudioTrackMix, WaveformResponse } from "./types";

const waveformCache = new Map<string, number[]>();

export function getCachedWaveform(cacheKey: string): number[] | undefined {
  return waveformCache.get(cacheKey);
}

export async function fetchWaveformCached(
  url: string,
  cacheKey: string,
  signal?: AbortSignal
): Promise<number[]> {
  const cached = waveformCache.get(cacheKey);
  if (cached) return cached;
  if (!url) return [];

  const res = await fetch(url, { signal });
  if (!res.ok) return [];
  const data = (await res.json()) as WaveformResponse;
  const peaks = Array.isArray(data?.peaks) ? data.peaks : [];
  waveformCache.set(cacheKey, peaks);
  return peaks;
}

export function resamplePeaks(peaks: number[], targetCount: number): number[] {
  if (peaks.length === 0 || targetCount <= 0) return [];
  if (peaks.length <= targetCount) return peaks;

  const result: number[] = new Array(targetCount);
  const step = peaks.length / targetCount;
  for (let i = 0; i < targetCount; i++) {
    const start = Math.floor(i * step);
    const end = Math.max(start + 1, Math.floor((i + 1) * step));
    let maxVal = 0;
    for (let j = start; j < end && j < peaks.length; j++) {
      if (peaks[j] > maxVal) maxVal = peaks[j];
    }
    result[i] = maxVal;
  }
  return result;
}

export function sliceAndResamplePeaks(
  peaks: number[],
  startSec: number,
  endSec: number,
  totalDurationSec: number,
  targetCount: number
): number[] {
  if (peaks.length === 0 || targetCount <= 0) return [];
  const safeDur = totalDurationSec > 0 ? totalDurationSec : 1;
  const clampedStart = Math.max(0, Math.min(safeDur, startSec));
  const clampedEnd = Math.max(clampedStart, Math.min(safeDur, endSec));
  const startIdx = Math.min(
    peaks.length - 1,
    Math.max(0, Math.floor((clampedStart / safeDur) * peaks.length))
  );
  const endIdx = Math.min(
    peaks.length,
    Math.max(startIdx + 1, Math.ceil((clampedEnd / safeDur) * peaks.length))
  );
  return resamplePeaks(peaks.slice(startIdx, endIdx), targetCount);
}

export function mixTrackPeaks(
  tracks: AudioTrack[],
  mixes: AudioTrackMix[],
  peaksByOrder: Record<number, number[]>
): number[] {
  const mixByOrder = new Map<number, AudioTrackMix>();
  for (const m of mixes) {
    mixByOrder.set(m.trackOrder, m);
  }

  const activeEntries: Array<{ peaks: number[]; weight: number }> = [];
  for (const track of tracks) {
    const peaks = peaksByOrder[track.trackOrder];
    if (!peaks || peaks.length === 0) continue;
    const mix = mixByOrder.get(track.trackOrder);
    if (mix?.muted) continue;
    const weight = mix ? Math.max(0, mix.volume) : 1;
    if (weight <= 0) continue;
    activeEntries.push({ peaks, weight });
  }

  if (activeEntries.length === 0) {
    const anyPeaks = Object.values(peaksByOrder).find((p) => p.length > 0);
    return anyPeaks ? new Array(anyPeaks.length).fill(0) : [];
  }

  const len = Math.max(...activeEntries.map((e) => e.peaks.length));
  const totalWeight = activeEntries.reduce((sum, e) => sum + e.weight, 0) || 1;
  const out: number[] = new Array(len);
  for (let i = 0; i < len; i++) {
    let acc = 0;
    for (const entry of activeEntries) {
      const val = entry.peaks[i] ?? 0;
      acc += val * entry.weight;
    }
    out[i] = Math.min(1, Math.max(0, acc / totalWeight));
  }
  return out;
}
