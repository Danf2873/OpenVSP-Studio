"""Cross-section (XSec) API: backs the Cross-Section Editor (docs/API.md "xsec.*").

Findings (OpenVSP 3.54 Python API, verified against the bundled build):

* ComputeXSecPnt(xs, fract) returns GLOBAL 3D coordinates on the section curve
  (fract 0..1 traces a closed loop). The section lies in a plane at the station.
* Local 2D frame used here, per section: the plane normal is the Newell normal of
  the sampled loop. Then
    - fuselage-like sections (normal ~ X):  u = +Y (width), v = +Z (height)
    - wing-like sections (normal ~ Y):      u = +X (chord), v = +Z (thickness)
    - vertical-tail-like (normal ~ Z):      u = +X, v = +Y
  The 2D profile is centred on the midpoint of its own bounding box.
  This matches OpenVSP's local edit-curve frame: GetEditXSecCtrlVec(xs, False)
  returns control points in the same frame (checked on FUSELAGE and WING).
  Twist rotates a section in OpenVSP's local frame but not in this one, so a
  twisted section's profile is not rotated to match its edit-curve points.
* Edit-curve points: GetEditXSecCtrlVec(xs, True) is unit-scaled (divided by
  width / height); the non-dimensional=False variant is already scaled. SetEditXSecPnts
  takes unit-scaled points, so setEditCurve divides by (width, height).
* ChangeXSecShape(..., XS_EDIT_CURVE) keeps the current profile as the edit curve.
* InsertXSec(geom, index, type) inserts AFTER index: the new section is at index+1.
* Wing planform parms (Span, Root_Chord, Sweep, ...) live in the XSec container
  (GetXSecParmIDs), so they are returned in `groups` with the rest.
* OpenVSP has no DeleteXSec. delete and cut both call CutXSec, which also
  overwrites the XSec clipboard.
* Insert/cut/copy/paste take no surface argument, so this module accepts only surf 0
  for them and raises RpcError otherwise.
* Errors are not raised by the Python binding. They sit in
  vsp.ErrorMgrSingleton.getInstance(), so mutations drain that queue and raise.
"""
from __future__ import annotations

import math
import os

from engine.vspctx import vsp, VSP_ROOT
from engine.registry import method, RpcError
from engine.parmutil import group_parms

PROFILE_PTS = 200
THUMB_PTS = 48

SHAPE_NAMES = {
    vsp.XS_POINT: "Point",
    vsp.XS_CIRCLE: "Circle",
    vsp.XS_ELLIPSE: "Ellipse",
    vsp.XS_SUPER_ELLIPSE: "Super Ellipse",
    vsp.XS_ROUNDED_RECTANGLE: "Rounded Rectangle",
    vsp.XS_GENERAL_FUSE: "General Fuselage",
    vsp.XS_FILE_FUSE: "File (Fuselage)",
    vsp.XS_FOUR_SERIES: "NACA 4-Series",
    vsp.XS_SIX_SERIES: "NACA 6-Series",
    vsp.XS_BICONVEX: "Biconvex",
    vsp.XS_WEDGE: "Wedge",
    vsp.XS_EDIT_CURVE: "Edit Curve",
    vsp.XS_FILE_AIRFOIL: "File Airfoil",
    vsp.XS_CST_AIRFOIL: "CST Airfoil",
    vsp.XS_VKT_AIRFOIL: "Von Kármán–Trefftz",
    vsp.XS_FOUR_DIGIT_MOD: "NACA 4-Digit Mod",
    vsp.XS_FIVE_DIGIT: "NACA 5-Digit",
    vsp.XS_FIVE_DIGIT_MOD: "NACA 5-Digit Mod",
    vsp.XS_ONE_SIX_SERIES: "NACA 16-Series",
    vsp.XS_AC25_773: "AC 25-773",
}

