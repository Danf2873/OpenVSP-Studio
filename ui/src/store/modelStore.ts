// Model state, selection, and the decoded mesh cache.
//
// model_changed events are debounced (50 ms) and turned into the smallest
// re-mesh that is correct:
//   - dirty:   only geoms reported dirty by parms.set / xsec edits (plus any
//              shown geom that has no mesh yet)
//   - missing: only shown geoms without a cached mesh (visibility / sets)
//   - all:     everything (structural changes, undo/redo, unknown methods)

import { create } from "zustand";
import { decodeF32, decodeU32 } from "../api/client";
import { vsp } from "../api/vsp";
import type { GeomMesh, GeomMeshRaw, Id, ModelState, XsecRef } from "../api/types";

export interface LastChange {
  seq: number;
  /** True when every change was a plain parm edit (inspector need not reload). */
  parmsOnly: boolean;
  method: string;
}

interface ModelStoreState {
  model: ModelState | null;
  /** Bumps whenever the model state (structure, names, shown flags) is refreshed. */
  stateRevision: number;
  lastChange: LastChange;

  selectedGeomId: Id | null;
  selectedXsec: XsecRef | null;

  meshes: Record<Id, GeomMesh>;
  meshRevision: number;

  setSelected: (id: Id | null) => void;
  setSelectedXsec: (ref: XsecRef | null) => void;
  /** Geoms whose geometry changed; the next refresh re-meshes just these. */
  noteDirty: (ids: Id[]) => void;
  /** Queue a refresh for a model_changed method (debounced). */
  requestRefresh: (method: string) => void;
  /** Refresh model state and every mesh now. */
  refreshNow: () => Promise<void>;
}

const NO_MESH_EXACT = new Set(["geom.rename", "geom.setColor", "geom.setShown", "app.info"]);
const NO_MESH_PREFIX = ["sets.", "links.", "measure.", "results."];
const STRUCTURAL_PREFIX = ["model.", "io.", "console.", "geom.add", "geom.delete", "geom.paste", "geom.cut", "geom.reparent"];

function isNoMesh(method: string): boolean {
  return NO_MESH_EXACT.has(method) || NO_MESH_PREFIX.some((p) => method.startsWith(p));
}

function isStructural(method: string): boolean {
  return STRUCTURAL_PREFIX.some((p) => method.startsWith(p));
}

type Mode = "all" | "dirty" | "missing";

function decideMode(methods: string[], hasDirty: boolean): Mode {
  if (methods.some(isStructural)) return "all";
  if (hasDirty) return "dirty";
  if (methods.every(isNoMesh)) return "missing";
  return "all";
}

function decodeMesh(raw: GeomMeshRaw): GeomMesh {
  return {
    geomId: raw.geomId,
    bbox: raw.bbox,
    surfaces: raw.surfaces.map((s) => ({
      positions: decodeF32(s.positions),
      normals: decodeF32(s.normals),
      indices: decodeU32(s.indices),
      wire: decodeU32(s.wire),
    })),
  };
}

export const useModelStore = create<ModelStoreState>()((set, get) => ({
  model: null,
  stateRevision: 0,
  lastChange: { seq: 0, parmsOnly: true, method: "" },

  selectedGeomId: null,
  selectedXsec: null,

  meshes: {},
  meshRevision: 0,

  setSelected: (id) => {
    if (id === get().selectedGeomId) return;
    set({ selectedGeomId: id, selectedXsec: null });
  },

  setSelectedXsec: (ref) => set({ selectedXsec: ref }),

  noteDirty: (ids) => {
    for (const id of ids) dirtySet.add(id);
  },

  requestRefresh: (method) => {
    pendingMethods.push(method);
    if (timer === null) {
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, 50);
    }
  },

  refreshNow: () =>
    new Promise<void>((resolve) => {
      refreshWaiters.push(resolve);
      get().requestRefresh("model.state");
    }),
}));

// ---------- scheduler (module-private) ----------

let timer: ReturnType<typeof setTimeout> | null = null;
let pendingMethods: string[] = [];
const dirtySet = new Set<Id>();
let draining = false;
let changeSeq = 0;
const refreshWaiters: Array<() => void> = [];

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (pendingMethods.length > 0) {
      const methods = pendingMethods;
      pendingMethods = [];
      const dirty = [...dirtySet];
      dirtySet.clear();
      await applyChange(methods, decideMode(methods, dirty.length > 0), dirty);
    }
  } finally {
    draining = false;
    const waiters = refreshWaiters.splice(0);
    waiters.forEach((w) => w());
  }
}

