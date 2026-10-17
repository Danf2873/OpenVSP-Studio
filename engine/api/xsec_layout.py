"""Section layout along a component: backs the section map in the Cross-Section Editor.

Every section has a position along the component (docs/API.md "xsec.layout"):

* FUSELAGE: XLocPercent * Length (OpenVSP clamps it between the neighbours;
  the nose and tail are fixed at 0 and 1).
* STACK: running sum of XDelta (each section is offset from the previous one).
* WING: running sum of Span (section 0 is the root, at 0).
* PROP: RadiusFrac (0..1 of the radius).
* Anything else: the index, and sections cannot be moved here.

Findings (OpenVSP 3.54):
* InsertXSec(geom, i, shape) puts a copy of section i after it. On a FUSELAGE the copy
  sits halfway to the next section; on a WING it is appended after section i with
  Span 1 and the segment i..i+1 is not split, and InsertXSec(wing, 0) is ignored.
  insertAt therefore splits wing segments itself (CopyXSec / PasteXSec + spans).
* ComputeXSecPnt returns global points, so outlines come from it directly
  (CompVecPnt01 u is not uniform per section on wings and props).
"""
from __future__ import annotations

from engine.vspctx import vsp
from engine.registry import method, RpcError
from engine.api.xsec import _drain_errors, _raise_errors, _require_surf0, _sample, _xsurf

KINDS = {"Fuselage": "fuselage", "Stack": "stack", "Wing": "wing", "Propeller": "prop"}
OUTLINE_PTS = 32
EPS = 1e-4


# ---------- parm helpers ----------

def _pid(xs: str, name: str) -> str | None:
    for p in vsp.GetXSecParmIDs(xs):
        if vsp.GetParmName(p) == name:
            return p
    return None


def _get(xs: str, name: str, default: float = 0.0) -> float:
    p = _pid(xs, name)
    return vsp.GetParmVal(p) if p else default


def _set(xs: str, name: str, value: float) -> None:
    p = _pid(xs, name)
    if p:
        vsp.SetParmVal(p, float(value))


def _kind(geomId: str) -> str:
    return KINDS.get(vsp.GetGeomTypeName(geomId), "other")


def _length(geomId: str) -> float:
    return vsp.GetParmVal(geomId, "Length", "Design") or 1.0


def _sections(geomId: str, surf: int) -> list[str]:
    xsurf = _xsurf(geomId, surf)
    return [vsp.GetXSec(xsurf, i) for i in range(vsp.GetNumXSec(xsurf))]


def _positions(geomId: str, kind: str, xss: list[str]) -> list[float]:
    if kind == "fuselage":
        L = _length(geomId)
        return [_get(xs, "XLocPercent") * L for xs in xss]
    if kind == "prop":
        return [_get(xs, "RadiusFrac") for xs in xss]
    if kind in ("stack", "wing"):
        key = "XDelta" if kind == "stack" else "Span"
        out, acc = [], 0.0
        for i, xs in enumerate(xss):
            if i > 0 or kind == "stack":
                acc += _get(xs, key)
            out.append(acc)
        return out
    return [float(i) for i in range(len(xss))]


def _side_extent(kind: str, xs: str) -> tuple[float, float]:
    """Outline extent across the map: Z (side view) for bodies, X (chord) for wings and props."""
    pts = _sample(xs, OUTLINE_PTS)
    k = 0 if kind in ("wing", "prop") else 2
    vals = [p[k] for p in pts]
    return min(vals), max(vals)


def _layout(geomId: str, surf: int) -> dict:
    kind = _kind(geomId)
    xss = _sections(geomId, surf)
    pos = _positions(geomId, kind, xss)
    n = len(xss)
    stations = []
    for i, xs in enumerate(xss):
        lo, hi = (pos[i - 1] if i > 0 else pos[i]), (pos[i + 1] if i + 1 < n else None)
        if kind in ("fuselage", "prop"):
            fixed = i == 0 or i == n - 1
            hi = pos[i + 1] if i + 1 < n else pos[i]
        elif kind in ("stack", "wing"):
            fixed = i == 0
        else:
            fixed = True
        bottom, top = _side_extent(kind, xs)
        stations.append({"index": i, "pos": pos[i], "lo": lo, "hi": hi, "fixed": fixed,
                         "top": top, "bottom": bottom})
    labels = {
        "fuselage": ("Length", "Side view"), "stack": ("Length", "Side view"),
        "wing": ("Span", "Planform"), "prop": ("Radius fraction", "Blade"),
    }
    axis, view = labels.get(kind, ("Section", "Sections"))
    return {"kind": kind, "axisLabel": axis, "viewLabel": view,
            "canInsert": kind != "other", "stations": stations}