# Shapes drawn from the airfoil families. AC 25-773 is a fuselage (pilot
# compartment) section, so it is not included.
AIRFOIL_SHAPES = {
    vsp.XS_FOUR_SERIES, vsp.XS_SIX_SERIES, vsp.XS_BICONVEX, vsp.XS_WEDGE,
    vsp.XS_FILE_AIRFOIL, vsp.XS_CST_AIRFOIL, vsp.XS_VKT_AIRFOIL,
    vsp.XS_FOUR_DIGIT_MOD, vsp.XS_FIVE_DIGIT, vsp.XS_FIVE_DIGIT_MOD,
    vsp.XS_ONE_SIX_SERIES,
}

# Vehicle settings groups that drive each export format (io.exportOptions).
_EXPORT_SETTINGS_GROUPS = {
    "EXPORT_STEP": "STEPSettings", "EXPORT_STEP_STITCH": "STEPSettings",
    "EXPORT_STEP_STRUCTURE": "STEPSettings",
    "EXPORT_IGES": "IGESSettings", "EXPORT_IGES_STITCH": "IGESSettings",
    "EXPORT_IGES_STRUCTURE": "IGESSettings",
    "EXPORT_DXF": "DXFSettings", "EXPORT_SVG": "SVGSettings", "EXPORT_STL": "STLSettings",
}


# --- helpers ----------------------------------------------------------------------

def _errors():
    return vsp.ErrorMgrSingleton.getInstance()


def _drain_errors() -> list[str]:
    mgr = _errors()
    msgs = []
    while mgr.GetNumTotalErrors() > 0:
        msgs.append(mgr.PopLastError().GetErrorString())
    return msgs


def _raise_errors(context: str = "") -> None:
    msgs = _drain_errors()
    if msgs:
        raise RpcError((context + ": " if context else "") + "; ".join(msgs))


def _geom(geomId: str) -> None:
    if geomId not in set(vsp.FindGeoms()):
        raise RpcError(f"unknown geom {geomId}")


def _xsurf(geomId: str, surf: int) -> str:
    _geom(geomId)
    n = vsp.GetNumXSecSurfs(geomId)
    if not 0 <= surf < n:
        raise RpcError(f"surf {surf} out of range (geom has {n})")
    return vsp.GetXSecSurf(geomId, surf)


def _xs(geomId: str, surf: int, index: int):
    """Return (xsurf, xs, count) after validating the indices."""
    xsurf = _xsurf(geomId, surf)
    n = vsp.GetNumXSec(xsurf)
    if not 0 <= index < n:
        raise RpcError(f"xsec index {index} out of range (surf has {n})")
    return xsurf, vsp.GetXSec(xsurf, index), n


def _require_surf0(surf: int) -> None:
    if surf != 0:
        raise RpcError("insert/cut/copy/paste act on surface 0 only (OpenVSP API has no surf argument)")


def _check_shape(shape: int) -> int:
    if shape not in SHAPE_NAMES:
        raise RpcError(f"unknown xsec shape {shape}")
    return int(shape)


def _sample(xs: str, n: int) -> list[tuple[float, float, float]]:
    out = []
    for i in range(n):
        p = vsp.ComputeXSecPnt(xs, i / n)
        out.append((p.x(), p.y(), p.z()))
    return out


def _dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def _unit(a):
    m = math.sqrt(_dot(a, a))
    return (a[0] / m, a[1] / m, a[2] / m)


def _reject(a, n):
    """Remove the component of a along unit vector n."""
    d = _dot(a, n)
    return (a[0] - d * n[0], a[1] - d * n[1], a[2] - d * n[2])


