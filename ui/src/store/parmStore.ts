// Live parameter values, so edits show instantly and stay consistent with the
// ParmSetResult (parm + changed) that the engine returns.

import { create } from "zustand";
import type { Id, ParmSetResult } from "../api/types";

interface ParmStoreState {
  /** Latest known value per parm id; overrides the value in ParmGroup. */
  values: Record<Id, number>;
  setLocal: (id: Id, value: number) => void;
  /**
   * Apply a parms.set result. When skipSelf is true the edited parm's own
   * value is left alone (a newer local edit is still queued).
   */
  applyResult: (res: ParmSetResult, skipSelf?: boolean) => void;
  /** Forget overrides (e.g. after the inspector reloads groups). */
  reset: () => void;
}

export const useParmStore = create<ParmStoreState>()((set, get) => ({
  values: {},

  setLocal: (id, value) => set({ values: { ...get().values, [id]: value } }),

  applyResult: (res, skipSelf = false) => {
    const values = { ...get().values };
    for (const ch of res.changed) values[ch.id] = ch.value;
    if (!skipSelf) values[res.parm.id] = res.parm.value;
    set({ values });
  },

  reset: () => set({ values: {} }),
}));