async function applyChange(methods: string[], mode: Mode, dirty: Id[]): Promise<void> {
  let state: ModelState;
  try {
    state = await vsp.modelState({ silent: true });
  } catch {
    return; // engine down; the status indicator explains it
  }

  const store = useModelStore.getState();
  const ids = new Set(state.geoms.map((g) => g.id));

  const meshes: Record<Id, GeomMesh> = {};
  for (const [k, v] of Object.entries(store.meshes)) if (ids.has(k)) meshes[k] = v;

  const missingShown = state.geoms.filter((g) => g.shown && !meshes[g.id]).map((g) => g.id);
  const selected = store.selectedGeomId && ids.has(store.selectedGeomId) ? store.selectedGeomId : null;
  const selectedXsec =
    store.selectedXsec && ids.has(store.selectedXsec.geomId) && selected === store.selectedXsec.geomId
      ? store.selectedXsec
      : null;

  changeSeq += 1;
  useModelStore.setState({
    model: state,
    stateRevision: store.stateRevision + 1,
    lastChange: {
      seq: changeSeq,
      parmsOnly: methods.every((m) => m.startsWith("parms.set")),
      method: methods[methods.length - 1] ?? "",
    },
    selectedGeomId: selected,
    selectedXsec,
    meshes,
  });

  let fetchIds: Id[] | undefined;
  if (mode === "all") {
    fetchIds = undefined; // mesh.get with no ids = every shown geom
  } else if (mode === "dirty") {
    fetchIds = [...new Set([...dirty.filter((d) => ids.has(d)), ...missingShown])];
  } else {
    fetchIds = missingShown;
  }

  if (mode !== "all" && fetchIds !== undefined && fetchIds.length === 0) return;

  try {
    const res = await vsp.meshGet(fetchIds);
    const current = useModelStore.getState();
    const next: Record<Id, GeomMesh> = mode === "all" ? {} : { ...current.meshes };
    for (const k of Object.keys(next)) if (!ids.has(k)) delete next[k];
    for (const raw of res.meshes) {
      if (ids.has(raw.geomId)) next[raw.geomId] = decodeMesh(raw);
    }
    useModelStore.setState({ meshes: next, meshRevision: current.meshRevision + 1 });
  } catch {
    // Non-silent call already raised a toast via the client.
  }
}

/** Convenience for components that need the decoded mesh of one geom. */
export function selectGeomMesh(id: Id | null | undefined): GeomMesh | undefined {
  if (!id) return undefined;
  return useModelStore.getState().meshes[id];
}

// ---------------------------------------------------------------------------
// Selection sync between windows (main app <-> cross-section pop-out).
// Each window has its own store; the engine is shared, so only the UI
// selection needs to travel. Messages applied from the channel are not echoed.
type SelMsg =
  | { kind: "sel"; geomId: Id | null; xsec: XsecRef | null }
  | { kind: "hello" };

const selChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("openvsp-studio-selection") : null;
let applyingRemote = false;

if (selChannel) {
  const post = () => {
    const s = useModelStore.getState();
    selChannel.postMessage({ kind: "sel", geomId: s.selectedGeomId, xsec: s.selectedXsec } satisfies SelMsg);
  };
  useModelStore.subscribe((s, prev) => {
    if (applyingRemote) return;
    if (s.selectedGeomId !== prev.selectedGeomId || s.selectedXsec !== prev.selectedXsec) post();
  });
  selChannel.onmessage = (e: MessageEvent<SelMsg>) => {
    const msg = e.data;
    if (msg.kind === "hello") {
      post();
      return;
    }
    const s = useModelStore.getState();
    const sameXsec = JSON.stringify(s.selectedXsec) === JSON.stringify(msg.xsec);
    if (s.selectedGeomId === msg.geomId && sameXsec) return;
    applyingRemote = true;
    useModelStore.setState({ selectedGeomId: msg.geomId, selectedXsec: msg.xsec });
    applyingRemote = false;
  };
  // A newly opened window asks the others for the current selection.
  selChannel.postMessage({ kind: "hello" } satisfies SelMsg);
}