def _plane_basis(pts):
    """Return (u, v) unit in-plane axes, or None if the loop is degenerate.

    The normal comes from the Newell formula, which needs no eigen solver.
    """
    n = len(pts)
    nx = ny = nz = 0.0
    for i in range(n):
        x0, y0, z0 = pts[i]
        x1, y1, z1 = pts[(i + 1) % n]
        nx += (y0 - y1) * (z0 + z1)
        ny += (z0 - z1) * (x0 + x1)
        nz += (x0 - x1) * (y0 + y1)
    m = math.sqrt(nx * nx + ny * ny + nz * nz)
    if m < 1e-12:
        return None
    nrm = (nx / m, ny / m, nz / m)
    ax, ay, az = abs(nrm[0]), abs(nrm[1]), abs(nrm[2])
    if ax >= ay and ax >= az:          # fuselage-like: plane normal ~ X
        uref, vref = (0.0, 1.0, 0.0), (0.0, 0.0, 1.0)
    elif ay >= az:                     # wing-like: plane normal ~ Y
        uref, vref = (1.0, 0.0, 0.0), (0.0, 0.0, 1.0)
    else:                              # vertical-tail-like: plane normal ~ Z
        uref, vref = (1.0, 0.0, 0.0), (0.0, 1.0, 0.0)
    u = _unit(_reject(uref, nrm))
    v = _unit(_reject(_reject(vref, nrm), u))
    return u, v


def _center(pts, basis):
    u, v = basis
    a = [_dot(p, u) for p in pts]
    b = [_dot(p, v) for p in pts]
    return ((min(a) + max(a)) / 2.0, (min(b) + max(b)) / 2.0)


def _to_2d(pts, basis, center):
    u, v = basis
    ca, cb = center
    return [[round(_dot(p, u) - ca, 9), round(_dot(p, v) - cb, 9)] for p in pts]


def _frame(xs: str, n: int):
    """Sample a section and return (basis, center) of its own frame (basis None if degenerate)."""
    pts = _sample(xs, n)
    basis = _plane_basis(pts)
    if basis is None:
        return None, None, pts
    center = _center(pts, basis)
    if vsp.GetXSecShape(xs) == vsp.XS_EDIT_CURVE:
        # Edit curves live in their own frame, not centred on the outline's box:
        # pin fract 0 (pts[0]) onto control point 0 so outline and points agree
        # after an asymmetric edit.
        ctrl = vsp.GetEditXSecCtrlVec(xs, True)
        if len(ctrl) > 0:
            u, v = basis
            w, h = vsp.GetXSecWidth(xs), vsp.GetXSecHeight(xs)
            center = (_dot(pts[0], u) - ctrl[0].x() * w, _dot(pts[0], v) - ctrl[0].y() * h)
    return basis, center, pts


def _local_profile(xs: str, n: int) -> list[list[float]]:
    basis, center, pts = _frame(xs, n)
    if basis is None:
        return [[0.0, 0.0] for _ in range(n)]
    return _to_2d(pts, basis, center)


def _neighbor_profile(xs: str, basis, center) -> list[list[float]] | None:
    """Neighbour profile in the current section's frame, so the two outlines overlay."""
    pts = _sample(xs, PROFILE_PTS)
    if basis is None:
        return [[0.0, 0.0] for _ in range(PROFILE_PTS)]
    return _to_2d(pts, basis, center)


def _sym_type(xs: str) -> int:
    for pid in vsp.GetXSecParmIDs(xs):
        if vsp.GetParmName(pid) == "SymType":
            return int(round(vsp.GetParmVal(pid)))
    return 0


def _groups(xs: str) -> list[dict]:
    return group_parms(list(vsp.GetXSecParmIDs(xs)))


def _shape_name(shape: int) -> str:
    return SHAPE_NAMES.get(shape, f"Shape {shape}")


def _thumb(xs: str) -> list[list[float]]:
    return _local_profile(xs, THUMB_PTS)


