"""Tests for sets.*, vars.*, links.*, fea.*, subsurf.*, controlGroups.*,
measure.* and console.*."""
import os
import sys
import types

from engine.vspctx import vsp

# Importing engine.api.<mod> runs engine/api/__init__.py, which imports every
# sibling module (some of which may not exist yet). Load only our modules by
# installing a bare package object for the duration of the import.
_API_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "api")
_stub_installed = "engine.api" not in sys.modules
if _stub_installed:
    _pkg = types.ModuleType("engine.api")
    _pkg.__path__ = [os.path.abspath(_API_DIR)]
    sys.modules["engine.api"] = _pkg
try:
    import engine.api.sets  # noqa: F401
    import engine.api.vars  # noqa: F401
    import engine.api.links  # noqa: F401
    import engine.api.fea  # noqa: F401
    import engine.api.subsurf  # noqa: F401
    import engine.api.console  # noqa: F401
finally:
    if _stub_installed:
        sys.modules.pop("engine.api", None)

import pytest  # noqa: E402

from engine import registry  # noqa: E402
from engine.registry import RpcError  # noqa: E402


@pytest.fixture
def rpc():
    """Overrides conftest's `rpc` fixture. The conftest version is
    `lambda name, **params`, so a param literally named `name` (rename, addGroup,
    links.add, ...) collides with it. The method argument is positional-only here."""
    return lambda method, /, **params: registry.call(method, params)


def _wing_parms():
    w = vsp.AddGeom("WING")
    vsp.Update()
    span = vsp.FindParm(w, "TotalSpan", "WingGeom")
    xloc = vsp.FindParm(w, "X_Rel_Location", "XForm")
    return w, span, xloc


# --- sets ---------------------------------------------------------------------

def test_sets_list_and_rename(rpc):
    vsp.AddGeom("WING")
    sets = rpc("sets.list")
    assert len(sets) == vsp.GetNumSets()
    assert sets[0] == {"index": 0, "name": vsp.GetSetName(0)}
    assert rpc("sets.rename", index=5, name="Mine") is None
    assert rpc("sets.list")[5]["name"] == "Mine"
    assert vsp.GetSetName(5) == "Mine"


def test_sets_set_flag_and_matrix(rpc):
    a = vsp.AddGeom("WING")
    b = vsp.AddGeom("POD")
    vsp.Update()
    assert rpc("sets.setFlag", geomId=a, index=5, value=True) is None
    assert vsp.GetSetFlag(a, 5) is True
    matrix = rpc("sets.matrix")
    assert len(matrix["sets"]) == vsp.GetNumSets()
    rows = {r["geomId"]: r for r in matrix["rows"]}
    assert set(rows) == {a, b}
    assert rows[a]["flags"][5] is True
    assert rows[b]["flags"][5] is False
    assert rows[a]["name"] == vsp.GetGeomName(a)


def test_sets_show_only(rpc):
    a = vsp.AddGeom("WING")
    b = vsp.AddGeom("POD")
    vsp.Update()
    rpc("sets.setFlag", geomId=a, index=5, value=True)
    rpc("sets.showOnly", index=5)
    assert vsp.GetSetFlag(a, vsp.SET_SHOWN) is True
    assert vsp.GetSetFlag(b, vsp.SET_SHOWN) is False
    rpc("sets.hide", index=5)
    rpc("sets.show", index=5)


# --- vars ---------------------------------------------------------------------

def test_var_preset_apply_restores_value(rpc):
    w, span, _ = _wing_parms()
    vsp.SetParmVal(span, 10.0)
    vsp.Update()
    rpc("vars.addGroup", name="Span presets")
    group = [g for g in rpc("vars.presets")["groups"] if g["name"] == "Span presets"][0]
    gid = group["id"]
    rpc("vars.addParm", groupId=gid, parmId=span)
    rpc("vars.addSetting", groupId=gid, name="Ten")
    setting = [s for s in rpc("vars.presets")["groups"] if s["id"] == gid][0]["settings"][0]
    rpc("vars.saveSetting", settingId=setting["id"])

    vsp.SetParmVal(span, 3.0)
    vsp.Update()
    assert vsp.GetParmVal(span) == 3.0
    rpc("vars.applySetting", settingId=setting["id"])
    vsp.Update()
    assert vsp.GetParmVal(span) == 10.0

    presets = rpc("vars.presets")["groups"][0]
    assert presets["parms"][0]["id"] == span
    assert presets["parms"][0]["value"] == 10.0

    rpc("vars.deleteSetting", settingId=setting["id"])
    rpc("vars.deleteParm", groupId=gid, parmId=span)
    rpc("vars.deleteGroup", groupId=gid)
    assert rpc("vars.presets")["groups"] == []


