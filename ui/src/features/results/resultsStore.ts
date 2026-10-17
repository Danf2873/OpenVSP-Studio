// Results pane state that other panes need: which result to show, and the
// order results were first seen (the engine lists them by name, not by time).

import { create } from "zustand";

interface ResultsFocusState {
  /** Result to select the next time the Results pane shows it. Consumed by the pane. */
  focusId: string | null;
  setFocus: (id: string | null) => void;
}

export const useResultsFocus = create<ResultsFocusState>()((set) => ({
  focusId: null,
  setFocus: (id) => set({ focusId: id }),
}));

interface ResultOrderState {
  /** Sequence number at first sight of each result id. Higher is newer. */
  seen: Record<string, number>;
  counter: number;
  /** Record ids in list order; ids not seen before get the next sequence numbers. */
  note: (ids: string[]) => void;
  reset: () => void;
}

export const useResultOrder = create<ResultOrderState>()((set, get) => ({
  seen: {},
  counter: 0,
  note: (ids) => {
    const next = { ...get().seen };
    let counter = get().counter;
    let changed = false;
    for (const id of ids) {
      if (id in next) continue;
      counter += 1;
      next[id] = counter;
      changed = true;
    }
    if (changed) set({ seen: next, counter });
  },
  reset: () => set({ seen: {}, counter: 0 }),
}));