def _payload(geomId: str, surf: int, index: int) -> dict:
    xsurf, xs, n = _xs(geomId, surf, index)
    shape = vsp.GetXSecShape(xs)
    basis, center, pts = _frame(xs, PROFILE_PTS)
    if basis is None:
        profile = [[0.0, 0.0] for _ in range(PROFILE_PTS)]
    else:
        profile = _to_2d(pts, basis, center)

    neighbors = {}
    if index - 1 >= 0 and basis is not None:
        neighbors["prev"] = _neighbor_profile(vsp.GetXSec(xsurf, index - 1), basis, center)
    if index + 1 < n and basis is not None:
        neighbors["next"] = _neighbor_profile(vsp.GetXSec(xsurf, index + 1), basis, center)

    out = {
        "id": xs,
        "shape": shape,
        "shapeName": _shape_name(shape),
        "width": vsp.GetXSecWidth(xs),
        "height": vsp.GetXSecHeight(xs),
        "profile": profile,
        "neighbors": neighbors,
        "groups": _groups(xs),
        "isAirfoil": shape in AIRFOIL_SHAPES,
    }
    if shape == vsp.XS_EDIT_CURVE:
        # Unit-scaled control points (divided by width/height); the UI multiplies
        # by width/height to draw them. Cubic curves hold 3 points per segment.
        ctrl = vsp.GetEditXSecCtrlVec(xs, True)
        out["editCurve"] = {
            "points": [[p.x(), p.y()] for p in ctrl],
            "symmetric": _sym_type(xs),
            "curveType": _curve_type(xs),
            "closed": True,
        }
    return out


# --- read methods -------------------------------------------------------------------

@method("xsec.surfaces")
def surfaces(geomId: str) -> list[dict]:
    _geom(geomId)
    out = []
    for i in range(vsp.GetNumXSecSurfs(geomId)):
        out.append({"index": i, "numXSecs": vsp.GetNumXSec(vsp.GetXSecSurf(geomId, i))})
    return out


@method("xsec.list")
def list_xsecs(geomId: str, surf: int = 0) -> list[dict]:
    xsurf = _xsurf(geomId, surf)
    out = []
    for i in range(vsp.GetNumXSec(xsurf)):
        xs = vsp.GetXSec(xsurf, i)
        shape = vsp.GetXSecShape(xs)
        out.append({
            "index": i,
            "id": xs,
            "shape": shape,
            "shapeName": _shape_name(shape),
            "width": vsp.GetXSecWidth(xs),
            "height": vsp.GetXSecHeight(xs),
            "thumb": _thumb(xs),
        })
    return out


@method("xsec.get")
def get(geomId: str, surf: int = 0, index: int = 0) -> dict:
    return _payload(geomId, surf, index)


@method("xsec.airfoilLibrary")
def airfoil_library() -> list[dict]:
    root = os.path.join(VSP_ROOT, "airfoil")
    out = []
    if not os.path.isdir(root):
        return out
    for dirpath, _dirs, files in os.walk(root):
        for f in files:
            stem, ext = os.path.splitext(f)
            if ext.lower() in (".dat", ".af"):
                out.append({"name": stem, "path": os.path.join(dirpath, f)})
    out.sort(key=lambda d: d["name"].lower())
    return out


# --- mutations ----------------------------------------------------------------------

@method("xsec.setShape", mutates=True)
def set_shape(geomId: str, surf: int, index: int, shape: int) -> dict:
    xsurf, _xs_id, _n = _xs(geomId, surf, index)
    shape = _check_shape(shape)
    _drain_errors()
    vsp.ChangeXSecShape(xsurf, index, shape)
    vsp.Update()
    _raise_errors("setShape")
    return _payload(geomId, surf, index)


@method("xsec.insert", mutates=True)
def insert(geomId: str, surf: int, index: int, shape: int | None = None) -> dict:
    _require_surf0(surf)
    _xsurf_id, xs, _n = _xs(geomId, surf, index)
    shape = vsp.GetXSecShape(xs) if shape is None else _check_shape(shape)
    _drain_errors()
    vsp.InsertXSec(geomId, index, shape)   # inserts AFTER index
    vsp.Update()
    _raise_errors("insert")
    return {"index": index + 1}


@method("xsec.delete", mutates=True)
def delete(geomId: str, surf: int, index: int) -> None:
    _require_surf0(surf)
    _xs(geomId, surf, index)
    _drain_errors()
    vsp.CutXSec(geomId, index)   # OpenVSP has no DeleteXSec; this also fills the clipboard
    vsp.Update()
    _raise_errors("delete")
    return None


