// Analysis overlay drawn inside the R3F scene: load strips, lift arrows, curves,
// markers and labels from the engine's OverlayData. Colours come from the theme
// tokens (through ThemeColors), never from literals.
//
// Overlay items sit inside the solid geometry (strips and arrows are placed at the
// quarter chord, within the wing), so they are drawn with depthTest off and read
// through the surface. They are translucent and never write depth.

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Html } from "@react-three/drei";
import type { OverlayColor, OverlayData, OverlayItem, Vec3 } from "../../api/types";
import { useOverlayStore } from "../../store/overlayStore";
import type { ThemeColors } from "./useThemeColors";
import s from "./OverlayLayer.module.css";

type Strips = Extract<OverlayItem, { kind: "strips" }>;

interface Layer {
  key: string;
  geometry: THREE.BufferGeometry;
  faces: boolean;
  opacity: number;
}

interface Marker {
  key: string;
  position: Vec3;
  radius: number;
  color: THREE.Color;
  label: string;
}

interface LabelEntry {
  key: string;
  position: Vec3;
  text: string;
}

interface Built {
  layers: Layer[];
  markers: Marker[];
  labels: LabelEntry[];
  dispose: () => void;
}

function clamp01(x: number): number {
  return Math.min(1, Math.max(0, x));
}

/** Blue (low) -> green (mid) -> red (high), from the accent tokens. */
function coolWarm(t: number, c: ThemeColors): THREE.Color {
  const x = clamp01(t);
  const out = new THREE.Color();
  if (x < 0.5) return out.copy(c.accent).lerp(c.accentGreen, x * 2);
  return out.copy(c.accentGreen).lerp(c.danger, (x - 0.5) * 2);
}

function namedColor(name: OverlayColor | undefined, c: ThemeColors): THREE.Color {
  if (name === "green") return c.accentGreen;
  if (name === "danger") return c.danger;
  return c.accent;
}

function rangeOf(values: number[]): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return Number.isFinite(min) ? { min, max } : { min: 0, max: 0 };
}

function normalise(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return 0.5;
  return max > min ? (v - min) / (max - min) : 0.5;
}

/** Bounding-box diagonal-ish size of everything in the overlay, used to scale markers. */
function spanOf(items: OverlayItem[]): number {
  let lo = [Infinity, Infinity, Infinity];
  let hi = [-Infinity, -Infinity, -Infinity];
  const take = (p: Vec3 | number[] | undefined) => {
    if (!p || p.length < 3) return;
    for (let k = 0; k < 3; k++) {
      const v = Number(p[k]);
      if (!Number.isFinite(v)) continue;
      lo[k] = Math.min(lo[k], v);
      hi[k] = Math.max(hi[k], v);
    }
  };
  for (const item of items) {
    if (item.kind === "strips") item.quads.forEach((q) => q.forEach(take));
    else if (item.kind === "arrows") item.origins.forEach(take);
    else if (item.kind === "polyline") item.points.forEach(take);
    else take(item.position);
  }
  const extent = Math.max(...[0, 1, 2].map((k) => hi[k] - lo[k]));
  return Number.isFinite(extent) && extent > 0 ? extent : 1;
}

