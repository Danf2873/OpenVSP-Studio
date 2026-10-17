// Pure chart math (no React, no imports): nice axis ticks and linear scales.

export interface Ticks {
  /** First and last tick; the axis domain. */
  lo: number;
  hi: number;
  step: number;
  ticks: number[];
}

/** Heckbert's "nice number" for axis ranges and steps. */
function niceNum(range: number, round: boolean): number {
  const exp = Math.floor(Math.log10(range));
  const f = range / 10 ** exp;
  let nf: number;
  if (round) nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 7 ? 5 : 10;
  else nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

function clean(x: number): number {
  const r = Number(x.toPrecision(12));
  return r === 0 ? 0 : r;
}

/** Ticks covering [min, max] with roughly `target` intervals. */
export function niceTicks(min: number, max: number, target = 5): Ticks {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 1;
  if (hi < lo) [lo, hi] = [hi, lo];
  if (hi - lo < 1e-12) {
    const pad = lo === 0 ? 1 : Math.abs(lo) * 0.1;
    lo -= pad;
    hi += pad;
  }
  const range = niceNum(hi - lo, false);
  const step = niceNum(range / Math.max(1, target - 1), true);
  const first = Math.floor(lo / step) * step;
  const last = Math.ceil(hi / step) * step;
  const n = Math.max(1, Math.round((last - first) / step));
  const ticks = Array.from({ length: n + 1 }, (_, k) => clean(first + k * step));
  return { lo: ticks[0], hi: ticks[ticks.length - 1], step, ticks };
}

/** Tick label with just enough decimals for the step size. */
export function formatTick(v: number, step: number): string {
  if (v === 0) return "0";
  if (step >= 1e6 || step < 1e-3) return v.toExponential(1);
  const decimals = Math.min(6, Math.max(0, -Math.floor(Math.log10(step))));
  return v.toFixed(decimals);
}

/** [min, max] of the finite values, or null if there are none. */
export function extent(values: number[]): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const v of values) {
    if (!Number.isFinite(v)) continue;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }
  return lo <= hi ? [lo, hi] : null;
}

/** Linear map from [d0, d1] to [r0, r1]. Works with r0 > r1 (inverted axes). */
export function linearScale(d0: number, d1: number, r0: number, r1: number): (v: number) => number {
  const span = d1 - d0;
  if (span === 0) return () => (r0 + r1) / 2;
  return (v: number) => r0 + ((v - d0) * (r1 - r0)) / span;
}