@method("xsec.cut", mutates=True)
def cut(geomId: str, surf: int, index: int) -> None:
    return delete(geomId, surf, index)


@method("xsec.copy")
def copy(geomId: str, surf: int, index: int) -> None:
    _require_surf0(surf)
    _xs(geomId, surf, index)
    _drain_errors()
    vsp.CopyXSec(geomId, index)
    _raise_errors("copy")
    return None


@method("xsec.paste", mutates=True)
def paste(geomId: str, surf: int, index: int) -> None:
    _require_surf0(surf)
    _xs(geomId, surf, index)
    _drain_errors()
    vsp.PasteXSec(geomId, index)
    vsp.Update()
    _raise_errors("paste")
    return None


@method("xsec.convertToEditCurve", mutates=True)
def convert_to_edit_curve(geomId: str, surf: int, index: int) -> dict:
    xsurf, xs, _n = _xs(geomId, surf, index)
    shape = vsp.GetXSecShape(xs)
    if shape != vsp.XS_EDIT_CURVE:
        _drain_errors()
        if shape in AIRFOIL_SHAPES:
            # ChangeXSecShape resets airfoils to a default curve (and ConvertXSecToEdit
            # rebuilds the whole geom), so refit the current outline as a cubic curve
            # through sampled anchors (CEDIT, so Add Point / split keep working).
            w, h = vsp.GetXSecWidth(xs), vsp.GetXSecHeight(xs)
            samples = _airfoil_samples(xs, AIRFOIL_EDIT_PTS)
            ctrl = _bezier_through(samples)
            vsp.ChangeXSecShape(xsurf, index, vsp.XS_EDIT_CURVE)
            xs = vsp.GetXSec(xsurf, index)
            _set_xsec_parm(xs, "SymType", 0)
            _set_xsec_parm(xs, "CurveType", vsp.CEDIT)
            _set_xsec_parm(xs, "Width", w)
            _set_xsec_parm(xs, "Height", h)
            m = len(ctrl) - 1
            pts = [vsp.vec3d(x / w, y / h, 0.0) for x, y in ctrl]
            vsp.SetEditXSecPnts(xs, [i / m for i in range(m + 1)], pts, [0.0] * (m + 1))
        else:
            # ChangeXSecShape to XS_EDIT_CURVE keeps the current profile (checked for FUSELAGE).
            vsp.ChangeXSecShape(xsurf, index, vsp.XS_EDIT_CURVE)
        vsp.Update()
        _raise_errors("convertToEditCurve")
    return _payload(geomId, surf, index)


AIRFOIL_EDIT_PTS = 24  # even, so the leading edge (fract 0.5) is a sample


def _bezier_through(anchors: list[list[float]]) -> list[list[float]]:
    """Closed cubic Bezier (anchor, handle, handle, anchor, ...) through the anchors.

    Handles follow the neighbour direction, scaled by each segment's length so
    uneven spacing does not overshoot. Anchor 0 (the trailing edge) keeps a corner.
    """
    n = len(anchors)

    def sub(a, b):
        return (a[0] - b[0], a[1] - b[1])

    def tangent(i):
        if i == 0:
            return None
        d = sub(anchors[(i + 1) % n], anchors[i - 1])
        L = math.hypot(*d) or 1.0
        return (d[0] / L, d[1] / L)

    out = []
    for i in range(n):
        p, q = anchors[i], anchors[(i + 1) % n]
        seg = math.hypot(*sub(q, p))
        tp, tq = tangent(i), tangent((i + 1) % n)
        h1 = [p[0] + (tp[0] * seg / 3 if tp else (q[0] - p[0]) / 3), p[1] + (tp[1] * seg / 3 if tp else (q[1] - p[1]) / 3)]
        h2 = [q[0] - (tq[0] * seg / 3 if tq else (q[0] - p[0]) / 3), q[1] - (tq[1] * seg / 3 if tq else (q[1] - p[1]) / 3)]
        out += [list(p), h1, h2]
    out.append(list(anchors[0]))
    return out


