// Shared between the transform gizmo (inside the Canvas) and SceneGeoms:
// a registry of each geom's mesh group so a drag can offset or scale the
// rendered mesh immediately, before the engine re-meshes.

import type * as THREE from "three";
import type { Id } from "../../api/types";

const groups = new Map<Id, THREE.Object3D>();

export function registerPreviewGroup(id: Id, obj: THREE.Object3D | null): void {
  if (obj) groups.set(id, obj);
  else groups.delete(id);
}

export function previewGroup(id: Id): THREE.Object3D | undefined {
  return groups.get(id);
}

// Set when a gizmo drag ends. The click that follows the mouseup would
// otherwise reach Canvas onPointerMissed and clear the selection.
let lastGizmoDragEnd = 0;

export function markGizmoDragEnd(): void {
  lastGizmoDragEnd = performance.now();
}

export function justDraggedGizmo(): boolean {
  return performance.now() - lastGizmoDragEnd < 250;
}

/** Round up to a 1, 2, or 5 times power of ten (e.g. 0.13 -> 0.2). */
export function niceStep(x: number): number {
  if (!(x > 0) || !Number.isFinite(x)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(x)));
  const m = x / p;
  const mult = m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10;
  return mult * p;
}
