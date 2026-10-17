// Run state for analyses. Lives outside the pane so a running job keeps its
// progress and result when the sidebar tab is switched away and back.
//
// While a run is in flight, the 3D overlay for that analysis is polled every
// PROGRESS_MS (overlay.progress is answered by the engine during the job) and the
// final overlay is fetched when the run ends. Both only apply while that analysis
// is the active overlay (see overlayStore).

import { create } from "zustand";
import type { OverlayData, OverlayItem } from "../../api/types";
import { vsp } from "../../api/vsp";
import { useOverlayStore } from "../../store/overlayStore";
import { PREP_ANALYSIS } from "./analysisInfo";

export type StepState = "pending" | "active" | "done" | "error";

export interface RunStep {
  label: string;
  state: StepState;
}

export interface RunRecord {
  name: string;
  status: "running" | "done" | "error";
  startedAt: number;
  endedAt: number | null;
  steps: RunStep[];
  resultId: string | null;
  summary: { name: string; value: unknown }[];
  error: string | null;
}

interface RunStoreState {
  runs: Record<string, RunRecord>;
  /** Name of the analysis currently running, or null. The engine runs one job at a time. */
  busyName: string | null;
  run: (name: string) => Promise<void>;
  forget: (name: string) => void;
}

const PROGRESS_MS = 500;

function messageOf(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  if (typeof err === "string" && err) return err;
  return "The analysis failed.";
}

/** Poll overlay.progress until the returned stop function is called. */
function startLivePolling(name: string): () => void {
  let stopped = false;
  let timer: number | undefined;

  const tick = async () => {
    try {
      const progress = await vsp.overlayProgress(name);
      if (stopped) return;
      const overlay = useOverlayStore.getState();
      overlay.setProgress(name, progress);
      if (progress.strips) overlay.setData(name, liveOverlay(name, progress.strips));
    } catch {
      // Silent by design: the next tick retries.
    }
    if (!stopped) timer = window.setTimeout(() => void tick(), PROGRESS_MS);
  };

  void tick();
  return () => {
    stopped = true;
    if (timer !== undefined) window.clearTimeout(timer);
  };
}

function liveOverlay(name: string, strips: Extract<OverlayItem, { kind: "strips" }>): OverlayData {
  let min = Infinity;
  let max = -Infinity;
  for (const v of strips.values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  const hasRange = Number.isFinite(min) && Number.isFinite(max);
  return {
    analysis: name,
    title: `${name} · live`,
    items: [strips],
    legend: hasRange ? { label: "Cl", min, max, colormap: "cool-warm" } : undefined,
  };
}

/** After a run ends: drop live progress and show the saved overlay, if this analysis is still active. */
async function refreshOverlay(name: string): Promise<void> {
  const overlay = useOverlayStore.getState();
  overlay.setProgress(name, null);
  if (overlay.active?.analysis !== name) return;
  try {
    const data = await vsp.overlayGet(name);
    useOverlayStore.getState().setData(name, data);
  } catch {
    // Keep whatever is shown; the Analyses pane reports engine errors itself.
  }
}

export const useRunStore = create<RunStoreState>()((set, get) => {
  const patchRun = (name: string, patch: Partial<RunRecord>) =>
    set((st) => {
      const cur = st.runs[name];
      if (!cur) return st;
      return { runs: { ...st.runs, [name]: { ...cur, ...patch } } };
    });

  const setStep = (name: string, index: number, state: StepState) =>
    set((st) => {
      const cur = st.runs[name];
      if (!cur) return st;
      const steps = cur.steps.map((step, i) => (i === index ? { ...step, state } : step));
      return { runs: { ...st.runs, [name]: { ...cur, steps } } };
    });

  return {
    runs: {},
    busyName: null,

    run: async (name) => {
      if (get().busyName !== null) return;
      const prep = PREP_ANALYSIS[name];
      const steps: RunStep[] = [];
      if (prep) steps.push({ label: `Prepare geometry (${prep})`, state: "pending" });
      steps.push({ label: `Run ${name}`, state: "pending" });
      const mainIndex = prep ? 1 : 0;

      set((st) => ({
        busyName: name,
        runs: {
          ...st.runs,
          [name]: {
            name,
            status: "running",
            startedAt: Date.now(),
            endedAt: null,
            steps,
            resultId: null,
            summary: [],
            error: null,
          },
        },
      }));

      let stopLive: (() => void) | null = null;
      let current = 0;
      try {
        // Record where the files will appear before the solver writes them.
        await vsp.overlayPrepare(name).catch(() => undefined);
        stopLive = startLivePolling(name);

        if (prep) {
          setStep(name, 0, "active");
          await vsp.analysisRunJob(prep);
          setStep(name, 0, "done");
          current = 1;
        }
        setStep(name, mainIndex, "active");
        const res = await vsp.analysisRunJob(name);
        setStep(name, mainIndex, "done");
        patchRun(name, {
          status: "done",
          endedAt: Date.now(),
          resultId: res?.resultId ?? null,
          summary: res?.summary ?? [],
        });
      } catch (err) {
        set((st) => {
          const cur = st.runs[name];
          if (!cur) return st;
          const failed = cur.steps.map((step, i) => (i === current ? { ...step, state: "error" as StepState } : step));
          return {
            runs: {
              ...st.runs,
              [name]: { ...cur, status: "error", endedAt: Date.now(), steps: failed, error: messageOf(err) },
            },
          };
        });
      } finally {
        stopLive?.();
        set({ busyName: null });
        void refreshOverlay(name);
      }
    },

    forget: (name) =>
      set((st) => {
        if (!(name in st.runs) || st.runs[name].status === "running") return st;
        const next = { ...st.runs };
        delete next[name];
        return { runs: next };
      }),
  };
});
