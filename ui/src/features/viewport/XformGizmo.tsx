// Transform gizmo for the selected component (inside the Canvas).
//   move:  translate arrows that write X/Y/Z_Rel_Location (world = OpenVSP axes)
//   scale: one uniform scale handle that writes the XForm Scale parm
// Root geoms: the anchor sits at the geom origin (the Rel_Location values).
// Child geoms: the anchor sits at the mesh bbox center; deltas are still
// written to their Rel_Location parms, which is exact only while the parent
// has no rotation or scale.
// Shift snaps (translate step ~1% of model size, scale step 0.05).
// Drags are one undo step (shared coalesceKey), sends are throttled to ~20/s,
// and the rendered mesh is previewed locally until the engine re-meshes.

import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { TransformControls } from "@react-three/drei";
import type { Id, Parm, ParmGroup, Vec3 } from "../../api/types";
import { vsp } from "../../api/vsp";
import { useModelStore } from "../../store/modelStore";
import { markGizmoDragEnd, niceStep, previewGroup } from "./xformPreview";

export type GizmoMode = "move" | "scale" | "off";

const AXIS_PARMS = ["X_Rel_Location", "Y_Rel_Location", "Z_Rel_Location"] as const;
const SEND_MS = 50;
const SCALE_SNAP = 0.05;
const SETTLE_FALLBACK_MS = 1500;

interface XformParms {
  geomId: Id;
  root: boolean;
  ids: { rel: [Id, Id, Id]; scale: Id };
  rel: Vec3;
  scale: number;
}

interface DragState {
  xf: XformParms;
  kind: "move" | "scale";
  coalesceKey: string;
  /** This geom and its descendants; their meshes move with it. */
  ids: Id[];
  startAnchor: THREE.Vector3;
  pivot: THREE.Vector3;
  startRel: Vec3;
  startScale: number;
  targetRel: Vec3;
  targetScale: number;
  /** Last values sent to the engine. */
  sentRel: Vec3;
  sentScale: number;
  /** Values the rendered mesh is believed to show (updated on each re-mesh). */
  basisRel: Vec3;
  basisScale: number;
  lastSendAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  last: Promise<unknown> | null;
  ended: boolean;
  settleRev?: number;
}

// The bits of drei's TransformControls the gizmo reads.
interface TransformControlsLike {
  axis?: string | null;
}

async function loadXform(geomId: Id, root: boolean): Promise<XformParms | null> {
  let groups: ParmGroup[];
  try {
    groups = await vsp.geomParms(geomId, { silent: true });
  } catch {
    return null;
  }
  const byName = new Map<string, Parm>();
  for (const g of groups) {
    for (const p of g.parms) if (p.group === "XForm" || g.group === "XForm") byName.set(p.name, p);
  }
  const rel = AXIS_PARMS.map((n) => byName.get(n));
  const scale = byName.get("Scale");
  if (!rel.every(Boolean) || !scale) return null;
  const [x, y, z] = rel as Parm[];
  return {
    geomId,
    root,
    ids: { rel: [x.id, y.id, z.id], scale: scale.id },
    rel: [x.value, y.value, z.value],
    scale: scale.value,
  };
}

/** The geom and every descendant, in tree order. */
function subtreeIds(rootId: Id): Id[] {
  const geoms = useModelStore.getState().model?.geoms ?? [];
  const out: Id[] = [rootId];
  for (let i = 0; i < out.length; i++) {
    for (const g of geoms) if (g.parentId === out[i] && !out.includes(g.id)) out.push(g.id);
  }
  return out;
}

function anchorPoint(xf: XformParms): THREE.Vector3 {
  if (!xf.root) {
    const m = useModelStore.getState().meshes[xf.geomId];
    if (m) {
      return new THREE.Vector3(...m.bbox.min).add(new THREE.Vector3(...m.bbox.max)).multiplyScalar(0.5);
    }
  }
  return new THREE.Vector3(...xf.rel);
}

/** Snap step: about 1% of the shown model's diagonal, rounded to 1/2/5. */
function snapStepForScene(): number {
  const st = useModelStore.getState();
  const min = new THREE.Vector3(Infinity, Infinity, Infinity);
  const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  let any = false;
  for (const g of st.model?.geoms ?? []) {
    const m = g.shown ? st.meshes[g.id] : undefined;
    if (!m) continue;
    any = true;
    min.min(new THREE.Vector3(...m.bbox.min));
    max.max(new THREE.Vector3(...m.bbox.max));
  }
  const diag = any ? max.clone().sub(min).length() : 1;
  return niceStep(diag / 100);
}