function buildStrips(item: Strips, colors: ThemeColors, key: string): Layer | null {
  const { min, max } = rangeOf(item.values);
  const pos: number[] = [];
  const col: number[] = [];
  item.quads.forEach((quad, i) => {
    if (quad.length !== 4) return;
    const c = coolWarm(normalise(item.values[i], min, max), colors);
    const [a, b, cc, d] = quad;
    for (const p of [a, b, cc, a, cc, d]) {
      pos.push(p[0], p[1], p[2]);
      col.push(c.r, c.g, c.b);
    }
  });
  if (pos.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return { key, geometry: g, faces: true, opacity: 0.8 };
}

/** Shafts as line segments plus cones at the tips, both vertex-coloured. */
function buildArrows(
  origins: Vec3[],
  vectors: Vec3[],
  color: THREE.Color,
  key: string,
): { lines: Layer | null; heads: Layer | null } {
  const linePos: number[] = [];
  const lineCol: number[] = [];
  const cones: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  origins.forEach((o, i) => {
    const v = vectors[i];
    if (!v) return;
    const dir = new THREE.Vector3(v[0], v[1], v[2]);
    const len = dir.length();
    if (!(len > 1e-12) || !Number.isFinite(len)) return;
    dir.normalize();
    const start = new THREE.Vector3(o[0], o[1], o[2]);
    const tip = start.clone().addScaledVector(dir, len);
    linePos.push(start.x, start.y, start.z, tip.x, tip.y, tip.z);
    lineCol.push(color.r, color.g, color.b, color.r, color.g, color.b);

    const head = len * 0.3;
    const cone = new THREE.ConeGeometry(head * 0.4, head, 10);
    const quat = new THREE.Quaternion().setFromUnitVectors(up, dir);
    const centre = tip.clone().addScaledVector(dir, -head / 2);
    cone.applyMatrix4(new THREE.Matrix4().compose(centre, quat, new THREE.Vector3(1, 1, 1)));
    cone.deleteAttribute("uv");
    const count = cone.getAttribute("position").count;
    const colArr = new Array<number>(count * 3);
    for (let k = 0; k < count; k++) {
      colArr[k * 3] = color.r;
      colArr[k * 3 + 1] = color.g;
      colArr[k * 3 + 2] = color.b;
    }
    cone.setAttribute("color", new THREE.Float32BufferAttribute(colArr, 3));
    cones.push(cone);
  });

  let lines: Layer | null = null;
  if (linePos.length > 0) {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(linePos, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(lineCol, 3));
    lines = { key: `${key}-shafts`, geometry: g, faces: false, opacity: 0.95 };
  }
  let heads: Layer | null = null;
  if (cones.length > 0) {
    const merged = mergeGeometries(cones, false);
    cones.forEach((c) => c.dispose());
    if (merged) heads = { key: `${key}-heads`, geometry: merged, faces: true, opacity: 0.95 };
  }
  return { lines, heads };
}

function buildPolyline(points: Vec3[], closed: boolean | undefined, color: THREE.Color, key: string): Layer | null {
  const pts = closed && points.length > 2 ? [...points, points[0]] : points;
  const pos: number[] = [];
  const col: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    pos.push(a[0], a[1], a[2], b[0], b[1], b[2]);
    col.push(color.r, color.g, color.b, color.r, color.g, color.b);
  }
  if (pos.length === 0) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return { key, geometry: g, faces: false, opacity: 0.9 };
}

function buildOverlay(data: OverlayData, colors: ThemeColors): Built {
  const layers: Layer[] = [];
  const markers: Marker[] = [];
  const labels: LabelEntry[] = [];
  const span = spanOf(data.items);

  data.items.forEach((item, i) => {
    const key = `${i}`;
    if (item.kind === "strips") {
      const layer = buildStrips(item, colors, key);
      if (layer) layers.push(layer);
    } else if (item.kind === "arrows") {
      const { lines, heads } = buildArrows(item.origins, item.vectors, namedColor(item.color, colors), key);
      if (lines) layers.push(lines);
      if (heads) layers.push(heads);
    } else if (item.kind === "polyline") {
      const layer = buildPolyline(item.points, item.closed, namedColor(item.color, colors), key);
      if (layer) layers.push(layer);
    } else if (item.kind === "marker") {
      const small = item.size === "small";
      markers.push({
        key,
        position: item.position,
        radius: span * (small ? 0.007 : 0.012),
        color: namedColor(item.color, colors),
        label: item.label,
      });
    } else if (item.kind === "label") {
      labels.push({ key, position: item.position, text: item.text });
    }
  });

  return {
    layers,
    markers,
    labels,
    dispose: () => layers.forEach((l) => l.geometry.dispose()),
  };
}

/** Renders the active overlay. Mounted inside the Canvas. */
export function OverlayLayer({ colors }: { colors: ThemeColors }) {
  const data = useOverlayStore((st) => st.active?.data ?? null);

  const built = useMemo(() => (data ? buildOverlay(data, colors) : null), [data, colors]);
  useEffect(() => () => built?.dispose(), [built]);

  if (!built) return null;

  return (
    <group>
      {built.layers.map((l) =>
        l.faces ? (
          <mesh key={`f-${l.key}`} geometry={l.geometry} renderOrder={10}>
            <meshBasicMaterial
              vertexColors
              transparent
              opacity={l.opacity}
              side={THREE.DoubleSide}
              depthTest={false}
              depthWrite={false}
            />
          </mesh>
        ) : (
          <lineSegments key={`l-${l.key}`} geometry={l.geometry} renderOrder={11}>
            <lineBasicMaterial
              vertexColors
              transparent
              opacity={l.opacity}
              depthTest={false}
              depthWrite={false}
            />
          </lineSegments>
        ),
      )}

      {built.markers.map((m) => (
        <group key={`m-${m.key}`} position={m.position}>
          <mesh renderOrder={12}>
            <sphereGeometry args={[m.radius, 16, 12]} />
            <meshBasicMaterial color={m.color} transparent depthTest={false} depthWrite={false} />
          </mesh>
          <Html center style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
            <div className={s.label}>{m.label}</div>
          </Html>
        </group>
      ))}

      {built.labels.map((l) => (
        <Html key={`t-${l.key}`} position={l.position} center style={{ pointerEvents: "none" }} zIndexRange={[20, 0]}>
          <div className={s.label}>{l.text}</div>
        </Html>
      ))}
    </group>
  );
}
