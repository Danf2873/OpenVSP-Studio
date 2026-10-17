// The 2D cross-section canvas: grid, axes, neighbours, profile, size handles and
// edit-curve points. Owns the view (pan/zoom), the pointer gestures and the
// point context menu; the editor owns every engine call and passes the drafts
// back in for preview.

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Trash2 } from "lucide-react";
import type { UV, XsecGetResult } from "../../api/types";
import { ContextMenu, type MenuEntry } from "../../components";
import { cx } from "../../components/cx";
import {
  boxOf,
  fitView,
  gridStep,
  hasDuplicateEnd,
  mapPts,
  nearestSegment,
  panBy,
  pathD,
  scalePts,
  screenToWorld,
  snapTo,
  worldToScreen,
  zoomAt,
  type MutPt,
  type SizeParms,
  type View,
} from "./geometry";
import s from "./XsecEditor.module.css";

type Axis = "x" | "y";

type Drag =
  | { kind: "pan"; sx: number; sy: number; view: View }
  | { kind: "size"; axis: Axis }
  | { kind: "point"; index: number }
  | { kind: "add"; sx: number; sy: number; x: number; y: number };

/** How close (screen px) the pointer must be to the outline to add a point outside Add Point mode. */
const ADD_RADIUS = 8;

export interface XsecCanvasProps {
  /** Null while the section loads. The canvas stays mounted so its view survives. */
  detail: XsecGetResult | null;
  sizeParms: SizeParms;
  /** Size being dragged (not yet confirmed by the engine). */
  draftSize: { width: number; height: number } | null;
  /** Edit-curve points being dragged (unit space). */
  draftPoints: UV[] | null;
  /** Bump to refit the view (the toolbar's zoom-fit button). */
  fitToken: number;
  /** Add Point mode: any click on the canvas snaps to the nearest outline point and adds one there. */
  addMode: boolean;
  /** Index of the selected edit-curve point, or null. */
  selectedPoint: number | null;
  onPointSelect: (index: number) => void;
  onSizeStart: (axis: Axis) => void;
  /** World coordinate of the pointer on `axis` (already snapped when Shift is held). */
  onSizeMove: (axis: Axis, coord: number) => void;
  onSizeEnd: () => void;
  /** Keyboard nudge: change the width or height by `delta` world units. */
  onSizeNudge: (axis: Axis, delta: number) => void;
  onPointStart: (index: number) => void;
  /** World coordinates of the pointer (already snapped when Shift is held). */
  onPointMove: (index: number, x: number, y: number) => void;
  onPointEnd: () => void;
  /** Delete a point (Alt+click or the point's context menu). */
  onPointRemove: (index: number) => void;
  /** Add a control point on the outline at world (x, y). Non-editable shapes are converted first. */
  onAddPointAt: (x: number, y: number) => void;
  /** World coordinates under the pointer, or null when it leaves the canvas. */
  onCursor: (x: number | null, y: number | null) => void;
}

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "--";
  return Number(n.toFixed(Math.abs(n) >= 10 ? 2 : 4)).toString();
}

/** Grid lines (world-aligned) inside the visible area, as one path. */
function gridPath(view: View, cw: number, ch: number): string {
  const step = gridStep(view.scale);
  const [x0, yTop] = screenToWorld(view, cw, ch, 0, 0);
  const [x1, yBot] = screenToWorld(view, cw, ch, cw, ch);
  let d = "";
  const r = (n: number) => Math.round(n * 10) / 10;
  const kx0 = Math.ceil(x0 / step);
  const kx1 = Math.floor(x1 / step);
  if (kx1 - kx0 <= 400) {
    for (let k = kx0; k <= kx1; k++) {
      const [px, py0] = worldToScreen(view, cw, ch, k * step, yBot);
      const [, py1] = worldToScreen(view, cw, ch, k * step, yTop);
      d += `M${r(px)} ${r(py0)}V${r(py1)}`;
    }
  }
  const ky0 = Math.ceil(yBot / step);
  const ky1 = Math.floor(yTop / step);
  if (ky1 - ky0 <= 400) {
    for (let k = ky0; k <= ky1; k++) {
      const [px0, py] = worldToScreen(view, cw, ch, x0, k * step);
      const [px1] = worldToScreen(view, cw, ch, x1, k * step);
      d += `M${r(px0)} ${r(py)}H${r(px1)}`;
    }
  }
  return d;
}

