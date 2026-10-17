// The analysis currently shown over the 3D model. Set while the Analyses pane is
// open on an analysis; cleared when the pane closes or another analysis is picked.

import { create } from "zustand";
import type { OverlayData, OverlayProgress } from "../api/types";

export interface ActiveOverlay {
  analysis: string;
  data: OverlayData | null;
  progress: OverlayProgress | null;
}

interface OverlayState {
  active: ActiveOverlay | null;
  /** Start showing an analysis (no data yet). */
  show: (analysis: string) => void;
  /** Stop showing any overlay. */
  clear: () => void;
  /** Store the overlay for `analysis`; ignored if that analysis is no longer active. */
  setData: (analysis: string, data: OverlayData | null) => void;
  /** Store live progress for `analysis`; ignored if that analysis is no longer active. */
  setProgress: (analysis: string, progress: OverlayProgress | null) => void;
}

export const useOverlayStore = create<OverlayState>()((set) => ({
  active: null,

  show: (analysis) =>
    set((st) =>
      st.active?.analysis === analysis ? st : { active: { analysis, data: null, progress: null } },
    ),

  clear: () => set({ active: null }),

  setData: (analysis, data) =>
    set((st) => (st.active?.analysis === analysis ? { active: { ...st.active, data } } : st)),

  setProgress: (analysis, progress) =>
    set((st) => (st.active?.analysis === analysis ? { active: { ...st.active, progress } } : st)),
}));
