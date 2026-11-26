import { useCallback, useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { isTauriRuntime } from "../lib/api";

export function useAutoUpdater() {
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauriRuntime()) return;
    let active = true;

    const runCheck = async () => {
      try {
        const update = await check();
        if (active && update) {
          setAvailableUpdate(update);
        }
      } catch {
        // Ignore offline or update endpoint errors at startup.
      }
    };

    void runCheck();
    return () => {
      active = false;
    };
  }, []);

  const installUpdate = useCallback(async () => {
    if (!availableUpdate || installing) return;
    setInstalling(true);
    setError(null);
    setProgressPercent(0);

    let totalBytes = 0;
    let downloadedBytes = 0;

    try {
      await availableUpdate.downloadAndInstall((event) => {
        if (event.event === "Started") {
          totalBytes = event.data.contentLength ?? 0;
          downloadedBytes = 0;
          setProgressPercent(0);
        } else if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setProgressPercent(Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)));
          }
        } else if (event.event === "Finished") {
          setProgressPercent(100);
        }
      });
      await relaunch();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to install update.");
      setInstalling(false);
    }
  }, [availableUpdate, installing]);

  const dismissUpdate = useCallback(() => {
    if (installing) return;
    setDismissed(true);
  }, [installing]);

  return {
    update: availableUpdate && !dismissed ? availableUpdate : null,
    installing,
    progressPercent,
    error,
    installUpdate,
    dismissUpdate,
  };
}