def _airfoil_samples(xs: str, n: int) -> list[list[float]]:
    """Section-local outline, clustered at the trailing (0) and leading (0.5) edges."""
    basis, center, _pts = _frame(xs, PROFILE_PTS)
    if basis is None:
        return [[0.0, 0.0] for _ in range(n)]
    out = []
    for i in range(n):
        t = i / n
        f = t - 0.8 * math.sin(4 * math.pi * t) / (4 * math.pi)
        p = vsp.ComputeXSecPnt(xs, f)
        out.append(_to_2d([(p.x(), p.y(), p.z())], basis, center)[0])
    return out


def _curve_type(xs: str) -> int:
    """vsp.LINEAR (0), vsp.PCHIP (1) or vsp.CEDIT (2, cubic Bezier: anchor, handle, handle, anchor...)."""
    for pid in vsp.GetXSecParmIDs(xs):
        if vsp.GetParmName(pid) == "CurveType":
            return int(round(vsp.GetParmVal(pid)))
    return vsp.CEDIT


def _set_xsec_parm(xs: str, name: str, value: float) -> None:
    for pid in vsp.GetXSecParmIDs(xs):
        if vsp.GetParmName(pid) == name:
            vsp.SetParmVal(pid, value)
            return


def _edit_xs(geomId: str, surf: int, index: int) -> str:
    _xsurf_id, xs, _n = _xs(geomId, surf, index)
    if vsp.GetXSecShape(xs) != vsp.XS_EDIT_CURVE:
        raise RpcError("section is not an edit curve; convertToEditCurve first")
    return xs


@method("xsec.setEditCurve", mutates=True)
def set_edit_curve(geomId: str, surf: int, index: int, points: list) -> dict:
    """Points are unit-scaled [u, v] (as in the editCurve payload).

    When the point count is unchanged (a drag), only the moved points go through
    MoveEditXSecPnt, so OpenVSP keeps the curve type and its symmetry. A
    different count replaces the whole curve and switches symmetry off, since
    the list then fully defines the shape.
    """
    xs = _edit_xs(geomId, surf, index)
    pts = [(float(p[0]), float(p[1])) for p in points]
    n = len(pts)
    if n < 3:
        raise RpcError("edit curve needs at least 3 points")
    current = [(p.x(), p.y()) for p in vsp.GetEditXSecCtrlVec(xs, True)]
    _drain_errors()
    if len(current) == n:
        for i, (x, y) in enumerate(pts):
            cx, cy = current[i]
            if abs(cx - x) > 1e-12 or abs(cy - y) > 1e-12:
                vsp.MoveEditXSecPnt(xs, i, vsp.vec3d(x, y, 0.0))
    else:
        u_vec = [i / (n - 1) for i in range(n)]
        _set_xsec_parm(xs, "SymType", vsp.SYM_NONE)
        vsp.SetEditXSecPnts(xs, u_vec, [vsp.vec3d(x, y, 0.0) for x, y in pts], [0.0] * n)
    vsp.Update()
    _raise_errors("setEditCurve")
    return _payload(geomId, surf, index)


@method("xsec.splitEditCurve", mutates=True)
def split_edit_curve(geomId: str, surf: int, index: int, u: float) -> dict:
    """Add a point on the curve at parameter u (0..1) without changing its shape.

    Uses OpenVSP's own split (keeps cubic segments and symmetry). A split on the
    mirrored side of a symmetric curve is ignored by OpenVSP, so it is retried
    at the mirrored parameter positions.
    """
    xs = _edit_xs(geomId, surf, index)
    u = min(max(float(u), 0.0), 1.0)
    before = len(vsp.GetEditXSecUVec(xs))
    _drain_errors()
    for cand in (u, 1.0 - u, (0.5 - u) % 1.0, (u + 0.5) % 1.0):
        if cand <= 1e-6 or cand >= 1.0 - 1e-6:
            continue
        vsp.EditXSecSplit01(xs, cand)
        vsp.Update()
        if len(vsp.GetEditXSecUVec(xs)) != before:
            break
    _drain_errors()
    return _payload(geomId, surf, index)


