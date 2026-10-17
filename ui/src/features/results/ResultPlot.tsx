import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Chip, EmptyState, Select } from "../../components";
import { extent, formatTick, linearScale, niceTicks } from "./chartMath";
import {
  defaultForGroup,
  defaultSelection,
  PLOT_PRESETS,
  resolvePreset,
  type PresetMatch,
  type ResultModel,
} from "./resultModel";
import s from "./results.module.css";

// Series colors come from tokens so they follow light and dark themes.
const SERIES_COLORS = [
  "var(--accent-blue)",
  "var(--accent-green)",
  "color-mix(in srgb, var(--danger) 85%, var(--text-primary))",
  "color-mix(in srgb, var(--accent-blue) 50%, var(--accent-green))",
  "color-mix(in srgb, var(--text-primary) 55%, var(--bg-primary))",
];

const PAD = { l: 58, r: 14, t: 12, b: 34 };
const MARKER_LIMIT = 80;

function finiteOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/** Line chart of one or more numeric columns against an X column, with hover and keyboard readout. */
export function ResultPlot({ model }: { model: ResultModel }) {
  const initial = useMemo(() => defaultSelection(model), [model]);
  const [groupIndex, setGroupIndex] = useState(initial.group);
  const [xKey, setXKey] = useState(initial.x);
  const [yKeys, setYKeys] = useState<string[]>(initial.ys);
  const [hoverRow, setHoverRow] = useState<number | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ w: 640, h: 220 });

  const hasData = model.groups.length > 0;

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0]?.contentRect;
      if (!r) return;
      setSize({ w: Math.max(240, Math.floor(r.width)), h: Math.max(140, Math.floor(r.height)) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [hasData]);

  if (!hasData) {
    return <EmptyState title="Nothing to plot" text="A plot needs an array of at least two numbers." />;
  }

  const gi = Math.min(groupIndex, model.groups.length - 1);
  const group = model.groups[gi];
  const numeric = group.columns.filter((c) => c.numeric);
  const xCol = numeric.find((c) => c.key === xKey) ?? numeric[0];
  const ys = numeric.filter((c) => c.key !== xCol?.key && yKeys.includes(c.key));
  const rows = group.length;

  const xs: Array<number | null> = xCol ? xCol.values.map(finiteOrNull) : [];
  const series: Array<Array<number | null>> = ys.map((c) => c.values.map(finiteOrNull));

  // Rows with a usable X and at least one usable Y.
  const valid: number[] = [];
  for (let i = 0; i < rows; i++) {
    if (xs[i] !== null && series.some((sr) => sr[i] !== null)) valid.push(i);
  }
  const xr = extent(valid.map((i) => xs[i] as number));
  const yr = extent(valid.flatMap((i) => series.map((sr) => sr[i]).filter((v): v is number => v !== null)));
  const ready = xr !== null && yr !== null && ys.length > 0 && xCol !== undefined;

  const W = size.w;
  const H = size.h;
  const innerW = W - PAD.l - PAD.r;
  const innerH = H - PAD.t - PAD.b;
  const xt = ready ? niceTicks(xr[0], xr[1], 6) : null;
  const yt = ready ? niceTicks(yr[0], yr[1], 5) : null;
  const sx = xt ? linearScale(xt.lo, xt.hi, PAD.l, PAD.l + innerW) : null;
  const sy = yt ? linearScale(yt.lo, yt.hi, PAD.t + innerH, PAD.t) : null;

  const pathFor = (sr: Array<number | null>): string => {
    if (!sx || !sy) return "";
    let d = "";
    let pen = false;
    for (const i of valid) {
      const y = sr[i];
      if (y === null) {
        pen = false;
        continue;
      }
      d += `${pen ? "L" : "M"}${sx(xs[i] as number).toFixed(1)},${sy(y).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const applyPreset = (m: PresetMatch) => {
    setGroupIndex(m.group);
    setXKey(m.x);
    setYKeys([m.y]);
    setHoverRow(null);
  };

  const onGroupChange = (value: string) => {
    const next = Number(value);
    const d = defaultForGroup(model.groups[next]);
    setGroupIndex(next);
    setXKey(d.x);
    setYKeys(d.ys);
    setHoverRow(null);
  };

  const toggleY = (key: string) => {
    setYKeys((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!sx || valid.length === 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const px = (e.clientX - rect.left) * (W / rect.width);
    let best = valid[0];
    let bestDist = Infinity;
    for (const i of valid) {
      const d = Math.abs(sx(xs[i] as number) - px);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    setHoverRow(best);
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (valid.length === 0) return;
    const last = valid.length - 1;
    const pos = hoverRow === null ? -1 : valid.indexOf(hoverRow);
    let next: number | null = null;
    if (e.key === "ArrowRight") next = pos < 0 ? 0 : Math.min(last, pos + 1);
    else if (e.key === "ArrowLeft") next = pos < 0 ? last : Math.max(0, pos - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else if (e.key === "Escape") {
      setHoverRow(null);
      return;
    }
    if (next !== null) {
      e.preventDefault();
      setHoverRow(valid[next]);
    }
  };

  const hoverX = hoverRow !== null && xs[hoverRow] !== null ? (xs[hoverRow] as number) : null;
  const tipLeft = hoverX !== null && sx ? Math.min(Math.max(sx(hoverX) + 10, PAD.l), W - 170) : 0;

  return (
    <div className={s.plot}>
      <div className={s.plotControls}>
        {model.groups.length > 1 && (
          <Select
            value={String(gi)}
            options={model.groups.map((g, i) => ({ value: String(i), label: `${g.length} rows` }))}
            onChange={onGroupChange}
            ariaLabel="Data set"
          />
        )}
        {numeric.length > 0 && (
          <Select
            value={xCol?.key ?? ""}
            options={numeric.map((c) => ({ value: c.key, label: `X: ${c.name}` }))}
            onChange={(v) => {
              setXKey(v);
              setYKeys((prev) => prev.filter((k) => k !== v));
              setHoverRow(null);
            }}
            ariaLabel="X axis"
          />
        )}
        <div className={s.presets} role="group" aria-label="Presets">
          {PLOT_PRESETS.map((p) => {
            const m = resolvePreset(model, p);
            return (
              <Chip
                key={p.id}
                pressed={false}
                disabled={!m}
                title={m ? `Plot ${p.label}` : "Not available for this result"}
                onClick={() => m && applyPreset(m)}
              >
                {p.label}
              </Chip>
            );
          })}
        </div>
      </div>

      <div className={s.yChips} role="group" aria-label="Y series">
        {numeric
          .filter((c) => c.key !== xCol?.key)
          .map((c) => (
            <Chip key={c.key} pressed={yKeys.includes(c.key)} onClick={() => toggleY(c.key)}>
              {c.name}
            </Chip>
          ))}
      </div>

      <div ref={wrapRef} className={s.chartWrap}>
        {ready && xt && yt && sx && sy && xCol ? (
          <>
            <svg
              width={W}
              height={H}
              viewBox={`0 0 ${W} ${H}`}
              className={s.svg}
              role="img"
              aria-label={`${ys.map((c) => c.name).join(", ")} against ${xCol.name}. Use arrow keys to read values.`}
              tabIndex={0}
              onPointerMove={onPointerMove}
              onPointerLeave={() => setHoverRow(null)}
              onKeyDown={onKeyDown}
              onBlur={() => setHoverRow(null)}
            >
              {yt.ticks.map((t) => (
                <g key={`y${t}`}>
                  <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} className={s.grid} />
                  <text x={PAD.l - 6} y={sy(t)} dy="0.32em" textAnchor="end" className={s.tick}>
                    {formatTick(t, yt.step)}
                  </text>
                </g>
              ))}
              {xt.ticks.map((t) => (
                <g key={`x${t}`}>
                  <line x1={sx(t)} x2={sx(t)} y1={PAD.t} y2={H - PAD.b} className={s.grid} />
                  <text x={sx(t)} y={H - PAD.b + 15} textAnchor="middle" className={s.tick}>
                    {formatTick(t, xt.step)}
                  </text>
                </g>
              ))}
              <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className={s.axis} />
              <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} className={s.axis} />
              <text x={PAD.l + innerW / 2} y={H - 4} textAnchor="middle" className={s.axisTitle}>
                {xCol.name}
              </text>

              {series.map((sr, k) => (
                <path
                  key={ys[k].key}
                  d={pathFor(sr)}
                  fill="none"
                  className={s.line}
                  style={{ stroke: SERIES_COLORS[k % SERIES_COLORS.length] }}
                />
              ))}
              {valid.length <= MARKER_LIMIT &&
                series.map((sr, k) =>
                  valid.map((i) =>
                    sr[i] === null ? null : (
                      <circle
                        key={`${ys[k].key}-${i}`}
                        cx={sx(xs[i] as number)}
                        cy={sy(sr[i] as number)}
                        r={2.5}
                        style={{ fill: SERIES_COLORS[k % SERIES_COLORS.length] }}
                      />
                    ),
                  ),
                )}

              {hoverRow !== null && xs[hoverRow] !== null && (
                <g>
                  <line
                    x1={sx(xs[hoverRow] as number)}
                    x2={sx(xs[hoverRow] as number)}
                    y1={PAD.t}
                    y2={H - PAD.b}
                    className={s.cursor}
                  />
                  {series.map((sr, k) =>
                    sr[hoverRow] === null ? null : (
                      <circle
                        key={`hover-${ys[k].key}`}
                        cx={sx(xs[hoverRow] as number)}
                        cy={sy(sr[hoverRow] as number)}
                        r={4}
                        className={s.hoverDot}
                        style={{ stroke: SERIES_COLORS[k % SERIES_COLORS.length] }}
                      />
                    ),
                  )}
                </g>
              )}
            </svg>

            {hoverRow !== null && hoverX !== null && (
              <div className={s.tooltip} style={{ left: tipLeft, top: PAD.t }} aria-hidden="true">
                <div className={s.tipX}>
                  {xCol.name} = {String(Number(hoverX.toPrecision(5)))}
                </div>
                {ys.map((c, k) => {
                  const v = series[k][hoverRow];
                  return (
                    <div key={c.key} className={s.tipRow}>
                      <span className={s.swatch} style={{ background: SERIES_COLORS[k % SERIES_COLORS.length] }} />
                      <span className={s.tipName}>{c.name}</span>
                      <span className={s.tipVal}>{v === null ? "—" : String(Number(v.toPrecision(5)))}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          numeric.length < 2 ? (
            <EmptyState title="Nothing to plot" text="A plot needs at least two numeric columns of equal length." />
          ) : (
            <EmptyState title="Pick a Y series" text="Choose one or more numeric columns to plot against X." />
          )
        )}
      </div>

      {ready && ys.length > 0 && (
        <ul className={s.legend} aria-label="Legend">
          {ys.map((c, k) => (
            <li key={c.key} className={s.legendItem}>
              <span className={s.swatch} style={{ background: SERIES_COLORS[k % SERIES_COLORS.length] }} />
              {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
