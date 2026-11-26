import { useEffect, useRef } from "react";
import { Volume2, VolumeX, X } from "lucide-react";
import type { AudioTrack, AudioTrackMix } from "../lib/types";

interface AudioMixerPopoverProps {
  open: boolean;
  tracks: AudioTrack[];
  mixes: AudioTrackMix[];
  soloTrackOrder: number | null;
  onChangeMix: (trackOrder: number, next: Partial<AudioTrackMix>) => void;
  onToggleSolo: (trackOrder: number) => void;
  onClose: () => void;
}

export function AudioMixerPopover({
  open,
  tracks,
  mixes,
  soloTrackOrder,
  onChangeMix,
  onToggleSolo,
  onClose,
}: AudioMixerPopoverProps) {
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    window.addEventListener("mousedown", handleOutside);
    return () => window.removeEventListener("mousedown", handleOutside);
  }, [open, onClose]);

  if (!open) return null;

  const isMultiTrack = tracks.length > 1;

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label="Audio Mixer"
      className="glass-dock popover-enter origin-bottom-right absolute right-0 bottom-12 z-40 w-[320px] rounded-[12px] p-4"
    >
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border-hairline)] pb-2.5">
        <span className="text-[13px] font-semibold text-[var(--text-primary)]">
          Audio Mixer ({tracks.length || 1} {tracks.length === 1 ? "track" : "tracks"})
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Audio Mixer"
          className="btn-icon flex h-7 w-7 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-slate-900/[0.06] hover:text-[var(--text-primary)]"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </div>

      <div className="mt-3 space-y-3">
        {tracks.map((track) => {
          const mix = mixes.find((m) => m.trackOrder === track.trackOrder) ?? {
            trackOrder: track.trackOrder,
            streamIndex: track.streamIndex,
            muted: false,
            volume: 1,
          };
          const isSolo = soloTrackOrder === track.trackOrder;
          const suppressedBySolo = soloTrackOrder !== null && !isSolo;
          const pct = Math.round(mix.volume * 100);
          const trackTitle =
            track.label?.trim() || `Track ${track.trackOrder + 1}`;

          return (
            <div
              key={track.id || track.trackOrder}
              className="rounded-[8px] border border-[var(--border-hairline)] bg-[var(--surface-card)] p-2.5 shadow-[var(--border-card-specular)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-[12px] font-semibold text-[var(--text-primary)]">
                  {trackTitle}
                </span>
                <div className="flex shrink-0 items-center gap-1">
                  {mix.muted && (
                    <span className="rounded bg-[var(--status-error-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--status-error-fg)]">
                      Muted
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      onChangeMix(track.trackOrder, { muted: !mix.muted })
                    }
                    aria-label={`Mute ${trackTitle}`}
                    aria-pressed={mix.muted}
                    title="Mute track"
                    className={`btn-icon flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold ${
                      mix.muted
                        ? "bg-[var(--status-error-bg)] text-[var(--status-error-fg)]"
                        : "bg-slate-900/[0.06] text-[var(--text-secondary)] hover:bg-slate-900/[0.12]"
                    }`}
                  >
                    {mix.muted ? (
                      <VolumeX className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <Volume2 className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                  {isMultiTrack && (
                    <button
                      type="button"
                      onClick={() => onToggleSolo(track.trackOrder)}
                      aria-label={`Solo ${trackTitle}`}
                      aria-pressed={isSolo}
                      title="Solo track"
                      className={`btn-icon flex h-6 w-6 items-center justify-center rounded text-[11px] font-bold ${
                        isSolo
                          ? "bg-[var(--accent-primary)] text-white"
                          : "bg-slate-900/[0.06] text-[var(--text-secondary)] hover:bg-slate-900/[0.12]"
                      }`}
                    >
                      S
                    </button>
                  )}
                </div>
              </div>

              <div className="mt-2 flex items-center gap-2.5">
                <input
                  type="range"
                  aria-label={`${trackTitle} volume`}
                  min={0}
                  max={2}
                  step={0.05}
                  value={mix.volume}
                  disabled={suppressedBySolo}
                  onChange={(e) =>
                    onChangeMix(track.trackOrder, {
                      volume: Number(e.target.value),
                    })
                  }
                  className="h-1.5 flex-1 accent-[var(--accent-primary)]"
                />
                <span className="font-mono-tabular w-11 text-right text-[11px] font-medium text-[var(--text-secondary)]">
                  {pct}%
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-3 border-t border-[var(--border-hairline)] pt-2.5 text-[11px] leading-4 text-[var(--text-muted)]">
        {isMultiTrack
          ? "Playback levels also apply when exporting to Discord."
          : "Single audio track in this file."}
      </p>
    </div>
  );
}
