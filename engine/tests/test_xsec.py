"""Tests for engine/api/xsec.py.

engine/api/__init__.py eagerly imports every api module, so importing one of them
through the package could fail while other workers' modules are still missing.
The stub below registers the package path without running that __init__.
"""
import os
import sys
import types

import pytest

from engine.vspctx import vsp, VSP_ROOT
from engine.registry import RpcError

if "engine.api" not in sys.modules:
    _pkg = types.ModuleType("engine.api")
    _pkg.__path__ = [os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "api")]
    sys.modules["engine.api"] = _pkg

import engine.api.xsec  # noqa: E402,F401  (registers xsec.* methods)


def _profile_diff(a, b):
    return max(max(abs(p[0] - q[0]), abs(p[1] - q[1])) for p, q in zip(a, b))


def _fuselage():
    g = vsp.AddGeom("FUSELAGE")
    vsp.Update()
    return g


def test_fuselage_list_and_get(rpc):
    g = _fuselage()
    surfs = rpc("xsec.surfaces", geomId=g)
    assert surfs == [{"index": 0, "numXSecs": 5}]

    items = rpc("xsec.list", geomId=g, surf=0)
    assert len(items) == 5
    assert all(len(it["thumb"]) == 48 for it in items)
    assert items[1]["shapeName"] == "Ellipse"

    xs = rpc("xsec.get", geomId=g, surf=0, index=2)
    assert len(xs["profile"]) == 200
    assert xs["isAirfoil"] is False
    assert "prev" in xs["neighbors"] and "next" in xs["neighbors"]
    assert len(xs["neighbors"]["prev"]) == 200
    assert xs["groups"], "expected parm groups for the section"
    # Ellipse section at station 2 is 2.5 wide and 3.0 high, centred on the origin.
    us = [p[0] for p in xs["profile"]]
    vs = [p[1] for p in xs["profile"]]
    assert max(us) - min(us) == pytest.approx(2.5, abs=0.02)
    assert max(vs) - min(vs) == pytest.approx(3.0, abs=0.02)
    assert abs((max(us) + min(us)) / 2) < 1e-3 and abs((max(vs) + min(vs)) / 2) < 1e-3


def test_insert_and_delete(rpc):
    g = _fuselage()
    ret = rpc("xsec.insert", geomId=g, surf=0, index=1, shape=vsp.XS_SUPER_ELLIPSE)
    assert ret == {"index": 2}   # inserts AFTER index
    xsurf = vsp.GetXSecSurf(g, 0)
    assert vsp.GetNumXSec(xsurf) == 6
    assert vsp.GetXSecShape(vsp.GetXSec(xsurf, 2)) == vsp.XS_SUPER_ELLIPSE

    rpc("xsec.delete", geomId=g, surf=0, index=2)
    assert vsp.GetNumXSec(vsp.GetXSecSurf(g, 0)) == 5


def test_insert_rejects_other_surfaces(rpc):
    g = _fuselage()
    with pytest.raises(RpcError):
        rpc("xsec.insert", geomId=g, surf=1, index=1)


def test_set_shape_super_ellipse(rpc):
    g = _fuselage()
    before = rpc("xsec.get", geomId=g, surf=0, index=2)
    after = rpc("xsec.setShape", geomId=g, surf=0, index=2, shape=vsp.XS_SUPER_ELLIPSE)
    assert after["shapeName"] == "Super Ellipse"
    assert after["shape"] == vsp.XS_SUPER_ELLIPSE
    assert _profile_diff(before["profile"], after["profile"]) > 0.05


def test_wing_airfoil_and_planform_groups(rpc):
    w = vsp.AddGeom("WING")
    vsp.Update()
    xs = rpc("xsec.get", geomId=w, surf=0, index=0)
    assert xs["isAirfoil"] is True
    assert xs["shapeName"] == "NACA 4-Series"
    names = {p["name"] for grp in xs["groups"] for p in grp["parms"]}
    assert {"Span", "Root_Chord", "Sweep"} <= names
    # Wing root chord 4 in x, thickness 0.4 in z.
    us = [p[0] for p in xs["profile"]]
    vs = [p[1] for p in xs["profile"]]
    assert max(us) - min(us) == pytest.approx(4.0, abs=0.02)
    assert max(vs) - min(vs) == pytest.approx(0.4, abs=0.03)


def test_convert_and_set_edit_curve(rpc):
    g = _fuselage()
    before = rpc("xsec.get", geomId=g, surf=0, index=2)
    conv = rpc("xsec.convertToEditCurve", geomId=g, surf=0, index=2)
    assert conv["shape"] == vsp.XS_EDIT_CURVE
    assert conv["shapeName"] == "Edit Curve"
    assert conv["editCurve"]["closed"] is True
    assert _profile_diff(before["profile"], conv["profile"]) < 0.05
    pts = conv["editCurve"]["points"]
    assert len(pts) >= 3

    moved = [list(p) for p in pts]
    moved[3] = [moved[3][0], moved[3][1] * 1.2]   # push the bottom control point outwards
    after = rpc("xsec.setEditCurve", geomId=g, surf=0, index=2, points=moved)
    assert after["editCurve"]["points"][3][1] == pytest.approx(moved[3][1], abs=1e-6)
    assert len(after["editCurve"]["points"]) == len(pts)