# ---------- moving ----------

def _place(geomId: str, kind: str, xss: list[str], old: list[float], i: int, p: float) -> None:
    """Put section i at position p and keep every later section where it was."""
    if kind == "fuselage":
        _set(xss[i], "XLocPercent", p / _length(geomId))
    elif kind == "prop":
        _set(xss[i], "RadiusFrac", p)
    else:
        key = "XDelta" if kind == "stack" else "Span"
        _set(xss[i], key, p - old[i - 1])
        if i + 1 < len(xss):
            _set(xss[i + 1], key, old[i + 1] - p)


def _clamp_move(st: dict, p: float) -> float:
    lo = st["lo"] + EPS
    hi = st["hi"] - EPS if st["hi"] is not None else float("inf")
    return min(max(p, lo), hi)


@method("xsec.layout")
def layout(geomId: str, surf: int = 0) -> dict:
    return _layout(geomId, int(surf))


@method("xsec.moveTo", mutates=True)
def move_to(geomId: str, surf: int, index: int, pos: float) -> dict:
    surf, index = int(surf), int(index)
    lay = _layout(geomId, surf)
    if not 0 <= index < len(lay["stations"]):
        raise RpcError(f"xsec index {index} out of range")
    st = lay["stations"][index]
    if st["fixed"]:
        raise RpcError("this section's position is fixed")
    xss = _sections(geomId, surf)
    old = [s["pos"] for s in lay["stations"]]
    _drain_errors()
    _place(geomId, lay["kind"], xss, old, index, _clamp_move(st, float(pos)))
    vsp.Update()
    _raise_errors("moveTo")
    return _layout(geomId, surf)


# ---------- inserting ----------

def _lerp(a: float, b: float, t: float) -> float:
    return a + (b - a) * t


def _blend_body(new: str, prev: str, nxt: str, t: float) -> None:
    """Size and offset of an inserted body section, between its neighbours."""
    w = _lerp(vsp.GetXSecWidth(prev), vsp.GetXSecWidth(nxt), t)
    h = _lerp(vsp.GetXSecHeight(prev), vsp.GetXSecHeight(nxt), t)
    vsp.SetXSecWidthHeight(new, max(w, 1e-6), max(h, 1e-6))
    for name in ("YLocPercent", "ZLocPercent", "YDelta", "ZDelta", "XRotate", "YRotate", "ZRotate"):
        if _pid(new, name):
            _set(new, name, _lerp(_get(prev, name), _get(nxt, name), t))


def _insert_body(geomId: str, kind: str, xss, pos, p: float) -> int:
    n = len(xss)
    if kind == "stack" and p > pos[-1]:
        i = n - 1
    else:
        i = next((k for k in range(n - 1) if pos[k] < p < pos[k + 1]), None)
        if i is None:
            raise RpcError("pick a spot between two sections")
    # A point nose/tail would make a point copy; take the shape of the bigger neighbour.
    src = xss[i + 1] if i + 1 < n and vsp.GetXSecShape(xss[i]) == vsp.XS_POINT else xss[i]
    vsp.InsertXSec(geomId, i, vsp.GetXSecShape(src))
    vsp.Update()
    new_xss = _sections(geomId, 0)
    new = new_xss[i + 1]
    if kind == "fuselage":
        _set(new, "XLocPercent", p / _length(geomId))
    elif kind == "prop":
        _set(new, "RadiusFrac", p)
    else:  # stack: offsets stay relative, so the following section keeps its place
        _set(new, "XDelta", p - pos[i])
        if i + 2 < len(new_xss):
            _set(new_xss[i + 2], "XDelta", pos[i + 1] - p)
    if i + 1 < n:
        t = (p - pos[i]) / ((pos[i + 1] - pos[i]) or 1.0)
        _blend_body(new, new_xss[i], new_xss[i + 2], t)
    return i + 1


# Planform parms restored after a wing insert (derived ones such as Area or Taper
# follow from these) plus every parm of the airfoil curve.
WING_PLAN = ("Span", "Sweep", "Sweep_Location", "Sec_Sweep_Location", "Dihedral",
             "Twist", "Twist_Location")