function forEachPreview(d: DragState, fn: (g: THREE.Object3D) => void): void {
  for (const id of d.ids) {
    const g = previewGroup(id);
    if (g) fn(g);
  }
}

/** Offset (move) or scale about the pivot (scale) the mesh group so it shows the target. */
function updatePreview(d: DragState): void {
  if (d.kind === "move") {
    const dx = d.targetRel[0] - d.basisRel[0];
    const dy = d.targetRel[1] - d.basisRel[1];
    const dz = d.targetRel[2] - d.basisRel[2];
    forEachPreview(d, (g) => {
      g.position.set(dx, dy, dz);
      g.scale.set(1, 1, 1);
    });
  } else {
    const r = d.basisScale > 1e-9 ? d.targetScale / d.basisScale : 1;
    forEachPreview(d, (g) => {
      g.scale.setScalar(r);
      g.position.copy(d.pivot).multiplyScalar(1 - r);
    });
  }
}

function resetPreview(d: DragState): void {
  forEachPreview(d, (g) => {
    g.position.set(0, 0, 0);
    g.scale.set(1, 1, 1);
  });
}

export function XformGizmo({ mode }: { mode: GizmoMode }) {
  const selectedId = useModelStore((st) => st.selectedGeomId);
  const geom = useModelStore((st) => st.model?.geoms.find((g) => g.id === st.selectedGeomId));
  const lastSeq = useModelStore((st) => st.lastChange.seq);
  const meshRev = useModelStore((st) => st.meshRevision);
  const shown = !!geom?.shown;
  const isRoot = !!geom && geom.parentId === null;

  const [xf, setXf] = useState<XformParms | null>(null);
  const [snapOn, setSnapOn] = useState(false);
  const [refetchNonce, setRefetchNonce] = useState(0);
  const [anchor] = useState(() => new THREE.Object3D());
  const tc = useRef<TransformControlsLike | null>(null);
  const drag = useRef<DragState | null>(null);
  const snapStep = useMemo(() => snapStepForScene(), [meshRev]);

  // Shift toggles snapping while a handle is dragged.
  useEffect(() => {
    const on = (e: KeyboardEvent) => setSnapOn(e.shiftKey);
    window.addEventListener("keydown", on);
    window.addEventListener("keyup", on);
    return () => {
      window.removeEventListener("keydown", on);
      window.removeEventListener("keyup", on);
    };
  }, []);

  // Load the XForm parms for the selection; refetch after any model change.
  // Skipped mid-drag so the gizmo does not jump under the pointer.
  useEffect(() => {
    if (drag.current) return;
    if (!selectedId) {
      setXf(null);
      return;
    }
    let alive = true;
    void loadXform(selectedId, isRoot).then((res) => {
      if (alive) setXf(res);
    });
    return () => {
      alive = false;
    };
  }, [selectedId, isRoot, lastSeq, refetchNonce]);

  // Keep the anchor on the geom while idle.
  useEffect(() => {
    if (!xf || drag.current) return;
    const p = anchorPoint(xf);
    anchor.position.copy(p);
    anchor.scale.set(1, 1, 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xf, meshRev, mode, anchor]);

  // A re-mesh during a drag shows the last value sent; re-base the preview on it.
  // After the drag, the first re-mesh that follows the final send settles it.
  useEffect(() => {
    const d = drag.current;
    if (!d) return;
    if (!d.ended) {
      d.basisRel = [...d.sentRel] as Vec3;
      d.basisScale = d.sentScale;
      updatePreview(d);
      return;
    }
    if (d.settleRev !== undefined && meshRev !== d.settleRev) settle(d);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meshRev]);

  const settle = (d: DragState) => {
    if (drag.current !== d) return;
    drag.current = null;
    resetPreview(d);
    setRefetchNonce((n) => n + 1);
  };

  const factorFromAnchor = (): number => {
    const s = anchor.scale;
    const axes = tc.current?.axis ?? "XYZ";
    const vals: number[] = [];
    if (axes.includes("X")) vals.push(s.x);
    if (axes.includes("Y")) vals.push(s.y);
    if (axes.includes("Z")) vals.push(s.z);
    if (vals.length === 0) return s.x;
    return vals.reduce((a, b) => a + b, 0) / vals.length;
  };

  const flush = (d: DragState) => {
    d.lastSendAt = performance.now();
    const calls: Promise<unknown>[] = [];
    if (d.kind === "move") {
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d.targetRel[i] - d.sentRel[i]) > 1e-9) {
          d.sentRel[i] = d.targetRel[i];
          calls.push(vsp.parmsSet(d.xf.ids.rel[i], d.targetRel[i], d.coalesceKey).catch(() => undefined));
        }
      }
    } else if (Math.abs(d.targetScale - d.sentScale) > 1e-9) {
      d.sentScale = d.targetScale;
      calls.push(vsp.parmsSet(d.xf.ids.scale, d.targetScale, d.coalesceKey).catch(() => undefined));
    }
    if (calls.length > 0) {
      useModelStore.getState().noteDirty(d.ids);
      d.last = Promise.all(calls);
    }
  };

  const scheduleSend = (d: DragState) => {
    const elapsed = performance.now() - d.lastSendAt;
    if (elapsed >= SEND_MS) {
      flush(d);
    } else if (d.timer === null) {
      d.timer = setTimeout(() => {
        d.timer = null;
        if (!d.ended) flush(d);
      }, SEND_MS - elapsed);
    }
  };

  const beginDrag = () => {
    if (!xf || xf.geomId !== selectedId || drag.current || mode === "off") return;
    const d: DragState = {
      xf,
      kind: mode,
      coalesceKey: `${xf.geomId}:xform:${Math.round(performance.now())}`,
      ids: subtreeIds(xf.geomId),
      startAnchor: anchor.position.clone(),
      pivot: anchor.position.clone(),
      startRel: [...xf.rel] as Vec3,
      startScale: xf.scale,
      targetRel: [...xf.rel] as Vec3,
      targetScale: xf.scale,
      sentRel: [...xf.rel] as Vec3,
      sentScale: xf.scale,
      basisRel: [...xf.rel] as Vec3,
      basisScale: xf.scale,
      lastSendAt: 0,
      timer: null,
      last: null,
      ended: false,
    };
    anchor.scale.set(1, 1, 1);
    drag.current = d;
  };

  const onObjectChange = () => {
    const d = drag.current;
    if (!d || d.ended) return;
    if (d.kind === "move") {
      const dx = anchor.position.x - d.startAnchor.x;
      const dy = anchor.position.y - d.startAnchor.y;
      const dz = anchor.position.z - d.startAnchor.z;
      d.targetRel = [d.startRel[0] + dx, d.startRel[1] + dy, d.startRel[2] + dz];
    } else {
      d.targetScale = Math.max(1e-4, d.startScale * factorFromAnchor());
    }
    updatePreview(d);
    scheduleSend(d);
  };

  const endDrag = () => {
    const d = drag.current;
    if (!d || d.ended) return;
    d.ended = true;
    markGizmoDragEnd();
    if (d.timer !== null) {
      clearTimeout(d.timer);
      d.timer = null;
    }
    flush(d);
    anchor.scale.set(1, 1, 1);
    if (!d.last) {
      settle(d);
      return;
    }
    void d.last.then(() => {
      if (drag.current !== d) return;
      d.settleRev = useModelStore.getState().meshRevision;
      window.setTimeout(() => {
        if (drag.current === d) settle(d);
      }, SETTLE_FALLBACK_MS);
    });
  };

  // Unmounting or deselecting mid-drag still closes the drag cleanly.
  useEffect(
    () => () => {
      if (drag.current && !drag.current.ended) endDrag();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const showGizmo = mode !== "off" && !!selectedId && shown && !!xf && xf.geomId === selectedId;

  return (
    <>
      <primitive object={anchor} />
      {showGizmo && (
        <TransformControls
          ref={(el) => {
            // `axis` is private in drei's typings but present at runtime.
            tc.current = el as unknown as TransformControlsLike | null;
          }}
          object={anchor}
          mode={mode === "scale" ? "scale" : "translate"}
          space="world"
          translationSnap={snapOn && mode === "move" ? snapStep : null}
          scaleSnap={snapOn && mode === "scale" ? SCALE_SNAP : null}
          onMouseDown={beginDrag}
          onObjectChange={onObjectChange}
          onMouseUp={endDrag}
        />
      )}
    </>
  );
}