def test_set_edit_curve_needs_edit_shape(rpc):
    g = _fuselage()
    with pytest.raises(RpcError):
        rpc("xsec.setEditCurve", geomId=g, surf=0, index=2, points=[[0, 0], [1, 0], [0, 1]])


def test_load_airfoil_from_library(rpc):
    lib = rpc("xsec.airfoilLibrary")
    assert lib, "expected .dat/.af files under VSP_ROOT/airfoil"
    assert all(os.path.isfile(item["path"]) for item in lib)
    assert all(item["path"].startswith(os.path.join(VSP_ROOT, "airfoil")) for item in lib)

    w = vsp.AddGeom("WING")
    vsp.Update()
    xs = rpc("xsec.loadAirfoil", geomId=w, surf=0, index=0, path=lib[0]["path"])
    assert xs["shape"] == vsp.XS_FILE_AIRFOIL
    assert xs["shapeName"] == "File Airfoil"
    assert xs["isAirfoil"] is True
    assert len(xs["profile"]) == 200


def test_load_airfoil_missing_file(rpc):
    w = vsp.AddGeom("WING")
    vsp.Update()
    with pytest.raises(RpcError):
        rpc("xsec.loadAirfoil", geomId=w, surf=0, index=0, path=os.path.join(VSP_ROOT, "nope.dat"))


def _edit_section(rpc):
    g = _fuselage()
    ref = dict(geomId=g, surf=0, index=2)
    rpc("xsec.convertToEditCurve", **ref)
    return ref


def test_split_keeps_shape_and_lands_on_profile(rpc):
    ref = _edit_section(rpc)
    rpc("xsec.setEditSymmetry", **ref, mirrorX=False, mirrorY=False)
    d = rpc("xsec.get", **ref)
    before = d["editCurve"]["points"]
    target = d["profile"][int(0.3 * len(d["profile"]))]
    after = rpc("xsec.splitEditCurve", **ref, u=0.3)
    pts = after["editCurve"]["points"]
    assert len(pts) == len(before) + 3  # cubic: anchor + two handles
    assert _profile_diff(d["profile"], after["profile"]) < 1e-6
    w, h = after["width"], after["height"]
    assert min(abs(p[0] * w - target[0]) + abs(p[1] * h - target[1]) for p in pts) < 1e-3


def test_split_on_symmetric_curve_adds_points(rpc):
    ref = _edit_section(rpc)
    n = len(rpc("xsec.get", **ref)["editCurve"]["points"])
    out = rpc("xsec.splitEditCurve", **ref, u=0.6)
    assert len(out["editCurve"]["points"]) > n


def test_delete_anchor_and_reject_handle(rpc):
    ref = _edit_section(rpc)
    rpc("xsec.setEditSymmetry", **ref, mirrorX=False, mirrorY=False)
    d = rpc("xsec.splitEditCurve", **ref, u=0.3)
    n = len(d["editCurve"]["points"])
    with pytest.raises(RpcError):
        rpc("xsec.deleteEditPoint", **ref, point=1)
    out = rpc("xsec.deleteEditPoint", **ref, point=3)
    assert len(out["editCurve"]["points"]) == n - 3


def test_set_edit_symmetry(rpc):
    ref = _edit_section(rpc)
    out = rpc("xsec.setEditSymmetry", **ref, mirrorX=True, mirrorY=False)
    assert out["editCurve"]["symmetric"] in (1, True)
    out = rpc("xsec.setEditSymmetry", **ref, mirrorX=False, mirrorY=False)
    assert out["editCurve"]["symmetric"] in (0, False)


def _outline_gap(a_pts, b_pts):
    """Largest distance from a point of a to the closed polyline b."""
    import math

    def seg(p, a, b):
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = dx * dx + dy * dy or 1e-30
        t = max(0.0, min(1.0, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L))
        return math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy)

    n = len(b_pts)
    return max(min(seg(p, b_pts[i], b_pts[(i + 1) % n]) for i in range(n)) for p in a_pts)


def test_convert_airfoil_keeps_shape_and_points_follow_outline(rpc):
    g = vsp.AddGeom("WING")
    vsp.Update()
    ref = dict(geomId=g, surf=0, index=1)
    before = rpc("xsec.get", **ref)
    out = rpc("xsec.convertToEditCurve", **ref)
    assert out["shapeName"] == "Edit Curve"
    assert out["editCurve"]["curveType"] == 2
    assert _outline_gap(before["profile"], out["profile"]) < 0.005 * before["height"]
    # Raise one upper anchor with its handles (as the UI does): every anchor must
    # still lie on the drawn outline.
    pts = [list(p) for p in out["editCurve"]["points"]]
    for k in (47, 48, 49):
        pts[k][1] += 0.3
    after = rpc("xsec.setEditCurve", **ref, points=pts)
    w, h = after["width"], after["height"]
    anchors = [(p[0] * w, p[1] * h) for i, p in enumerate(after["editCurve"]["points"]) if i % 3 == 0]
    assert _outline_gap(anchors, after["profile"]) < 0.005 * h