def _snapshot(xs: str) -> dict:
    vals = {name: _get(xs, name) for name in WING_PLAN + ("Root_Chord", "Tip_Chord") if _pid(xs, name)}
    curve = {vsp.GetParmName(p): vsp.GetParmVal(p) for p in vsp.GetXSecParmIDs(xs)
             if vsp.GetParmGroupName(p) == "XSecCurve"}
    return {"shape": vsp.GetXSecShape(xs), "plan": vals, "curve": curve}


def _restore_wing(geomId: str, snaps: list[dict]) -> None:
    """Write the snapshots back to sections 0..n-1, chords last and root-to-tip
    (a section's Root_Chord is linked to the previous Tip_Chord)."""
    xsurf = vsp.GetXSecSurf(geomId, 0)
    for j, snap in enumerate(snaps):
        if vsp.GetXSecShape(vsp.GetXSec(xsurf, j)) != snap["shape"]:
            vsp.ChangeXSecShape(xsurf, j, snap["shape"])
    vsp.Update()
    xss = _sections(geomId, 0)
    for xs, snap in zip(xss, snaps):
        for name, v in snap["curve"].items():
            _set(xs, name, v)
        for name, v in snap["plan"].items():
            if name not in ("Root_Chord", "Tip_Chord"):
                _set(xs, name, v)
    for xs, snap in zip(xss, snaps):
        if "Root_Chord" in snap["plan"]:
            _set(xs, "Root_Chord", snap["plan"]["Root_Chord"])
            _set(xs, "Tip_Chord", snap["plan"]["Tip_Chord"])


def _insert_wing(geomId: str, xss, pos, p: float) -> int:
    n = len(xss)
    if p <= 0:
        raise RpcError("pick a spot outboard of the root")
    snaps = [_snapshot(xs) for xs in xss]
    if p > pos[-1] - EPS:
        # Extend past the tip: a copy of the tip section with constant chord.
        k = n
        tip = snaps[-1]["plan"].get("Tip_Chord", 1.0)
        new = {"shape": snaps[-1]["shape"], "curve": dict(snaps[-1]["curve"]),
               "plan": dict(snaps[-1]["plan"], Span=p - pos[-1], Root_Chord=tip, Tip_Chord=tip)}
        snaps.insert(k, new)
    else:
        k = next(j for j in range(1, n) if pos[j - 1] < p < pos[j] + EPS)
        t = (p - pos[k - 1]) / (pos[k] - pos[k - 1])
        cur = snaps[k]
        root, tip = cur["plan"]["Root_Chord"], cur["plan"]["Tip_Chord"]
        mid = _lerp(root, tip, t)
        prev_twist = snaps[k - 1]["plan"].get("Twist", 0.0) if k > 1 else snaps[0]["plan"].get("Twist", 0.0)
        inner = {"shape": cur["shape"], "curve": dict(cur["curve"]),
                 "plan": dict(cur["plan"], Span=cur["plan"]["Span"] * t, Tip_Chord=mid,
                              Twist=_lerp(prev_twist, cur["plan"].get("Twist", 0.0), t))}
        cur["plan"] = dict(cur["plan"], Span=cur["plan"]["Span"] * (1 - t), Root_Chord=mid)
        snaps.insert(k, inner)
    vsp.InsertXSec(geomId, n - 1, snaps[-1]["shape"])   # only the count matters; all values are rewritten
    vsp.Update()
    if len(_sections(geomId, 0)) != len(snaps):
        raise RpcError("OpenVSP did not add a section")
    _restore_wing(geomId, snaps)
    return k


@method("xsec.insertAt", mutates=True)
def insert_at(geomId: str, surf: int, pos: float) -> dict:
    surf = int(surf)
    _require_surf0(surf)
    lay = _layout(geomId, surf)
    if not lay["canInsert"]:
        raise RpcError("use Insert after / before for this component type")
    xss = _sections(geomId, surf)
    old = [s["pos"] for s in lay["stations"]]
    p = float(pos)
    _drain_errors()
    if lay["kind"] == "wing":
        index = _insert_wing(geomId, xss, old, p)
    else:
        index = _insert_body(geomId, lay["kind"], xss, old, p)
    vsp.Update()
    _raise_errors("insertAt")
    return {"index": index, "layout": _layout(geomId, surf)}
