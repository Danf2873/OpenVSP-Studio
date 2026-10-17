"""Analysis overlays: 3D visualisation data for the viewport (docs/API.md "overlay.*").

    overlay.get {analysis, resultId?}   OverlayItems built from saved results (not concurrent)
    overlay.prepare {analysis}          records the model's file base before a run (not concurrent)
    overlay.progress {analysis}         reads the files of a running analysis (concurrent)

All coordinates are global XYZ (OpenVSP Z-up). VSPAERO writes <base>.lod, .history
and .slc next to the saved model, where base = splitext(GetVSPFileName()).
overlay.progress only reads files: it is answered while a VSPAERO job holds the
OpenVSP worker, so it must not call `vsp`.
"""
from __future__ import annotations

import math
import os
import re
import time

from engine.vspctx import vsp
from engine.registry import method

VSPAERO_RUNS = {"VSPAEROSweep", "VSPAEROSinglePoint"}
ARROW_SPAN_FRACTION = 0.25        # largest lift arrow, as a fraction of the model span
FREESTREAM_FRACTION = 0.5         # free-stream arrow length, as a fraction of the span
CP_OFFSET_FRACTION = 0.1          # largest Cp deflection, as a fraction of the span
HISTORY_TAIL = 50                 # solver rows sent with each progress reply
STRIP_COLUMNS = ("VortexSheet", "Xavg", "Yavg", "Zavg", "dSpan", "Chord", "Cl")

# Result set that holds each analysis's data (for analyses that use results, not files).
RESULT_FOR = {"MassProp": "Mass_Properties"}

# Last base path given by overlay.prepare; progress reads files under it.
_run_state: dict = {"base": None, "since": 0.0, "analysis": None}


# --- small helpers ----------------------------------------------------------------------

def _to_float(text: str) -> float | None:
    """Parse a number. Non-finite values are kept; callers check the columns they use."""
    try:
        return float(text)
    except ValueError:
        return None


def _read_text(path: str) -> str | None:
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            return f.read()
    except OSError:  # missing, or still held open by VSPAERO
        return None


def _mtime(path: str) -> float | None:
    try:
        return os.path.getmtime(path)
    except OSError:
        return None


def _model_base() -> str:
    return os.path.abspath(os.path.splitext(vsp.GetVSPFileName())[0])


def _sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def _add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def _scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def _unit(a) -> tuple[float, float, float] | None:
    n = math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2])
    if n < 1e-12 or not math.isfinite(n):
        return None
    return (a[0] / n, a[1] / n, a[2] / n)


def _cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def _vec(p) -> list[float]:
    return [float(p[0]), float(p[1]), float(p[2])]


def _empty(analysis: str, note: str) -> dict:
    return {"analysis": analysis, "items": [], "note": note}


# --- VSPAERO .lod ------------------------------------------------------------------------

_LOD_HEADER_RE = re.compile(r"^(AoA_|Beta_)\s+(\S+)")


def _parse_lod(text: str) -> list[dict]:
    """Blocks in file order. Each block starts at an "Iter" line (one per solved case)."""
    blocks: list[dict] = []
    cur: dict | None = None
    aoa = beta = 0.0
    for raw in text.splitlines():
        line = raw.strip()
        if not line:
            continue
        if line.startswith("Iter"):
            cur = {"aoa": aoa, "beta": beta, "columns": line.split(), "rows": []}
            blocks.append(cur)
            continue
        m = _LOD_HEADER_RE.match(line)
        if m:
            value = _to_float(m.group(2))
            if value is not None:
                if m.group(1) == "AoA_":
                    aoa = value
                else:
                    beta = value
            cur = None
            continue
        if cur is None:
            continue
        toks = line.split()
        n = len(cur["columns"])
        if len(toks) < n:
            continue
        vals = [_to_float(t) for t in toks[:n]]
        if any(v is None for v in vals):
            continue
        cur["rows"].append(vals)
    return blocks


def _strip_records(block: dict) -> list[dict]:
    cols = {name: i for i, name in enumerate(block["columns"])}
    if any(c not in cols for c in STRIP_COLUMNS):
        return []
    recs = []
    for row in block["rows"]:
        used = [row[cols[c]] for c in STRIP_COLUMNS]
        if not all(math.isfinite(v) for v in used):
            continue  # a strip without finite geometry or load cannot be drawn
        recs.append({
            "idx": len(recs),
            "sheet": int(round(row[cols["VortexSheet"]])),
            "c": (row[cols["Xavg"]], row[cols["Yavg"]], row[cols["Zavg"]]),
            "dspan": row[cols["dSpan"]],
            "chord": row[cols["Chord"]],
            "cl": row[cols["Cl"]],
        })
    return recs


