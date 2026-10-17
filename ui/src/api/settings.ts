// Settings persistence. Tauri: get_settings / set_settings commands.
// Browser: localStorage. Every storage access is guarded.

import { isTauri, tauriInvoke } from "./client";
import type { Settings } from "./types";

const LS_KEY = "openvsp-studio.settings";

export const DEFAULT_SETTINGS: Settings = {
  python: "",
  openvspRoot: "",
  theme: "system",
  density: "comfortable",
  recentFiles: [],
};

function readLocal(): Partial<Settings> {
  try {
    const raw = window.localStorage.getItem(LS_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Partial<Settings>) : {};
  } catch {
    return {};
  }
}

function writeLocal(s: Settings): void {
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(s));
  } catch {
    // Storage blocked or full; settings simply will not persist.
  }
}

function normalize(s: Partial<Settings>): Settings {
  return {
    python: typeof s.python === "string" ? s.python : DEFAULT_SETTINGS.python,
    openvspRoot: typeof s.openvspRoot === "string" ? s.openvspRoot : DEFAULT_SETTINGS.openvspRoot,
    theme: s.theme === "light" || s.theme === "dark" || s.theme === "system" ? s.theme : DEFAULT_SETTINGS.theme,
    density: s.density === "compact" || s.density === "comfortable" ? s.density : DEFAULT_SETTINGS.density,
    recentFiles: Array.isArray(s.recentFiles) ? s.recentFiles.filter((x): x is string => typeof x === "string") : [],
  };
}

export async function loadSettings(): Promise<Settings> {
  const local = readLocal();
  if (isTauri) {
    try {
      const fromShell = await tauriInvoke<Partial<Settings>>("get_settings");
      return normalize({ ...local, ...fromShell });
    } catch {
      return normalize(local);
    }
  }
  return normalize(local);
}

/** Merge a patch into the stored settings and persist it. */
export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const current = normalize({ ...readLocal(), ...(await loadSettingsCachedFallback()) });
  const next = normalize({ ...current, ...patch });
  writeLocal(next);
  if (isTauri) {
    try {
      await tauriInvoke("set_settings", { settings: next });
    } catch {
      // Shell refused; localStorage still has the values.
    }
  }
  return next;
}

async function loadSettingsCachedFallback(): Promise<Partial<Settings>> {
  if (!isTauri) return {};
  try {
    return await tauriInvoke<Partial<Settings>>("get_settings");
  } catch {
    return {};
  }
}

export function engineRestart(): Promise<unknown> {
  return tauriInvoke("engine_restart");
}

export function openPopoutWindow(label: string, title: string, url: string): Promise<unknown> {
  return tauriInvoke("open_window", { label, title, url });
}
