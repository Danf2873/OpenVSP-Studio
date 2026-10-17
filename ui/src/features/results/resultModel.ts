// Pure helpers for result data: scalars, column groups, matrices, plot presets,
// and TSV export. No React and no imports, so they can be checked with node.

export interface ResultDatumLike {
  name: string;
  type: string;
  value: unknown;
  doc?: string;
}

export type Cell = number | string | null;

export interface Column {
  /** Unique within a result (vec3d components get a ".x" style suffix). */
  key: string;
  name: string;
  values: Cell[];
  numeric: boolean;
}

/** Columns that all have the same number of rows; they form one table. */
export interface ColumnGroup {
  length: number;
  columns: Column[];
}

export interface ScalarItem {
  name: string;
  text: string;
  doc?: string;
}

export interface MatrixItem {
  name: string;
  rows: Array<Array<number | null>>;
}

export interface ResultModel {
  scalars: ScalarItem[];
  groups: ColumnGroup[];
  matrices: MatrixItem[];
}

const AXES = ["x", "y", "z"];

export function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return null;
}

/** Compact display for table cells and scalars: 6 significant digits. */
export function formatNumber(v: number): string {
  if (Number.isNaN(v)) return "NaN";
  if (!Number.isFinite(v)) return v > 0 ? "Inf" : "-Inf";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e-3 && a < 1e6) return String(Number(v.toPrecision(6)));
  return v.toExponential(3);
}

/** Display text for any result or summary value. */
export function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "number") return formatNumber(v);
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (Array.isArray(v)) {
    if (v.length === 0) return "—";
    if (v.every((x) => x === null || typeof x !== "object")) {
      const shown = v.slice(0, 12).map((x) => formatValue(x));
      return v.length > 12 ? `${shown.join(", ")}, …` : shown.join(", ");
    }
  }
  try {
    return JSON.stringify(v);
  } catch {
    return "—";
  }
}

export function cellDisplay(c: Cell | undefined): string {
  if (c === null || c === undefined) return "—";
  if (typeof c === "number") return formatNumber(c);
  return c;
}

function asMatrix(value: unknown): Array<Array<number | null>> {
  if (!Array.isArray(value)) return [];
  return value.map((row) => (Array.isArray(row) ? row.map((x) => toNumber(x)) : [toNumber(row)]));
}

function makeColumn(key: string, name: string, raw: unknown[]): Column {
  const values: Cell[] = raw.map((v) => (typeof v === "string" ? v : toNumber(v)));
  const numeric = values.every((v) => v === null || typeof v === "number");
  return { key, name, values, numeric };
}

export function buildModel(data: ResultDatumLike[]): ResultModel {
  const scalars: ScalarItem[] = [];
  const columns: Column[] = [];
  const matrices: MatrixItem[] = [];

  for (const d of data) {
    if (d.type === "double_mat") {
      matrices.push({ name: d.name, rows: asMatrix(d.value) });
      continue;
    }
    const list: unknown[] = Array.isArray(d.value)
      ? d.value
      : d.value === undefined || d.value === null
        ? []
        : [d.value];

    if (list.length === 0) {
      scalars.push({ name: d.name, text: "—", doc: d.doc });
      continue;
    }
    if (list.length === 1) {
      scalars.push({ name: d.name, text: formatValue(list[0]), doc: d.doc });
      continue;
    }
    if (d.type === "vec3d") {
      AXES.forEach((axis, k) => {
        const name = `${d.name}.${axis}`;
        columns.push(makeColumn(name, name, list.map((p) => (Array.isArray(p) ? p[k] : null))));
      });
      continue;
    }
    columns.push(makeColumn(d.name, d.name, list));
  }

  const byLength = new Map<number, Column[]>();
  for (const c of columns) {
    const n = c.values.length;
    const bucket = byLength.get(n);
    if (bucket) bucket.push(c);
    else byLength.set(n, [c]);
  }
  const groups: ColumnGroup[] = [...byLength.entries()]
    .map(([length, cols]) => ({ length, columns: cols }))
    .sort((a, b) => b.columns.length - a.columns.length || b.length - a.length);

  return { scalars, groups, matrices };
}

/** Lower-case alphanumerics only, so "CDtot", "cd_tot" and "CD tot" compare equal. */
export function normName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface PresetDef {
  id: string;
  label: string;
  x: string[];
  y: string[];
}

/** Candidate names are tried in order; matching is case-insensitive. */
export const PLOT_PRESETS: PresetDef[] = [
  { id: "cl-alpha", label: "CL vs α", x: ["alpha", "aoa"], y: ["cltot", "cl"] },
  { id: "cd-alpha", label: "CD vs α", x: ["alpha", "aoa"], y: ["cdtot", "cd"] },
  { id: "polar", label: "CL vs CD (polar)", x: ["cdtot", "cd"], y: ["cltot", "cl"] },
  { id: "cmy-alpha", label: "CMy vs α", x: ["alpha", "aoa"], y: ["cmytot", "cmy"] },
];

function findColumn(columns: Column[], candidates: string[]): Column | undefined {
  for (const cand of candidates) {
    const hit = columns.find((c) => c.numeric && normName(c.name) === cand);
    if (hit) return hit;
  }
  return undefined;
}

export interface PresetMatch {
  group: number;
  x: string;
  y: string;
}

export function resolvePreset(model: ResultModel, preset: PresetDef): PresetMatch | null {
  for (let g = 0; g < model.groups.length; g++) {
    const cols = model.groups[g].columns;
    const x = findColumn(cols, preset.x);
    const y = findColumn(cols, preset.y);
    if (x && y && x.key !== y.key) return { group: g, x: x.key, y: y.key };
  }
  return null;
}

export interface GroupDefault {
  x: string;
  ys: string[];
}

/** Default X and Y for a group: the first two numeric columns. */
export function defaultForGroup(group: ColumnGroup): GroupDefault {
  const numeric = group.columns.filter((c) => c.numeric);
  return {
    x: numeric[0]?.key ?? "",
    ys: numeric.slice(1, 2).map((c) => c.key),
  };
}

export interface PlotSelection extends GroupDefault {
  group: number;
}

/** Initial plot selection: the first preset that resolves, else the first group's defaults. */
export function defaultSelection(model: ResultModel): PlotSelection {
  for (const preset of PLOT_PRESETS) {
    const m = resolvePreset(model, preset);
    if (m) return { group: m.group, x: m.x, ys: [m.y] };
  }
  const d = model.groups[0] ? defaultForGroup(model.groups[0]) : { x: "", ys: [] };
  return { group: 0, ...d };
}

/** Tab-separated text of scalars, every table, and matrices. Full precision for numbers. */
export function toTsv(model: ResultModel): string {
  const blocks: string[] = [];
  if (model.scalars.length > 0) {
    blocks.push(["Name\tValue", ...model.scalars.map((x) => `${x.name}\t${x.text}`)].join("\n"));
  }
  for (const g of model.groups) {
    const header = g.columns.map((c) => c.name).join("\t");
    const rows = Array.from({ length: g.length }, (_, r) =>
      g.columns
        .map((c) => {
          const v = c.values[r];
          if (v === null || v === undefined) return "";
          return typeof v === "number" ? String(v) : v;
        })
        .join("\t"),
    );
    blocks.push([header, ...rows].join("\n"));
  }
  for (const m of model.matrices) {
    const rows = m.rows.map((r) => r.map((v) => (v === null ? "" : String(v))).join("\t"));
    blocks.push([m.name, ...rows].join("\n"));
  }
  return blocks.join("\n\n");
}