def _span_direction(centers: list, j: int) -> tuple[float, float, float]:
    """Spanwise unit vector at strip j, from its neighbours in the same vortex sheet.

    The x (chordwise) component is dropped so the strip keeps its chord along +X even
    when the quarter-chord line of a swept surface runs diagonally.
    """
    n = len(centers)
    if n < 2:
        return (0.0, 1.0, 0.0)
    a = centers[max(j - 1, 0)]
    b = centers[min(j + 1, n - 1)]
    d = _sub(b, a)
    return _unit((0.0, d[1], d[2])) or (0.0, 1.0, 0.0)


def _geometry(recs: list[dict]) -> dict:
    """Quads, arrows and per-sheet lift curves for one solved case (values follow file order)."""
    groups: dict[int, list[dict]] = {}
    for r in recs:
        groups.setdefault(r["sheet"], []).append(r)

    dirs: list[tuple[float, float, float]] = [(0.0, 1.0, 0.0)] * len(recs)
    for group in groups.values():
        centers = [r["c"] for r in group]
        for j, r in enumerate(group):
            dirs[r["idx"]] = _span_direction(centers, j)

    quads: list[list[list[float]]] = []
    corners_all: list[tuple[float, float, float]] = []
    for r, d in zip(recs, dirs):
        cx, cy, cz = r["c"]
        half = r["dspan"] / 2.0
        chord = r["chord"]

        def pt(a: float, b: float) -> tuple[float, float, float]:
            # chordwise along +X from Xavg-0.25c to Xavg+0.75c; spanwise along d by +-dSpan/2
            return (cx + a + b * d[0], cy + b * d[1], cz + b * d[2])

        corners = [pt(-0.25 * chord, -half), pt(0.75 * chord, -half), pt(0.75 * chord, half), pt(-0.25 * chord, half)]
        corners_all.extend(corners)
        quads.append([_vec(p) for p in corners])

    if corners_all:
        span = max(
            max(p[k] for p in corners_all) - min(p[k] for p in corners_all) for k in range(3)
        )
    else:
        span = 0.0
    if not span > 0:
        span = 1.0

    max_load = max((abs(r["cl"] * r["chord"]) for r in recs), default=0.0)
    k = ARROW_SPAN_FRACTION * span / max_load if max_load > 0 else 0.0
    origins = [_vec(r["c"]) for r in recs]
    vectors = [[0.0, 0.0, k * r["cl"] * r["chord"]] for r in recs]
    tips_by_sheet: list[list[list[float]]] = []
    for group in groups.values():
        if len(group) >= 2:
            tips_by_sheet.append([_vec(_add(r["c"], (0.0, 0.0, k * r["cl"] * r["chord"]))) for r in group])

    return {
        "quads": quads,
        "values": [float(r["cl"]) for r in recs],
        "origins": origins,
        "vectors": vectors,
        "polylines": tips_by_sheet,
        "span": span,
        "corners": corners_all,
    }


def _strips_item(geo: dict) -> dict:
    return {"kind": "strips", "quads": geo["quads"], "values": geo["values"]}


def _lift_items(geo: dict, aoa: float, beta: float) -> tuple[list[dict], dict]:
    items: list[dict] = [_strips_item(geo)]
    items.append({"kind": "arrows", "origins": geo["origins"], "vectors": geo["vectors"],
                  "values": geo["values"], "color": "accent"})
    for line in geo["polylines"]:
        items.append({"kind": "polyline", "points": line, "color": "accent", "closed": False})

    # Free-stream arrow upstream of the model, pointing along the relative wind.
    a = math.radians(aoa)
    b = math.radians(beta)
    wind = _unit((math.cos(a) * math.cos(b), -math.sin(b), math.sin(a) * math.cos(b))) or (1.0, 0.0, 0.0)
    pts = geo["corners"]
    centre = (
        (min(p[0] for p in pts) + max(p[0] for p in pts)) / 2.0,
        (min(p[1] for p in pts) + max(p[1] for p in pts)) / 2.0,
        (min(p[2] for p in pts) + max(p[2] for p in pts)) / 2.0,
    )
    span = geo["span"]
    origin = _sub(centre, _scale(wind, 0.75 * span))
    items.append({"kind": "arrows", "origins": [_vec(origin)],
                  "vectors": [_vec(_scale(wind, FREESTREAM_FRACTION * span))], "color": "green"})

    values = geo["values"]
    legend = {"label": "Cl", "min": min(values), "max": max(values), "colormap": "cool-warm"}
    return items, legend


