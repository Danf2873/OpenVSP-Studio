"""Tests for engine/api/analysis.py and engine/api/io.py.

See test_xsec.py for why the engine.api package __init__ is bypassed.
"""
import os
import sys
import types

import pytest

from engine.vspctx import vsp
from engine import registry
from engine.registry import RpcError

if "engine.api" not in sys.modules:
    _pkg = types.ModuleType("engine.api")
    _pkg.__path__ = [os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "api")]
    sys.modules["engine.api"] = _pkg

import engine.api.analysis  # noqa: E402,F401
import engine.api.io  # noqa: E402,F401


def call(method_name, **params):
    """Like the rpc fixture, but avoids the fixture's own `name` parameter clashing with analysis params."""
    return registry.call(method_name, params)


def test_analysis_list_has_22():
    items = call("analysis.list")
    assert len(items) == 22
    names = {i["name"] for i in items}
    assert {"CompGeom", "MassProp", "VSPAEROSweep"} <= names
    assert all(i["group"] in {"Geometry", "Aero", "Mesh", "Other"} for i in items)


def test_inputs_compgeom():
    inputs = {i["name"]: i for i in call("analysis.inputs", name="CompGeom")}
    assert inputs["HalfMeshFlag"]["type"] == "int"
    assert inputs["HalfMeshFlag"]["label"] == "Half mesh"
    assert inputs["HalfMeshFlag"]["options"][1]["label"] == "On"
    assert isinstance(inputs["HalfMeshFlag"]["value"], list)
    assert inputs["ModeID"]["type"] == "string"


def test_set_and_reset_input():
    call("analysis.setInput", name="CompGeom", input="HalfMeshFlag", value=[1])
    val = {i["name"]: i for i in call("analysis.inputs", name="CompGeom")}["HalfMeshFlag"]["value"]
    assert val == [1]
    call("analysis.reset", name="CompGeom")
    val = {i["name"]: i for i in call("analysis.inputs", name="CompGeom")}["HalfMeshFlag"]["value"]
    assert val == [0]


def test_run_compgeom_and_massprop_on_pod():
    vsp.AddGeom("POD")
    vsp.Update()
    run = call("analysis.run", name="CompGeom")
    assert run["resultId"]
    assert len(run["summary"]) <= 20
    res = call("results.get", id=run["resultId"])
    assert res["name"] == "Comp_Geom"
    assert res["data"], "expected result data entries"
    assert {d["type"] for d in res["data"]} <= {"int", "double", "string", "vec3d", "double_mat"}

    mp = call("analysis.run", name="MassProp")
    listed = call("results.list")
    ids = {r["id"] for r in listed}
    assert run["resultId"] in ids and mp["resultId"] in ids


def test_unknown_analysis_raises():
    with pytest.raises(RpcError):
        call("analysis.run", name="NoSuchAnalysis")


def test_results_export_csv(tmp_path):
    vsp.AddGeom("POD")
    vsp.Update()
    rid = call("analysis.run", name="CompGeom")["resultId"]
    out = tmp_path / "comp_geom.csv"
    call("results.exportCsv", id=rid, path=str(out))
    assert out.is_file() and out.stat().st_size > 0


def test_results_clear():
    vsp.AddGeom("POD")
    vsp.Update()
    call("analysis.run", name="CompGeom")
    call("results.clear")
    assert call("results.list") == []


def test_export_import_stl(tmp_path):
    vsp.AddGeom("POD")
    vsp.Update()
    out = tmp_path / "pod.stl"
    ret = call("io.export", path=str(out), format=vsp.EXPORT_STL)
    assert ret == {"path": str(out)}
    assert out.is_file() and out.stat().st_size > 0

    before = len(vsp.FindGeoms())
    state = call("io.import", path=str(out), format=vsp.IMPORT_STL)
    assert len(vsp.FindGeoms()) == before + 1
    assert len(state["geoms"]) == before + 1
    assert {"file", "dirty", "canUndo", "canRedo", "geoms"} <= set(state)


def test_export_options():
    stl = call("io.exportOptions", format=vsp.EXPORT_STL)
    assert [g["group"] for g in stl] == ["STLSettings"]
    assert stl[0]["parms"], "STL settings group should have parms"
    assert call("io.exportOptions", format=vsp.EXPORT_OBJ) == []


def test_import_missing_file():
    with pytest.raises(RpcError):
        call("io.import", path=os.path.join(os.path.dirname(__file__), "missing.stl"), format=vsp.IMPORT_STL)


def test_vspaero_sweep_small():
    """VSPAERO needs VSPAEROComputeGeometry first. Two alpha points on a wing take ~20 s."""
    vsp.AddGeom("WING")
    vsp.Update()
    call("analysis.run", name="VSPAEROComputeGeometry")
    call("analysis.setInput", name="VSPAEROSweep", input="AlphaStart", value=[0.0])
    call("analysis.setInput", name="VSPAEROSweep", input="AlphaEnd", value=[1.0])
    call("analysis.setInput", name="VSPAEROSweep", input="AlphaNpts", value=[2])
    run = call("analysis.run", name="VSPAEROSweep")
    assert run["resultId"]
    assert call("results.get", id=run["resultId"])["data"] is not None