/** The horizontal (x) and vertical (y) axes through the world origin, one path each. */
function axisPaths(view: View, cw: number, ch: number): { x: string; y: string } {
  const [x0, yTop] = screenToWorld(view, cw, ch, 0, 0);
  const [x1, yBot] = screenToWorld(view, cw, ch, cw, ch);
  const [ox, oy0] = worldToScreen(view, cw, ch, 0, yBot);
  const [, oy1] = worldToScreen(view, cw, ch, 0, yTop);
  const [ax0, ay] = worldToScreen(view, cw, ch, x0, 0);
  const [ax1] = worldToScreen(view, cw, ch, x1, 0);
  return { x: `M${ax0} ${ay}H${ax1}`, y: `M${ox} ${oy0}V${oy1}` };
}

export function XsecCanvas(props: XsecCanvasProps) {
  const {
    detail,
    sizeParms,
    draftSize,
    draftPoints,
    fitToken,
    addMode,
    selectedPoint,
    onPointSelect,
    onSizeStart,
    onSizeMove,
    onSizeEnd,
    onSizeNudge,
    onPointStart,
    onPointMove,
    onPointEnd,
    onPointRemove,
    onAddPointAt,
    onCursor,
  } = props;

  const boxRef = useRef<HTMLDivElement | null>(null);
  const [cw, setCw] = useState(0);
  const [ch, setCh] = useState(0);
  const [view, setView] = useState<View>({ cx: 0, cy: 0, scale: 1 });
  const [spaceHeld, setSpaceHeld] = useState(false);
  /** Point on the outline under the pointer, where a click would add a control point. */
  const [addHover, setAddHover] = useState<MutPt | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; index: number } | null>(null);

  const viewRef = useRef(view);
  viewRef.current = view;
  const sizeRef = useRef({ cw, ch });
  sizeRef.current = { cw, ch };
  const spaceRef = useRef(false);
  const dragRef = useRef<Drag | null>(null);
  const fittedRef = useRef<{ id: string; token: number } | null>(null);

  // ----- size tracking -----
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const apply = () => {
      setCw(el.clientWidth);
      setCh(el.clientHeight);
    };
    apply();
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ----- wheel zoom (non-passive so the page does not scroll) -----
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(-dy * 0.0015);
      const { cw: w, ch: h } = sizeRef.current;
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      setView((v) => zoomAt(v, w, h, px, py, factor));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  // ----- Space held = pan mode (only when focus is in the canvas area) -----
  useEffect(() => {
    const release = () => {
      spaceRef.current = false;
      setSpaceHeld(false);
    };
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" || e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && t !== document.body && (t.closest?.("input,select,textarea,button") || !boxRef.current?.contains(t))) return;
      e.preventDefault();
      spaceRef.current = true;
      setSpaceHeld(true);
    };
    const onUp = (e: KeyboardEvent) => {
      if (e.code === "Space") release();
    };
    window.addEventListener("keydown", onDown);
    window.addEventListener("keyup", onUp);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onDown);
      window.removeEventListener("keyup", onUp);
      window.removeEventListener("blur", release);
    };
  }, []);

  // ----- derived world geometry -----
  const W = detail && detail.width > 0 ? detail.width : 1;
  const H = detail && detail.height > 0 ? detail.height : 1;

  let profileWorld: MutPt[] = [];
  let ctrlWorld: MutPt[] | null = null;
  let hx = 0;
  let hy = 0;
  if (detail) {
    if (detail.editCurve) {
      const pts = draftPoints ?? detail.editCurve.points;
      ctrlWorld = pts.map(([u, v]): MutPt => [u * W, v * H]);
      profileWorld = draftPoints ? ctrlWorld : mapPts(detail.profile, (x, y) => [x, y]);
    } else if (draftSize && detail.width > 0 && detail.height > 0) {
      profileWorld = scalePts(detail.profile, draftSize.width / detail.width, draftSize.height / detail.height);
    } else {
      profileWorld = mapPts(detail.profile, (x, y) => [x, y]);
    }
    hx = (draftSize?.width ?? detail.width) / 2;
    hy = (draftSize?.height ?? detail.height) / 2;
  }

  // Cubic Bezier curves: anchors are the indices divisible by 3, the rest are handles.
  const cubic = !!detail?.editCurve && detail.editCurve.curveType === 2;
  const isAnchor = (i: number) => !cubic || i % 3 === 0;
  // Dense cubic curves (e.g. converted airfoils): show a point's handles and number only while it is selected.
  const busy = cubic && !!ctrlWorld && ctrlWorld.length > 25;
  const ownerOf = (i: number) => {
    const n = ctrlWorld?.length ?? 0;
    const o = i % 3 === 0 ? i : i % 3 === 1 ? i - 1 : i + 1;
    return n > 1 && o === n - 1 ? 0 : o;
  };
  const handleVisible = (h: number) =>
    !busy || (selectedPoint !== null && selectedPoint !== undefined && ownerOf(selectedPoint) === ownerOf(h));
  const duplicateEnd = !!ctrlWorld && hasDuplicateEnd(ctrlWorld);

  const canX = !!detail && !detail.editCurve && !!(sizeParms.width || sizeParms.diameter);
  const canY = !!detail && !detail.editCurve && !!(sizeParms.height || sizeParms.diameter);

  // ----- fit -----
  const fitNow = (): View => {
    if (!detail) return viewRef.current;
    const box = boxOf([profileWorld, ctrlWorld ?? undefined]);
    return fitView(box, sizeRef.current.cw, sizeRef.current.ch);
  };

  useEffect(() => {
    if (!detail || cw <= 0 || ch <= 0) return;
    const last = fittedRef.current;
    if (last && last.id === detail.id && last.token === fitToken) return;
    fittedRef.current = { id: detail.id, token: fitToken };
    const box = boxOf([profileWorld, ctrlWorld ?? undefined]);
    setView(fitView(box, cw, ch));
    // Refit only for a new section or an explicit request, not on every edit.
  }, [detail?.id, fitToken, cw, ch]);

  // ----- pointer helpers -----
  const toWorld = (clientX: number, clientY: number): [number, number] => {
    const el = boxRef.current;
    if (!el) return [0, 0];
    const r = el.getBoundingClientRect();
    return screenToWorld(viewRef.current, sizeRef.current.cw, sizeRef.current.ch, clientX - r.left, clientY - r.top);
  };

  /**
   * The point on the outline nearest the pointer. With radiusPx null any
   * pointer position snaps; otherwise the pointer must be within radiusPx.
   */
  const outlineHit = (clientX: number, clientY: number, radiusPx: number | null): MutPt | null => {
    if (!detail || profileWorld.length < 2 || detail.width <= 0 || detail.height <= 0) return null;
    const [wx, wy] = toWorld(clientX, clientY);
    const hit = nearestSegment(profileWorld, wx, wy);
    if (!hit) return null;
    if (radiusPx !== null && hit.dist * viewRef.current.scale > radiusPx) return null;
    return hit.point;
  };

  const onBgDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 1 || e.button === 2 || (e.button === 0 && spaceRef.current)) {
      e.preventDefault();
      dragRef.current = { kind: "pan", sx: e.clientX, sy: e.clientY, view: viewRef.current };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button === 0) {
      // A click on the outline adds a control point there (any spot in Add Point mode).
      const p = outlineHit(e.clientX, e.clientY, addMode ? null : ADD_RADIUS);
      if (p) {
        e.preventDefault();
        dragRef.current = { kind: "add", sx: e.clientX, sy: e.clientY, x: p[0], y: p[1] };
        e.currentTarget.setPointerCapture(e.pointerId);
      }
    }
  };

  const onBgMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (d?.kind === "pan") {
      setView(panBy(d.view, e.clientX - d.sx, e.clientY - d.sy));
      return;
    }
    if (d) return;
    setAddHover(spaceRef.current ? null : outlineHit(e.clientX, e.clientY, addMode ? null : ADD_RADIUS));
  };

  const onBgUp = (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (d?.kind !== "pan" && d?.kind !== "add") return;
    dragRef.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    // Only a click (not a drag) adds the point.
    if (d.kind === "add" && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 4) {
      setAddHover(null);
      onAddPointAt(d.x, d.y);
    }
  };

  const onBgDouble = () => {
    if (!detail) return;
    setView(fitNow());
  };

  const endDrag = (e: ReactPointerEvent<SVGElement>) => {
    const d = dragRef.current;
    if (!d || d.kind === "pan") return;
    e.stopPropagation();
    dragRef.current = null;
    if (d.kind === "size") onSizeEnd();
    else onPointEnd();
    const el = e.currentTarget as Element;
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
  };

  // ----- size handles -----
  const handleDown = (axis: Axis) => (e: ReactPointerEvent<SVGCircleElement>) => {
    if (e.button !== 0 || spaceRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind: "size", axis };
    onSizeStart(axis);
  };

  const handleMove = (e: ReactPointerEvent<SVGCircleElement>) => {
    const d = dragRef.current;
    if (d?.kind !== "size") return;
    e.stopPropagation();
    const [wx, wy] = toWorld(e.clientX, e.clientY);
    const coord = d.axis === "x" ? wx : wy;
    const step = gridStep(viewRef.current.scale, 48);
    onSizeMove(d.axis, e.shiftKey ? snapTo(coord, step) : coord);
  };

  const handleKey = (axis: Axis, side: 1 | -1) => (e: ReactKeyboardEvent<SVGCircleElement>) => {
    const outward = axis === "x" ? (side > 0 ? "ArrowRight" : "ArrowLeft") : side > 0 ? "ArrowUp" : "ArrowDown";
    const inward = axis === "x" ? (side > 0 ? "ArrowLeft" : "ArrowRight") : side > 0 ? "ArrowDown" : "ArrowUp";
    let dir = 0;
    if (e.key === outward) dir = 1;
    else if (e.key === inward) dir = -1;
    if (dir === 0) return;
    e.preventDefault();
    e.stopPropagation(); // do not also move the section selection
    const base = gridStep(viewRef.current.scale, 48) / 4;
    onSizeNudge(axis, dir * base * (e.shiftKey ? 10 : 1));
  };

  // ----- point handles -----
  const pointDown = (i: number) => (e: ReactPointerEvent<SVGCircleElement>) => {
    if (spaceRef.current) return; // Space+drag pans through the background
    if (e.button === 2) {
      // Right button opens the point menu (see onContextMenu); keep it from panning.
      e.stopPropagation();
      return;
    }
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (e.altKey) {
      onPointRemove(i);
      return;
    }
    onPointSelect(i);
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = { kind: "point", index: i };
    onPointStart(i);
  };

  const pointMove = (e: ReactPointerEvent<SVGCircleElement>) => {
    const d = dragRef.current;
    if (d?.kind !== "point") return;
    e.stopPropagation();
    let [wx, wy] = toWorld(e.clientX, e.clientY);
    if (e.shiftKey) {
      const step = gridStep(viewRef.current.scale, 48);
      wx = snapTo(wx, step);
      wy = snapTo(wy, step);
    }
    onPointMove(d.index, wx, wy);
  };

  const pointMenu = (i: number) => (e: ReactMouseEvent<SVGCircleElement>) => {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, index: i });
  };

  const menuItems: MenuEntry[] = menu
    ? [
        {
          id: "delete-point",
          label: `Delete point ${menu.index}`,
          icon: <Trash2 size={14} />,
          danger: true,
          onSelect: () => onPointRemove(menu.index),
        },
      ]
    : [];

  // ----- render -----
  const screenOf = (p: readonly [number, number]): [number, number] => worldToScreen(view, cw, ch, p[0], p[1]);
  const haveSvg = !!detail && cw > 0 && ch > 0;

  const handles: Array<{ key: string; axis: Axis; side: 1 | -1; x: number; y: number }> = [];
  if (canX) {
    handles.push({ key: "xp", axis: "x", side: 1, x: hx, y: 0 }, { key: "xm", axis: "x", side: -1, x: -hx, y: 0 });
  }
  if (canY) {
    handles.push({ key: "yp", axis: "y", side: 1, x: 0, y: hy }, { key: "ym", axis: "y", side: -1, x: 0, y: -hy });
  }

  // Cubic curves: a thin line from each handle to the anchor it belongs to.
  let handleLines = "";
  if (cubic && ctrlWorld) {
    for (let h = 0; h < ctrlWorld.length; h++) {
      if (h % 3 === 0 || !handleVisible(h)) continue;
      const anchor = ctrlWorld[h % 3 === 1 ? h - 1 : h + 1];
      if (!anchor) continue;
      const [ax, ay] = screenOf(anchor);
      const [hxS, hyS] = screenOf(ctrlWorld[h]);
      handleLines += `M${ax} ${ay}L${hxS} ${hyS}`;
    }
  }

  // Origin in screen space, for pushing point labels outward from the centre.
  const [originX, originY] = screenOf([0, 0]);

  const hint = !detail
    ? ""
    : addMode
      ? "Add Point: click the outline to insert a point there. Right-drag or Space+drag pans. Wheel zooms."
      : detail.editCurve
        ? "Drag points to reshape. Alt+click or right-click a point to delete it. Click the outline or use Add Point to insert one. Shift snaps. Wheel zooms. Double-click fits."
        : handles.length > 0
          ? "Click the outline to convert to an editable curve and add a point. Drag the handles to resize. Shift snaps. Wheel zooms."
          : "Click the outline to convert to an editable curve and add a point. Wheel zooms. Double-click fits.";

  return (
    <div
      ref={boxRef}
      className={cx(s.canvas, spaceHeld && s.canvasPan)}
      tabIndex={-1}
      onContextMenu={(e) => e.preventDefault()}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onPointerMoveCapture={(e) => {
        if (!detail) return;
        const [wx, wy] = toWorld(e.clientX, e.clientY);
        onCursor(wx, wy);
      }}
      onPointerLeave={() => onCursor(null, null)}
    >
      {haveSvg && detail && (
        <svg
          width={cw}
          height={ch}
          className={s.svg}
          role="group"
          aria-label={`Cross-section profile, ${detail.shapeName}`}
          onPointerDown={onBgDown}
          onPointerMove={onBgMove}
          onPointerUp={onBgUp}
          onPointerCancel={onBgUp}
          onPointerLeave={() => setAddHover(null)}
          onDoubleClick={onBgDouble}
          style={addHover ? { cursor: "copy" } : undefined}
        >
          <path className={s.grid} d={gridPath(view, cw, ch)} />
          <path className={s.axisX} d={axisPaths(view, cw, ch).x} />
          <path className={s.axisY} d={axisPaths(view, cw, ch).y} />

          {detail.neighbors.prev && <path className={s.ghost} d={pathD(mapPts(detail.neighbors.prev, (x, y) => screenOf([x, y])), true)} />}
          {detail.neighbors.next && <path className={s.ghost} d={pathD(mapPts(detail.neighbors.next, (x, y) => screenOf([x, y])), true)} />}

          <path className={s.profile} d={pathD(mapPts(profileWorld, (x, y) => screenOf([x, y])), true)} />

          {ctrlWorld && !cubic && <path className={s.controlPoly} d={pathD(mapPts(ctrlWorld, (x, y) => screenOf([x, y])), false)} />}
          {ctrlWorld && cubic && <path className={s.handleLine} d={handleLines} />}

          {/* Centre target at the section origin. */}
          <g className={s.target} aria-hidden="true" pointerEvents="none">
            <circle cx={originX} cy={originY} r={5} />
            <path d={`M${originX - 9} ${originY}H${originX + 9}M${originX} ${originY - 9}V${originY + 9}`} />
          </g>

          {handles.map((h) => {
            const [sx, sy] = screenOf([h.x, h.y]);
            const value = h.axis === "x" ? (draftSize?.width ?? detail.width) : (draftSize?.height ?? detail.height);
            return (
              <circle
                key={h.key}
                cx={sx}
                cy={sy}
                r={6}
                className={cx(s.handle, h.axis === "y" && s.handleY)}
                tabIndex={0}
                role="slider"
                aria-label={`${h.axis === "x" ? "Width" : "Height"} handle`}
                aria-valuenow={Number(value.toFixed(4))}
                aria-valuemin={0}
                onPointerDown={handleDown(h.axis)}
                onPointerMove={handleMove}
                onPointerUp={endDrag}
                onPointerCancel={endDrag}
                onDoubleClick={(e) => e.stopPropagation()}
                onKeyDown={handleKey(h.axis, h.side)}
              >
                <title>{h.axis === "x" ? "Drag to change width" : "Drag to change height"}</title>
              </circle>
            );
          })}

          {addHover &&
            (() => {
              const [ax, ay] = screenOf(addHover);
              return (
                <g className={s.addGhost} pointerEvents="none" aria-hidden="true">
                  <circle cx={ax} cy={ay} r={7} />
                  <path d={`M${ax - 3.5} ${ay}H${ax + 3.5}M${ax} ${ay - 3.5}V${ay + 3.5}`} />
                </g>
              );
            })()}

          {ctrlWorld &&
            ctrlWorld.map((p, i) => {
              const [sx, sy] = screenOf(p);
              const anchor = isAnchor(i);
              const selected = selectedPoint === i;
              if (!anchor && !handleVisible(i)) return null;
              return (
                <circle
                  key={i}
                  cx={sx}
                  cy={sy}
                  r={anchor ? 4.5 : 3}
                  className={cx(anchor ? s.point : s.handlePoint, selected && s.pointSelected)}
                  onPointerDown={pointDown(i)}
                  onPointerMove={pointMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onDoubleClick={(e) => e.stopPropagation()}
                  onContextMenu={pointMenu(i)}
                >
                  <title>
                    {anchor ? `Point ${i}` : `Handle ${i}`} (drag to move; Alt+click or right-click a point to delete)
                  </title>
                </circle>
              );
            })}

          {ctrlWorld &&
            ctrlWorld.map((p, i) => {
              // Anchors only, and not the duplicated closing point (it sits on point 0).
              if (!isAnchor(i) || (duplicateEnd && i === ctrlWorld.length - 1)) return null;
              if (busy && i !== 0 && (selectedPoint === null || selectedPoint === undefined || ownerOf(selectedPoint) !== i)) return null;
              const [sx, sy] = screenOf(p);
              let vx = sx - originX;
              let vy = sy - originY;
              const len = Math.hypot(vx, vy);
              if (len < 1) {
                vx = 0;
                vy = -1;
              } else {
                vx /= len;
                vy /= len;
              }
              const anchorAt = vx > 0.35 ? "start" : vx < -0.35 ? "end" : "middle";
              return (
                <text
                  key={`l${i}`}
                  x={sx + vx * 14}
                  y={sy + vy * 14}
                  textAnchor={anchorAt}
                  dominantBaseline="central"
                  className={cx(s.pointLabel, selectedPoint === i && s.pointLabelSelected)}
                  pointerEvents="none"
                >
                  {i}
                </text>
              );
            })}
        </svg>
      )}

      {detail && (
        <div className={s.dims} aria-hidden="true">
          W {fmt(draftSize?.width ?? detail.width)}  H {fmt(draftSize?.height ?? detail.height)}
        </div>
      )}
      {hint && (
        <p className={s.hint} title={hint}>
          {hint}
        </p>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={() => setMenu(null)} ariaLabel="Point actions" />}
    </div>
  );
}
