// App-level state: engine status, app info, logs, running jobs, toasts.

import { create } from "zustand";
import type { AppInfo, EngineStatus, LogLevel } from "../api/types";

export type EngineState = "connecting" | "running" | "restarting" | "stopped";

export interface LogEntry {
  id: number;
  time: number;
  level: LogLevel;
  text: string;
}

export interface JobInfo {
  jobId: string;
  text: string;
  startedAt: number;
}

export type ToastKind = "error" | "info" | "success";

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
}

const LOG_CAP = 2000;
const TOAST_CAP = 5;
let logSeq = 0;
let toastSeq = 0;

interface AppState {
  appInfo: AppInfo | null;
  appInfoError: string | null;

  engine: EngineState;
  engineCode?: number;
  engineVersion: string | null;

  logs: LogEntry[];
  lastLog: LogEntry | null;

  jobs: JobInfo[];

  toasts: Toast[];

  setAppInfo: (info: AppInfo) => void;
  setAppInfoError: (message: string | null) => void;
  setEngine: (status: EngineStatus) => void;
  setEngineVersion: (version: string) => void;
  pushLog: (level: LogLevel, text: string) => void;
  clearLogs: () => void;
  jobProgress: (jobId: string, text: string) => void;
  jobFinished: (jobId: string) => void;
  pushToast: (kind: ToastKind, message: string, detail?: string) => void;
  dismissToast: (id: number) => void;
}

export const useAppStore = create<AppState>()((set, get) => ({
  appInfo: null,
  appInfoError: null,

  engine: "connecting",
  engineCode: undefined,
  engineVersion: null,

  logs: [],
  lastLog: null,

  jobs: [],

  toasts: [],

  setAppInfo: (info) => set({ appInfo: info, appInfoError: null }),

  setAppInfoError: (message) => set({ appInfoError: message }),

  setEngine: (status) => {
    const state: EngineState = status.running
      ? "running"
      : status.code !== undefined
        ? "stopped"
        : "restarting";
    set({ engine: state, engineCode: status.code });
  },

  setEngineVersion: (version) => set({ engineVersion: version }),

  pushLog: (level, text) => {
    const entry: LogEntry = { id: ++logSeq, time: Date.now(), level, text };
    const next = get().logs;
    const logs = next.length >= LOG_CAP ? [...next.slice(next.length - LOG_CAP + 1), entry] : [...next, entry];
    set({ logs, lastLog: entry });
  },

  clearLogs: () => set({ logs: [], lastLog: null }),

  jobProgress: (jobId, text) => {
    const jobs = get().jobs;
    const idx = jobs.findIndex((j) => j.jobId === jobId);
    if (idx >= 0) {
      const copy = jobs.slice();
      copy[idx] = { ...copy[idx], text };
      set({ jobs: copy });
    } else {
      set({ jobs: [...jobs, { jobId, text, startedAt: Date.now() }] });
    }
  },

  jobFinished: (jobId) => set({ jobs: get().jobs.filter((j) => j.jobId !== jobId) }),

  pushToast: (kind, message, detail) => {
    const toast: Toast = { id: ++toastSeq, kind, message, detail };
    set({ toasts: [...get().toasts, toast].slice(-TOAST_CAP) });
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
}));
