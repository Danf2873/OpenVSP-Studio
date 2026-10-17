// One-time wiring between the transport, the stores, and the settings.
// Called from main.tsx before React mounts. Idempotent.

import { onCallError, onEvent, onLog, onStatus, startTransport } from "../api/client";
import { loadSettings } from "../api/settings";
import { vsp } from "../api/vsp";
import { useAppStore } from "./appStore";
import { useModelStore } from "./modelStore";
import { useUiStore } from "./uiStore";

let booted = false;

async function loadAppInfo(): Promise<void> {
  if (useAppStore.getState().appInfo) return;
  try {
    const info = await vsp.appInfo({ silent: true });
    useAppStore.getState().setAppInfo(info);
  } catch (err) {
    useAppStore.getState().setAppInfoError(err instanceof Error ? err.message : "Engine did not answer");
  }
}

export function boot(): void {
  if (booted) return;
  booted = true;

  onStatus((status) => {
    useAppStore.getState().setEngine(status);
    if (status.running) {
      void loadAppInfo();
      useModelStore.getState().requestRefresh("model.state");
    }
  });

  onLog((entry) => useAppStore.getState().pushLog(entry.level, entry.text));

  onEvent((e) => {
    switch (e.event) {
      case "ready": {
        const d = e.data as { version?: string };
        if (typeof d.version === "string") useAppStore.getState().setEngineVersion(d.version);
        void loadAppInfo();
        useModelStore.getState().requestRefresh("model.state");
        break;
      }
      case "model_changed": {
        const d = e.data as { method?: string };
        useModelStore.getState().requestRefresh(typeof d.method === "string" ? d.method : "model.state");
        break;
      }
      case "job_progress": {
        const d = e.data as { jobId: string; text: string };
        useAppStore.getState().jobProgress(d.jobId, d.text);
        break;
      }
      case "job_done": {
        const d = e.data as { jobId: string };
        useAppStore.getState().jobFinished(d.jobId);
        break;
      }
      default:
        break;
    }
  });

  onCallError((err, method) => {
    useAppStore
      .getState()
      .pushToast("error", err.message, err.traceback ? `${method}\n${err.traceback}` : method);
  });

  void loadSettings().then((s) => {
    useUiStore.getState().applyLoaded(s.theme, s.density);
    useUiStore.setState({ recentFiles: s.recentFiles });
  });

  startTransport();
}