def _vspaero_overlay(analysis: str) -> dict:
    text = _read_text(_model_base() + ".lod")
    if text is None:
        return _empty(analysis, "Run VSPAERO to see loads on the wing.")
    blocks = _parse_lod(text)
    if not blocks or not blocks[-1]["rows"]:
        return _empty(analysis, "The VSPAERO load file has no strip data yet.")
    recs = _strip_records(blocks[-1])
    if not recs:
        return _empty(analysis, "The VSPAERO load file has no Cl column.")
    last = blocks[-1]
    geo = _geometry(recs)
    items, legend = _lift_items(geo, last["aoa"], last["beta"])
    return {
        "analysis": analysis,
        "title": f"VSPAERO · spanwise lift (Cl) · AoA {last['aoa']:g} deg, Beta {last['beta']:g} deg",
        "items": items,
        "legend": legend,
    }


# --- VSPAERO .history (progress) ------------------------------------------------------

def _parse_history(text: str) -> tuple[int, list[dict]]:
    """Returns (number of solver cases started, solver rows of all cases in order).

    Each row is a dict keyed by the header names, plus "Case" (its solver case number).
    """
    cases = 0
    cols: list[str] | None = None
    rows: list[dict] = []
    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            continue
        if s.startswith("Solver Case:"):
            m = re.search(r"(\d+)", s)
            cases = int(m.group(1)) if m else cases + 1
            cols = None
            continue
        if cols is None and s.startswith("Iter"):
            cols = re.split(r"\s{2,}", s)
            continue
        if cols is None:
            continue
        toks = s.split()
        if len(toks) < len(cols):
            continue
        vals = [_to_float(t) for t in toks[:len(cols)]]
        if any(v is None for v in vals):
            continue
        row = dict(zip(cols, vals))
        row["Case"] = float(cases)
        rows.append(row)
    return cases, rows


# --- CpSlicer (.slc) ------------------------------------------------------------------

_CUT_RE = re.compile(r"^BLOCK\s+Cut_\d+_at_([XYZ]):_(-?[0-9.eE+\-]+)", re.IGNORECASE)


def _parse_slc(text: str) -> dict[tuple[str, str], list[list[float]]]:
    """Cut (axis, value text) -> [x, y, z, dCp] rows. A repeated cut keeps its last case."""
    cuts: dict[tuple[str, str], list[list[float]]] = {}
    key: tuple[str, str] | None = None
    pts: list[list[float]] = []
    for raw in text.splitlines():
        s = raw.strip()
        if not s:
            continue
        m = _CUT_RE.match(s)
        if m:
            if key is not None:
                cuts[key] = pts
            key = (m.group(1).upper(), m.group(2))
            pts = []
            continue
        if key is None:
            continue
        if s.startswith("Case:"):
            pts = []  # the last case in a block wins
            continue
        toks = s.split()
        if len(toks) != 4:
            continue
        vals = [_to_float(t) for t in toks]
        if any(v is None for v in vals):
            continue
        pts.append(vals)
    if key is not None:
        cuts[key] = pts
    return cuts


def _cp_items(cuts: dict, span_hint: float) -> list[dict]:
    items: list[dict] = []
    all_cp = [p[3] for pts in cuts.values() for p in pts]
    if not all_cp:
        return items
    span = span_hint
    max_cp = max(abs(v) for v in all_cp)
    k = CP_OFFSET_FRACTION * span / max_cp if max_cp > 0 and span > 0 else 0.0
    axis_unit = {"X": (1.0, 0.0, 0.0), "Y": (0.0, 1.0, 0.0), "Z": (0.0, 0.0, 1.0)}
    for (axis, value), pts in cuts.items():
        if len(pts) < 2:
            continue
        ax = axis_unit[axis]
        curve = []
        for i, p in enumerate(pts):
            lo = pts[max(i - 1, 0)]
            hi = pts[min(i + 1, len(pts) - 1)]
            tangent = _sub((hi[0], hi[1], hi[2]), (lo[0], lo[1], lo[2]))
            normal = _unit(_cross(ax, tangent)) or (0.0, 0.0, 0.0)
            pos = _add((p[0], p[1], p[2]), _scale(normal, p[3] * k))
            curve.append(_vec(pos))
        items.append({"kind": "polyline", "points": curve, "color": "accent", "closed": False})
        items.append({"kind": "label", "position": _vec(pts[0][:3]), "text": f"Cp {axis} = {value}"})
    return items