@method("xsec.deleteEditPoint", mutates=True)
def delete_edit_point(geomId: str, surf: int, index: int, point: int) -> dict:
    """Remove a point. On cubic curves an anchor is removed with its two handles."""
    xs = _edit_xs(geomId, surf, index)
    pts = [(p.x(), p.y()) for p in vsp.GetEditXSecCtrlVec(xs, True)]
    u = list(vsp.GetEditXSecUVec(xs))
    n = len(pts)
    point = int(point)
    if point < 0 or point >= n:
        raise RpcError("no such point")
    if point == n - 1:
        point = 0
    if _curve_type(xs) == vsp.CEDIT:
        if point % 3 != 0:
            raise RpcError("Only anchor points can be deleted; handles belong to an anchor")
        if n - 3 < 7:
            raise RpcError("A curve needs at least three anchor points")
        if point == 0:
            # Remove the start anchor with its two handles, then close on the next anchor.
            keep = list(range(2, n - 2))
            new_pts = [pts[i] for i in keep] + [pts[2]]
            new_u = [u[i] for i in keep] + [1.0]
        else:
            drop = {point - 1, point, point + 1}
            new_pts = [q for i, q in enumerate(pts) if i not in drop]
            new_u = [x for i, x in enumerate(u) if i not in drop]
    else:
        if n - 1 < 4:
            raise RpcError("A curve needs at least three points")
        if point == 0:
            new_pts = pts[1:-1] + [pts[1]]
            new_u = u[1:-1] + [1.0]
        else:
            new_pts = pts[:point] + pts[point + 1:]
            new_u = u[:point] + u[point + 1:]
    lo, hi = new_u[0], new_u[-1]
    span = (hi - lo) or 1.0
    new_u = [(x - lo) / span for x in new_u]
    _drain_errors()
    _set_xsec_parm(xs, "SymType", vsp.SYM_NONE)
    vsp.SetEditXSecPnts(xs, new_u, [vsp.vec3d(x, y, 0.0) for x, y in new_pts], [0.0] * len(new_pts))
    vsp.Update()
    _raise_errors("deleteEditPoint")
    return _payload(geomId, surf, index)


@method("xsec.setEditSymmetry", mutates=True)
def set_edit_symmetry(geomId: str, surf: int, index: int, mirrorX: bool, mirrorY: bool) -> dict:
    """mirrorX = left/right symmetry (SYM_RL), mirrorY = top/bottom (SYM_TB)."""
    xs = _edit_xs(geomId, surf, index)
    sym = (vsp.SYM_RL if mirrorX else 0) | (vsp.SYM_TB if mirrorY else 0)
    _set_xsec_parm(xs, "SymType", sym)
    vsp.Update()
    return _payload(geomId, surf, index)


@method("xsec.loadAirfoil", mutates=True)
def load_airfoil(geomId: str, surf: int, index: int, path: str) -> dict:
    xsurf, xs, _n = _xs(geomId, surf, index)
    if not os.path.isfile(path):
        raise RpcError(f"airfoil file not found: {path}")
    geom_type = str(vsp.GetGeomTypeName(geomId)).lower()
    is_airfoil_geom = vsp.GetXSecShape(xs) in AIRFOIL_SHAPES or "wing" in geom_type or "tail" in geom_type
    _drain_errors()
    if is_airfoil_geom:
        vsp.ChangeXSecShape(xsurf, index, vsp.XS_FILE_AIRFOIL)
        vsp.Update()
        vsp.ReadFileAirfoil(vsp.GetXSec(xsurf, index), path)
    else:
        vsp.ChangeXSecShape(xsurf, index, vsp.XS_FILE_FUSE)
        vsp.Update()
        vsp.ReadFileXSec(vsp.GetXSec(xsurf, index), path)
    vsp.Update()
    _raise_errors("loadAirfoil")
    return _payload(geomId, surf, index)
