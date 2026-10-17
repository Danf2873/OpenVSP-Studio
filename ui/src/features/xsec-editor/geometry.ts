// Pure geometry helpers for the Cross-Section Editor. No React, no engine calls,
// so they can be checked directly with `node --experimental-strip-types`.
//
// Coordinate spaces:
//   local  : profile / thumb / edit-curve space. u = width direction, v = height direction.
//   world  : local profile units (same numbers as local, just the drawing space).
//   screen : SVG pixels, y down. worldToScreen flips y.
//   unit   : edit-curve points, i.e. world divided by width/height.

import type { Parm, ParmGroup } from "../../api/types";

export type Pt = readonly [number, number];
export type MutPt = [number, number];

export interface View {
  /** World point shown at the centre of the canvas. */
  cx: number;
  cy: number;
  /** Pixels per world unit. */
  scale: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const MIN_SCALE = 1e-6;
export const MAX_SCALE = 1e6;

// ---------- bounding boxes and views ----------

/** Box around every point of every list, or null when there are no points. */
export function boxOf(lists: ReadonlyArray<ReadonlyArray<Pt> | undefined>): Box | null {
  let box: Box | null = null;
  for (const pts of lists) {
    if (!pts) continue;
    for (const [x, y] of pts) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
      if (!box) box = { minX: x, minY: y, maxX: x, maxY: y };
      else {
        if (x < box.minX) box.minX = x;
        if (x > box.maxX) box.maxX = x;
        if (y < box.minY) box.minY = y;
        if (y > box.maxY) box.maxY = y;
      }
    }
  }
  return box;
}

/** View that fits the box into a w x h canvas with a fractional margin on each side. */
export function fitView(box: Box | null, w: number, h: number, pad = 0.12): View {
  if (!box || w <= 0 || h <= 0) return { cx: 0, cy: 0, scale: 1 };
  const spanX = Math.max(box.maxX - box.minX, 1e-6);
  const spanY = Math.max(box.maxY - box.minY, 1e-6);
  const avail = 1 - 2 * pad;
  let scale = Math.min((w * avail) / spanX, (h * avail) / spanY);
  if (!Number.isFinite(scale) || scale <= 0) scale = 1;
  scale = clamp(scale, MIN_SCALE, MAX_SCALE);
  return { cx: (box.minX + box.maxX) / 2, cy: (box.minY + box.maxY) / 2, scale };
}

export function worldToScreen(view: View, w: number, h: number, x: number, y: number): [number, number] {
  return [w / 2 + (x - view.cx) * view.scale, h / 2 - (y - view.cy) * view.scale];
}

export function screenToWorld(view: View, w: number, h: number, sx: number, sy: number): [number, number] {
  return [view.cx + (sx - w / 2) / view.scale, view.cy - (sy - h / 2) / view.scale];
}

/** Zoom by `factor` keeping the world point under (sx, sy) fixed on screen. */
export function zoomAt(view: View, w: number, h: number, sx: number, sy: number, factor: number): View {
  const [wx, wy] = screenToWorld(view, w, h, sx, sy);
  const scale = clamp(view.scale * factor, MIN_SCALE, MAX_SCALE);
  // Solve sx = w/2 + (wx - cx') * scale for cx', same for y.
  return {
    cx: wx - (sx - w / 2) / scale,
    cy: wy + (sy - h / 2) / scale,
    scale,
  };
}

/** Pan by a screen-space delta (pixels, y down). */
export function panBy(view: View, dxPx: number, dyPx: number): View {
  return { cx: view.cx - dxPx / view.scale, cy: view.cy + dyPx / view.scale, scale: view.scale };
}

/** Grid spacing in world units giving roughly `targetPx` between lines. 1-2-5 steps. */
export function gridStep(scale: number, targetPx = 64): number {
  const raw = targetPx / Math.max(scale, MIN_SCALE);
  const p = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / p;
  const nice = m < 2 ? 1 : m < 5 ? 2 : 5;
  return nice * p;
}

export function snapTo(v: number, step: number): number {
  if (!(step > 0)) return v;
  return Math.round(v / step) * step;
}

// ---------- paths ----------

function fmt(n: number): string {
  return Number.isFinite(n) ? (Math.round(n * 100) / 100).toString() : "0";
}

/** SVG path data through the points. */
export function pathD(pts: ReadonlyArray<Pt>, closed: boolean): string {
  if (pts.length === 0) return "";
  let d = "";
  for (let i = 0; i < pts.length; i++) {
    const [x, y] = pts[i];
    d += (i === 0 ? "M" : "L") + fmt(x) + " " + fmt(y);
  }
  return closed ? d + "Z" : d;
}

/** Map points through f (used for world -> screen and thumbnail flips). */
export function mapPts(pts: ReadonlyArray<Pt>, f: (x: number, y: number) => [number, number]): MutPt[] {
  return pts.map(([x, y]) => f(x, y));
}

/** Scale a local profile about the origin. */
export function scalePts(pts: ReadonlyArray<Pt>, sx: number, sy: number): MutPt[] {
  return pts.map(([x, y]) => [x * sx, y * sy]);
}