def _cpslice_overlay(analysis: str) -> dict:
    text = _read_text(_model_base() + ".slc")
    if text is None:
        return _empty(analysis, "Run CpSlicer after VSPAERO to see pressure cuts.")
    cuts = _parse_slc(text)
    coords = [p[:3] for pts in cuts.values() for p in pts]
    if not coords:
        return _empty(analysis, "The pressure cut file has no data yet.")
    span = max(max(c[k] for c in coords) - min(c[k] for c in coords) for k in range(3))
    items = _cp_items(cuts, span)
    if not items:
        return _empty(analysis, "The pressure cut file has no cut with enough points.")
    return {"analysis": analysis, "title": "CpSlicer · pressure cuts (dCp)", "items": items}


# --- MassProp ------------------------------------------------------------------------------

def _find_result(name: str, result_id: str | None) -> str | None:
    if result_id:
        return result_id
    if name not in set(vsp.GetAllResultsNames()):
        return None
    ids = [vsp.FindResultsID(name, i) for i in range(vsp.GetNumResults(name))]
    return ids[-1] if ids else None


def _has_data(rid: str, name: str) -> bool:
    return name in set(vsp.GetAllDataNames(rid))


def _mass_overlay(analysis: str, result_id: str | None) -> dict:
    rid = _find_result(RESULT_FOR[analysis], result_id)
    if rid is None:
        return _empty(analysis, "Run MassProp to see the centre of gravity.")
    items: list[dict] = []
    if _has_data(rid, "Total_CG"):
        cgs = vsp.GetVec3dResults(rid, "Total_CG", 0)
        if len(cgs):
            p = cgs[0]
            items.append({"kind": "marker", "position": [p.x(), p.y(), p.z()], "label": "CG", "color": "accent"})
    if _has_data(rid, "Comp_CG") and _has_data(rid, "Comp_Name"):
        names = [str(n) for n in vsp.GetStringResults(rid, "Comp_Name", 0)]
        for name, p in zip(names, vsp.GetVec3dResults(rid, "Comp_CG", 0)):
            items.append({"kind": "marker", "position": [p.x(), p.y(), p.z()], "label": name,
                          "color": "green", "size": "small"})
    if not items:
        return _empty(analysis, "MassProp has no centre-of-gravity data.")
    return {"analysis": analysis, "title": "MassProp · centre of gravity", "items": items}


# --- RPC methods ----------------------------------------------------------------------------

@method("overlay.get")
def overlay_get(analysis: str, resultId: str | None = None) -> dict:
    if analysis in VSPAERO_RUNS:
        return _vspaero_overlay(analysis)
    if analysis == "MassProp":
        return _mass_overlay(analysis, resultId)
    if analysis == "CpSlicer":
        return _cpslice_overlay(analysis)
    if analysis == "CompGeom":
        return _empty(analysis, "Wetted mesh shown as MeshGeom component")
    if analysis == "VSPAEROComputeGeometry":
        return _empty(analysis, "Geometry prepared for VSPAERO. Run VSPAEROSweep to see loads.")
    return _empty(analysis, f"No 3D visualization for {analysis}")


@method("overlay.prepare")
def overlay_prepare(analysis: str) -> dict:
    """Called by the UI right before a run starts: remembers where the files will appear."""
    base = _model_base()
    _run_state.update(base=base, since=time.time(), analysis=analysis)
    return {"base": base}


@method("overlay.progress", concurrent=True)
def overlay_progress(analysis: str) -> dict:
    """Live state of a running VSPAERO analysis, from its files only (no vsp calls)."""
    out: dict = {"analysis": analysis, "iteration": 0, "caseIndex": 0, "rows": []}
    base = _run_state["base"]
    if not base or analysis not in VSPAERO_RUNS:
        return out
    fresh_after = _run_state["since"] - 1.0

    hist_path = base + ".history"
    mt = _mtime(hist_path)
    if mt is not None and mt >= fresh_after:
        text = _read_text(hist_path)
        if text:
            cases, rows = _parse_history(text)
            out["caseIndex"] = cases
            if rows:
                out["iteration"] = int(rows[-1].get("Iter", 0))
            out["rows"] = [
                {k: r[k] for k in ("Case", "Iter", "CLtot", "CDtot", "L2 Residual") if k in r}
                for r in rows[-HISTORY_TAIL:]
            ]

    lod_path = base + ".lod"
    mt = _mtime(lod_path)
    if mt is not None and mt >= fresh_after:
        text = _read_text(lod_path)
        blocks = _parse_lod(text) if text else []
        if blocks and blocks[-1]["rows"]:
            recs = _strip_records(blocks[-1])
            if recs:
                out["strips"] = _strips_item(_geometry(recs))
    return out
