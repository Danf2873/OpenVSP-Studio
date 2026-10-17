// Section map: every cross-section of the component on one strip (side view for
// bodies, planform for wings). Click a section to edit it, drag it to move it
// along the component, or click anywhere on the strip to insert a new section there.

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { vsp } from "../../api/vsp";
import type { Id, XsecLayout, XsecStation } from "../../api/types";
import { useModelStore } from "../../store/modelStore";
import * as act from "../../layout/actions";
import { latestSender, type LatestSender } from "./sender";
import s from "./SectionMap.module.css";

export interface SectionMapProps {
  geomId: Id;
  surf: number;
  selected: number | null;
  onSelect: (index: number) => void;
}

const H = 112;
const PAD_X = 14;
const PAD_TOP = 18;
const PAD_BOTTOM = 22;
const HIT = 7; // px either side of a section line that grabs it

interface Drag {
  index: number;
  pointerId: number;
  startX: number;
  moved: boolean;
  sender: LatestSender<number>;
}

function fmt(v: number): string {
  const a = Math.abs(v);
  return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : v.toFixed(2);
}

export function SectionMap({ geomId, surf, selected, onSelect }: SectionMapProps) {
  const [layout, setLayout] = useState<XsecLayout | null>(null);
  const [width, setWidth] = useState(320);
  const [draft, setDraft] = useState<{ index: number; pos: number } | null>(null);
  const [hoverPos, setHoverPos] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const seq = useModelStore((st) => st.lastChange.seq);

  const load = useCallback(async () => {
    try {
      setLayout(await vsp.xsecLayout(geomId, surf, { silent: true }));
    } catch {
      setLayout(null);
    }
  }, [geomId, surf]);

  // Reload on any model change, except mid-drag (the draft is shown instead).
  useEffect(() => {
    if (!dragRef.current) void load();
  }, [load, seq]);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(160, el.clientWidth)));
    ro.observe(el);
    setWidth(Math.max(160, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  if (!layout || layout.stations.length === 0) {
    return <div ref={boxRef} className={s.root} aria-hidden="true" />;
  }

  const st = layout.stations;
  const extendable = layout.kind === "wing" || layout.kind === "stack";
  const p0 = st[0].pos;
  const pLast = st[st.length - 1].pos;
  const span = Math.max(pLast - p0, 1e-6);
  const pMax = pLast + (extendable ? span * 0.18 : 0);
  const vMin = Math.min(...st.map((x) => x.bottom));
  const vMax = Math.max(...st.map((x) => x.top));
  const vRange = Math.max(vMax - vMin, 1e-6);
  const planform = layout.kind === "wing" || layout.kind === "prop";

  const xOf = (p: number) => PAD_X + ((p - p0) / (pMax - p0 || 1)) * (width - 2 * PAD_X);
  const posOf = (x: number) => p0 + ((x - PAD_X) / (width - 2 * PAD_X)) * (pMax - p0);
  // Side view: up is +Z. Planform: leading edge (smallest X) on top.
  const yOf = (v: number) =>
    planform
      ? PAD_TOP + ((v - vMin) / vRange) * (H - PAD_TOP - PAD_BOTTOM)
      : PAD_TOP + ((vMax - v) / vRange) * (H - PAD_TOP - PAD_BOTTOM);

  const posFor = (x: XsecStation) => (draft && draft.index === x.index ? draft.pos : x.pos);
  const upper = st.map((x) => `${xOf(posFor(x)).toFixed(1)},${yOf(planform ? x.bottom : x.top).toFixed(1)}`);
  const lower = st.map((x) => `${xOf(posFor(x)).toFixed(1)},${yOf(planform ? x.top : x.bottom).toFixed(1)}`);
  const outline = `M${upper.join("L")}L${lower.reverse().join("L")}Z`;

  const localX = (e: { clientX: number }) => {
    const r = boxRef.current?.getBoundingClientRect();
    return r ? e.clientX - r.left : 0;
  };

  const stationAt = (x: number): XsecStation | null => {
    let best: XsecStation | null = null;
    let bestD = HIT + 1;
    for (const k of st) {
      const d = Math.abs(xOf(posFor(k)) - x);
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    return bestD <= HIT ? best : null;
  };

  const clampPos = (k: XsecStation, p: number) => {
    const eps = span * 0.002;
    const hi = k.hi === null ? Number.POSITIVE_INFINITY : k.hi - eps;
    return Math.min(Math.max(p, k.lo + eps), hi);
  };

  const onDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const x = localX(e);
    const k = stationAt(x);
    if (!k) return;
    e.preventDefault();
    onSelect(k.index);
    if (k.fixed) return;
    const key = `xsec-move:${geomId}:${k.index}:${Date.now()}`;
    dragRef.current = {
      index: k.index,
      pointerId: e.pointerId,
      startX: x,
      moved: false,
      sender: latestSender<number>(async (p) => {
        await vsp.xsecMoveTo(geomId, surf, k.index, p, key);
      }),
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    const x = localX(e);
    const d = dragRef.current;
    if (d) {
      if (!d.moved && Math.abs(x - d.startX) < 3) return;
      d.moved = true;
      const k = st[d.index];
      const p = clampPos(k, posOf(x));
      setDraft({ index: d.index, pos: p });
      d.sender.push(p);
      return;
    }
    const k = stationAt(x);
    const p = posOf(x);
    setHoverPos(!k && layout.canInsert && p > p0 && p < (extendable ? pMax : pLast) ? p : null);
  };

  const onUp = async (e: ReactPointerEvent<SVGSVGElement>) => {
    const d = dragRef.current;
    if (d) {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      await d.sender.flush();
      dragRef.current = null;
      setDraft(null);
      void load();
      return;
    }
    // A click on the strip (not on a section) inserts a section there.
    const x = localX(e);
    if (e.button !== 0 || stationAt(x) || !layout.canInsert) return;
    const p = posOf(x);
    if (p <= p0 || p >= (extendable ? pMax : pLast)) return;
    setHoverPos(null);
    act.guard(async () => {
      const res = await vsp.xsecInsertAt(geomId, surf, p);
      setLayout(res.layout);
      onSelect(res.index);
    });
  };

  const hint = layout.canInsert
    ? "Click a section to edit it · drag to move · click between sections to add one"
    : "Click a section to edit it";

  return (
    <div ref={boxRef} className={s.root}>
      <div className={s.head}>
        <span className={s.title}>{layout.viewLabel}</span>
        <span className={s.axis}>
          {layout.axisLabel} {fmt(p0)} – {fmt(pLast)}
        </span>
      </div>
      <svg
        className={s.svg}
        width={width}
        height={H}
        role="group"
        aria-label={`Section map. ${hint}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerLeave={() => setHoverPos(null)}
        style={{ cursor: hoverPos !== null ? "copy" : undefined }}
      >
        <title>{hint}</title>
        <line className={s.axisLine} x1={PAD_X} x2={width - PAD_X} y1={H - PAD_BOTTOM + 6} y2={H - PAD_BOTTOM + 6} />
        <path className={s.body} d={outline} />
        {extendable && <rect className={s.extendZone} x={xOf(pLast)} y={PAD_TOP} width={xOf(pMax) - xOf(pLast)} height={H - PAD_TOP - PAD_BOTTOM} rx={4} />}

        {hoverPos !== null && (
          <g className={s.ghost} pointerEvents="none">
            <line x1={xOf(hoverPos)} x2={xOf(hoverPos)} y1={PAD_TOP - 4} y2={H - PAD_BOTTOM + 6} />
            <circle cx={xOf(hoverPos)} cy={PAD_TOP - 8} r={6} />
            <path d={`M${xOf(hoverPos) - 3} ${PAD_TOP - 8}H${xOf(hoverPos) + 3}M${xOf(hoverPos)} ${PAD_TOP - 11}V${PAD_TOP - 5}`} />
            <text x={xOf(hoverPos)} y={H - 4} textAnchor="middle">
              {fmt(hoverPos)}
            </text>
          </g>
        )}

        {st.map((k) => {
          const x = xOf(posFor(k));
          const sel = selected === k.index;
          const yTop = yOf(planform ? k.bottom : k.top);
          const yBot = yOf(planform ? k.top : k.bottom);
          return (
            <g key={k.index} className={sel ? s.stationSelected : k.fixed ? s.stationFixed : s.station}>
              <line x1={x} x2={x} y1={Math.min(yTop, yBot) - 3} y2={Math.max(yTop, yBot, H - PAD_BOTTOM) + 6} />
              <circle cx={x} cy={H - PAD_BOTTOM + 6} r={sel ? 5.5 : 4.5}>
                <title>
                  {`Section ${k.index} at ${fmt(posFor(k))}${k.fixed ? " (fixed)" : " (drag to move)"}`}
                </title>
              </circle>
              <text x={x} y={PAD_TOP - 6} textAnchor="middle">
                {k.index}
              </text>
              {sel && (
                <text className={s.posLabel} x={x} y={H - 4} textAnchor="middle">
                  {fmt(posFor(k))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
