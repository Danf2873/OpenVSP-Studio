// Floating glass card for the active analysis overlay: title, colour scale, and during
// a VSPAERO run a live iteration readout with a CL sparkline. Close clears the overlay.

import { X } from "lucide-react";
import type { OverlayLegend as LegendInfo, OverlayProgress } from "../../api/types";
import { IconButton } from "../../components";
import { useOverlayStore } from "../../store/overlayStore";
import s from "./OverlayLegend.module.css";

const MINUS = "−";

function fmt(v: number, digits = 3): string {
  if (!Number.isFinite(v)) return "–";
  return v.toFixed(digits).replace("-", MINUS);
}

function ColorScale({ legend }: { legend: LegendInfo }) {
  return (
    <div>
      <div className={s.bar} role="img" aria-label={`${legend.label} colour scale from ${fmt(legend.min)} to ${fmt(legend.max)}`} />
      <div className={s.scaleRow}>
        <span>{fmt(legend.min)}</span>
        <span className={s.scaleLabel}>{legend.label}</span>
        <span>{fmt(legend.max)}</span>
      </div>
    </div>
  );
}

/** Sparkline of CLtot over the solver rows. Plain SVG; the path is redrawn on each poll. */
function Sparkline({ values }: { values: number[] }) {
  const W = 200;
  const H = 36;
  const pad = 3;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi > lo ? hi - lo : 1;
  const n = values.length;
  const points = values
    .map((v, i) => {
      const x = n > 1 ? pad + (i / (n - 1)) * (W - 2 * pad) : W / 2;
      const y = H - pad - ((v - lo) / span) * (H - 2 * pad);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  return (
    <svg className={s.spark} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`CL over ${n} solver rows, from ${fmt(lo)} to ${fmt(hi)}`}>
      <polyline points={points} />
    </svg>
  );
}

function LiveReadout({ progress }: { progress: OverlayProgress }) {
  const rows = progress.rows;
  const last = rows[rows.length - 1];
  const cl = rows.map((r) => r.CLtot).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  const residual = last?.["L2 Residual"];

  const parts: string[] = [];
  parts.push(progress.iteration > 0 ? `Iteration ${progress.iteration}` : "Waiting for the solver");
  if (typeof last?.CLtot === "number") parts.push(`CL ${fmt(last.CLtot)}`);
  if (typeof residual === "number" && Number.isFinite(residual)) parts.push(`residual ${fmt(residual, 2)}`);

  return (
    <div className={s.live}>
      <span className={s.liveLine}>{parts.join(" · ")}</span>
      {cl.length > 1 && <Sparkline values={cl} />}
    </div>
  );
}

export function OverlayLegend() {
  const active = useOverlayStore((st) => st.active);
  if (!active) return null;

  const { analysis, data, progress } = active;
  if (!data && !progress) return null;

  const legend = data?.legend;
  const title = data?.title ?? analysis;
  const showNote = !legend && !!data?.note;

  return (
    <section className={s.card} aria-label={`Overlay for ${analysis}`}>
      <header className={s.head}>
        <span className={s.title} title={title}>
          {title}
        </span>
        <IconButton label="Close overlay" icon={<X size={14} />} onClick={() => useOverlayStore.getState().clear()} />
      </header>
      {legend && <ColorScale legend={legend} />}
      {showNote && <p className={s.note}>{data?.note}</p>}
      {progress && <LiveReadout progress={progress} />}
    </section>
  );
}