def test_design_vars_write_and_read_des(rpc, tmp_path):
    w, span, xloc = _wing_parms()
    rpc("vars.addDesignVar", parmId=span, type="var")
    rpc("vars.addDesignVar", parmId=xloc, type="const")
    dvs = rpc("vars.designVars")
    assert [d["parm"]["id"] for d in dvs] == [span, xloc]
    assert [d["type"] for d in dvs] == ["var", "const"]

    path = str(tmp_path / "design.des")
    assert rpc("vars.writeDes", path=path) is None
    assert os.path.getsize(path) > 0
    rpc("vars.clearDesignVars")
    assert rpc("vars.designVars") == []
    rpc("vars.readDes", path=path)
    assert len(rpc("vars.designVars")) == 2


def test_user_parm_add(rpc):
    d = rpc("vars.addUserParm", type="double", name="myp", group="MyGrp")
    assert d["name"] == "myp"
    assert d["group"] == "MyGrp"
    assert d["type"] == "double"
    assert any(p["id"] == d["id"] for p in rpc("vars.userParms"))


# --- links --------------------------------------------------------------------

def test_advanced_link_drives_output(rpc):
    w, span, xloc = _wing_parms()
    rpc("links.add", name="Half")
    assert rpc("links.list") == [{"index": 0, "name": "Half"}]
    rpc("links.addInput", index=0, parmId=span, var="Span")
    rpc("links.addOutput", index=0, parmId=xloc, var="Xloc")
    rpc("links.setCode", index=0, code="Xloc = Span * 0.5;")

    built = rpc("links.build", index=0)
    assert built["ok"] is True

    info = rpc("links.get", index=0)
    assert info["name"] == "Half"
    assert info["code"] == "Xloc = Span * 0.5;"
    assert [i["var"] for i in info["inputs"]] == ["Span"]
    assert info["inputs"][0]["parm"]["id"] == span
    assert [o["var"] for o in info["outputs"]] == ["Xloc"]

    vsp.SetParmVal(span, 10.0)
    vsp.Update()
    assert vsp.GetParmVal(xloc) == 5.0

    rpc("links.removeInput", index=0, var="Span")
    assert rpc("links.get", index=0)["inputs"] == []
    rpc("links.rename", index=0, name="Renamed")
    assert rpc("links.list")[0]["name"] == "Renamed"
    rpc("links.delete", index=0)
    assert rpc("links.list") == []


def test_link_build_reports_failure(rpc):
    rpc("links.add", name="Bad")
    rpc("links.setCode", index=0, code="bogus = nope;")
    result = rpc("links.build", index=0)
    assert result["ok"] is False
    assert result["message"]


# --- fea ----------------------------------------------------------------------

def test_fea_struct_part_rename_delete(rpc):
    w = vsp.AddGeom("WING")
    vsp.Update()
    tree = rpc("fea.addStruct", geomId=w)
    assert len(tree["structs"]) == 1
    struct = tree["structs"][0]
    assert struct["geomId"] == w
    sid = struct["id"]

    tree = rpc("fea.addPart", structId=sid, type=vsp.FEA_RIB)
    parts = tree["structs"][0]["parts"]
    ribs = [p for p in parts if p["type"] == vsp.FEA_RIB]
    assert len(ribs) == 1
    part_id = ribs[0]["id"]

    tree = rpc("fea.rename", id=sid, name="MyStruct")
    assert tree["structs"][0]["name"] == "MyStruct"
    tree = rpc("fea.rename", id=part_id, name="RibA")
    assert any(p["id"] == part_id and p["name"] == "RibA" for p in tree["structs"][0]["parts"])

    tree = rpc("fea.delete", id=part_id)
    assert all(p["id"] != part_id for p in tree["structs"][0]["parts"])

    tree = rpc("fea.delete", id=sid)
    assert tree["structs"] == []


