import { useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type { ToastState } from "../components/ExportToast";
import { subscribeAppEvents } from "../lib/api";
import { getEncoderLabel } from "../lib/encoder";
import type { BootstrapState, ScanProgressPayload } from "../lib/types";
import type { ActiveExportMeta } from "./useExportJobs";

interface UseTauriEventsParams {
  bootstrap: BootstrapState | null;
  activeExportMetaRef: MutableRefObject<ActiveExportMeta | null>;
  refreshMetadata: () => Promise<void>;
  loadClips: () => Promise<void>;
  setToast: Dispatch<SetStateAction<ToastState | null>>;
}

export function useTauriEvents({
  bootstrap,
  activeExportMetaRef,
  refreshMetadata,
  loadClips,
  setToast,
}: UseTauriEventsParams) {
  const [scanProgress, setScanProgress] = useState<ScanProgressPayload | null>(null);
  const [scanning, setScanning] = useState(false);

  const latestRef = useRef({
    bootstrap,
    refreshMetadata,
    loadClips,
    setToast,
  });

  latestRef.current = {
    bootstrap,
    refreshMetadata,
    loadClips,
    setToast,
  };

  // Subscribe once on mount; read latest callbacks/metadata via ref so typing search never re-subscribes.
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    let disposed = false;

    subscribeAppEvents({
      onScanProgress: (payload) => {
        setScanProgress(payload);
        setScanning(!payload.done);
        if (payload.done) {
          void latestRef.current.refreshMetadata();
          void latestRef.current.loadClips();
        }
      },
      onClipAdded: () => {
        void latestRef.current.refreshMetadata();
        void latestRef.current.loadClips();
      },
      onClipRemoved: () => {
        void latestRef.current.refreshMetadata();
        void latestRef.current.loadClips();
      },
      onExportProgress: (payload) => {
        const meta = activeExportMetaRef.current;
        if (!meta || meta.jobId !== payload.jobId) return;
        const boot = latestRef.current.bootstrap;
        latestRef.current.setToast({
          kind: "export_progress",
          jobId: payload.jobId,
          fileName:
            meta.fileName ||
            (meta.clip ? meta.clip.title || meta.clip.fileName : "Montage"),
          preset: meta.preset,
          percent: payload.percent,
          etaSec: payload.etaSec,
          encoderLabel: getEncoderLabel(
            meta.preset,
            {
              hasNvenc: Boolean(boot?.hasNvenc),
              hasAmf: Boolean(boot?.hasAmf),
              hasQsv: Boolean(boot?.hasQsv),
              hardwareEncoder: boot?.hardwareEncoder,
            },
            meta.aspectMode,
            meta.normalizeAudio
          ),
        });
      },
      onExportCompleted: (payload) => {
        const meta = activeExportMetaRef.current;
        const fileName =
          payload.outputPath.split(/[\\/]/).pop() || "exported_clip.mp4";
        latestRef.current.setToast({
          kind: "export_completed",
          outputPath: payload.outputPath,
          fileName,
          outputSizeBytes: payload.outputSizeBytes,
          copiedToClipboard: payload.copiedToClipboard,
          encoderUsed: payload.encoderUsed,
        });
        activeExportMetaRef.current = null;
        if ((meta?.preset === "montage" || meta?.preset === "editor") && meta.addToLibrary) {
          void latestRef.current.refreshMetadata();
          void latestRef.current.loadClips();
        }
      },
      onExportFailed: (payload) => {
        const meta = activeExportMetaRef.current;
        const tooLong =
          meta?.preset === "discord_10mb" &&
          /too long|exceeded 10 mb|10\s*mb/i.test(payload.error);
        latestRef.current.setToast({
          kind: "export_error",
          message: payload.error,
          canFallback25Mb: Boolean(tooLong),
        });
      },
    })
      .then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [activeExportMetaRef]);

  return {
    scanProgress,
    scanning,
    setScanning,
  };
}