// ---------- edit curve ----------

/** True when the last point repeats the first (closed, duplicated end point). */
export function hasDuplicateEnd(pts: ReadonlyArray<Pt>): boolean {
  if (pts.length < 2) return false;
  const a = pts[0];
  const b = pts[pts.length - 1];
  return Math.abs(a[0] - b[0]) < 1e-12 && Math.abs(a[1] - b[1]) < 1e-12;
}

/** Copy with point i moved to p. Moving either end of a duplicated pair moves both. */
export function movePoint(pts: ReadonlyArray<Pt>, i: number, p: Pt, cubic = false): MutPt[] {
  const out: MutPt[] = pts.map(([x, y]) => [x, y]);
  if (i < 0 || i >= out.length) return out;
  const q: MutPt = [p[0], p[1]];
  // On cubic curves an anchor carries its two handles, so the curve stays smooth.
  if (cubic && i % 3 === 0) {
    const dx = q[0] - pts[i][0];
    const dy = q[1] - pts[i][1];
    const last = out.length - 1;
    const closed = hasDuplicateEnd(pts);
    const neighbours = i === 0 || (closed && i === last) ? [1, last - 1] : [i - 1, i + 1];
    for (const h of neighbours) {
      if (h > 0 && h < last) out[h] = [pts[h][0] + dx, pts[h][1] + dy];
    }
  }
  out[i] = q;
  if (hasDuplicateEnd(pts)) {
    const last = out.length - 1;
    if (i === 0) out[last] = [q[0], q[1]];
    else if (i === last) out[0] = [q[0], q[1]];
  }
  return out;
}

/**
 * Curve parameter u (0..1) of the point on the closed profile nearest to (x, y).
 * The profile is sampled at u = i / n, so segment i runs from sample i to sample
 * (i + 1) mod n and the parameter of a point on it is (i + t) / n.
 * Returns null for fewer than two samples.
 */
export function profileParam(profile: ReadonlyArray<Pt>, x: number, y: number): number | null {
  const n = profile.length;
  if (n < 2) return null;
  let bestDist = Number.POSITIVE_INFINITY;
  let u: number | null = null;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = profile[i];
    const [bx, by] = profile[(i + 1) % n];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? clamp(((x - ax) * dx + (y - ay) * dy) / len2, 0, 1) : 0;
    const dist = Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
    if (dist < bestDist) {
      bestDist = dist;
      u = (i + t) / n;
    }
  }
  // The wrap point u = 1 is the start of the loop.
  if (u === null) return null;
  return u >= 1 ? 0 : u;
}

export interface SegmentHit {
  /** Insertion index for insertPoint (the point will sit at this index). */
  index: number;
  /** Closest point on the polyline, in the same space as the input points. */
  point: MutPt;
  /** Distance from the query to that point, same space. */
  dist: number;
}

/** Closest point on the open polyline pts (segments i -> i+1) to (x, y). */
export function nearestSegment(pts: ReadonlyArray<Pt>, x: number, y: number): SegmentHit | null {
  if (pts.length < 2) return null;
  let best: SegmentHit | null = null;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((x - ax) * dx + (y - ay) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const px = ax + t * dx;
    const py = ay + t * dy;
    const dist = Math.hypot(x - px, y - py);
    if (!best || dist < best.dist) best = { index: i + 1, point: [px, py], dist };
  }
  return best;
}

// ---------- parameters ----------

export interface SizeParms {
  width?: Parm;
  height?: Parm;
  diameter?: Parm;
}

/**
 * Finds the parms that drive the section size. Matches "Width"/"Height"/
 * "Diameter" and any "<Shape>_Width" style name, searching every group.
 */
export function findSizeParms(groups: ReadonlyArray<ParmGroup>): SizeParms {
  const out: SizeParms = {};
  // Shape size lives in the XSecCurve group; other groups (e.g. Chevron W01_Width) also end in _Width.
  const ordered = [...groups].sort((a, b) => Number(b.group === "XSecCurve") - Number(a.group === "XSecCurve"));
  for (const g of ordered) {
    if (g.group === "Chevron") continue;
    for (const p of g.parms) {
      const n = p.name;
      if (!out.width && (n === "Width" || n.endsWith("_Width"))) out.width = p;
      else if (!out.height && (n === "Height" || n.endsWith("_Height"))) out.height = p;
      else if (!out.diameter && (n === "Diameter" || n.endsWith("_Diameter"))) out.diameter = p;
    }
  }
  return out;
}

/** A parm by exact name, searching every group (first match). */
export function findParm(groups: ReadonlyArray<ParmGroup>, name: string): Parm | null {
  for (const g of groups) {
    for (const p of g.parms) if (p.name === name) return p;
  }
  return null;
}

/** Clamp a size to the parm's engine range, never below a tiny positive value. */
export function clampParm(v: number, p: Parm): number {
  const lo = Number.isFinite(p.min) ? Math.max(p.min, 1e-6) : 1e-6;
  const hi = Number.isFinite(p.max) ? p.max : Number.POSITIVE_INFINITY;
  return clamp(v, lo, hi);
}

// ---------- small utils ----------

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