def test_fea_types_and_materials(rpc):
    part_values = {t["value"] for t in rpc("fea.partTypes")}
    assert {vsp.FEA_SLICE, vsp.FEA_RIB, vsp.FEA_SPAR, vsp.FEA_DOME} <= part_values
    ss_values = {t["value"] for t in rpc("fea.subsurfTypes")}
    assert {vsp.SS_LINE, vsp.SS_RECTANGLE, vsp.SS_LINE_ARRAY} <= ss_values

    before = {m["id"] for m in rpc("fea.tree")["materials"]}
    tree = rpc("fea.addMaterial")
    new = [m for m in tree["materials"] if m["id"] not in before]
    assert len(new) == 1
    tree = rpc("fea.rename", id=new[0]["id"], name="MyAlloy")
    assert any(m["name"] == "MyAlloy" for m in tree["materials"])
    tree = rpc("fea.delete", id=new[0]["id"])
    assert all(m["id"] != new[0]["id"] for m in tree["materials"])


def test_fea_subsurf_in_struct(rpc):
    w = vsp.AddGeom("WING")
    vsp.Update()
    rpc("fea.addStruct", geomId=w)
    sid = rpc("fea.tree")["structs"][0]["id"]
    tree = rpc("fea.addSubSurf", structId=sid, type=vsp.SS_RECTANGLE)
    subs = tree["structs"][0]["subsurfs"]
    assert len(subs) == 1
    assert subs[0]["type"] == vsp.SS_RECTANGLE
    tree = rpc("fea.delete", id=subs[0]["id"])
    assert tree["structs"][0]["subsurfs"] == []


def test_fea_missing_id_raises(rpc):
    try:
        rpc("fea.delete", id="NOPE")
    except RpcError:
        return
    raise AssertionError("expected RpcError for unknown FEA id")


# --- subsurf / controlGroups --------------------------------------------------

def test_subsurf_add_list_delete(rpc):
    w = vsp.AddGeom("WING")
    vsp.Update()
    types_ = {t["value"] for t in rpc("subsurf.types")}
    assert vsp.SS_RECTANGLE in types_

    assert rpc("subsurf.list", geomId=w) == []
    assert rpc("subsurf.add", geomId=w, type=vsp.SS_RECTANGLE) is None
    subs = rpc("subsurf.list", geomId=w)
    assert len(subs) == 1
    assert subs[0]["type"] == vsp.SS_RECTANGLE
    assert subs[0]["name"]

    rpc("subsurf.delete", geomId=w, id=subs[0]["id"])
    assert rpc("subsurf.list", geomId=w) == []


def test_control_groups_list_and_auto(rpc):
    vsp.AddGeom("WING")
    vsp.Update()
    groups = rpc("controlGroups.list")
    assert isinstance(groups, list)
    assert rpc("controlGroups.autoGroup") is None
    assert all({"index", "name"} <= set(g) for g in rpc("controlGroups.list"))


# --- measure ------------------------------------------------------------------

def test_measure_ruler_and_probe(rpc):
    a = vsp.AddGeom("POD")
    b = vsp.AddGeom("POD")
    vsp.Update()
    assert rpc("measure.addRuler", geomA=a, geomB=b) is None
    assert rpc("measure.addProbe", geomId=a) is None

    listing = rpc("measure.list")
    assert len(listing["rulers"]) == 1
    assert len(listing["probes"]) == 1
    assert listing["rulers"][0]["name"] == "Ruler 1"
    assert listing["probes"][0]["name"] == "Probe 1"

    rpc("measure.delete", id=listing["rulers"][0]["id"])
    listing = rpc("measure.list")
    assert listing["rulers"] == []
    assert len(listing["probes"]) == 1

    rpc("measure.delete", id=listing["probes"][0]["id"])
    assert rpc("measure.list") == {"rulers": [], "probes": []}


# --- console ------------------------------------------------------------------

def test_console_expression_and_namespace(rpc):
    out = rpc("console.exec", code="1+1")
    assert out == {"stdout": "", "result": "2", "error": None}

    out = rpc("console.exec", code="x = 5")
    assert out["result"] is None and out["error"] is None
    assert rpc("console.exec", code="x + 1")["result"] == "6"
    assert rpc("console.exec", code="vsp is not None")["result"] == "True"


def test_console_captures_stdout(rpc):
    out = rpc("console.exec", code="print('hello')\n3*3")
    assert out["stdout"] == "hello\n"
    assert out["result"] == "9"
    assert out["error"] is None


def test_console_captures_errors(rpc):
    out = rpc("console.exec", code="1/0")
    assert out["result"] is None
    assert "ZeroDivisionError" in out["error"]


def test_console_run_script(rpc, tmp_path):
    script = tmp_path / "hello.vspscript"
    script.write_text(
        'int main()\n{\n    Print( "hi from test" );\n    return 0;\n}\n',
        encoding="utf-8",
    )
    out = rpc("console.runScript", path=str(script))
    assert out["code"] == 0
    assert "hi from test" in out["output"]
