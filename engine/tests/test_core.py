"""Core engine tests: app/model/geom/parms/mesh and the stdio protocol.

Run from the openvsp_gui directory:
    python -m pytest engine/tests/test_core.py -q
"""
from __future__ import annotations

import base64
import json
import math
import os
import queue
import subprocess
import sys
import threading

import pytest

from engine import registry, vsp_engine
from engine.registry import RpcError

vsp_engine.load_api()  # registers every RPC method (tolerates missing sibling modules)

APP_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ENGINE_SCRIPT = os.path.join(APP_ROOT, "engine", "vsp_engine.py")


@pytest.fixture(autouse=True)
def _clean_history(rpc):
    """Each test starts with an empty model and an empty undo history."""
    rpc("model.new")


def _rename(gid: str, new_name: str):
    # The conftest `rpc` helper takes its method name as `name`, so keyword "name" clashes; call the registry directly.
    return registry.call("geom.rename", {"id": gid, "name": new_name})


def _parm_id(rpc, container: str, name: str) -> str:
    for group in rpc("parms.list", containerId=container):
        for p in group["parms"]:
            if p["name"] == name:
                return p["id"]
    raise AssertionError(f"parm {name} not found in {container}")


def _b64_floats(s: str) -> list[float]:
    import array

    a = array.array("f")
    a.frombytes(base64.b64decode(s))
    return list(a)


def _b64_uints(s: str) -> list[int]:
    import array

    a = array.array("I")
    a.frombytes(base64.b64decode(s))
    return list(a)


# --- app -----------------------------------------------------------------------


def test_app_ping(rpc):
    assert rpc("app.ping") == "pong"


def test_app_info_shape(rpc):
    info = rpc("app.info")
    assert {"version", "vspRoot", "geomTypes", "analyses", "xsecShapes",
            "importFormats", "exportFormats", "examples"} <= set(info)
    assert {"FUSELAGE", "POD", "WING", "STACK", "PROP"} <= set(info["geomTypes"])
    groups = {a["group"] for a in info["analyses"]}
    assert groups <= {"Geometry", "Aero", "Mesh", "Other"}
    assert {"name": "CompGeom", "group": "Geometry"} in info["analyses"]
    names = {s["name"] for s in info["xsecShapes"]}
    assert {"Super Ellipse", "NACA 4-Series"} <= names
    assert "Undefined" not in names and all(s["value"] >= 0 for s in info["xsecShapes"])
    stl = [f for f in info["importFormats"] if f["name"] == "STL"]
    assert stl and stl[0]["ext"] == ".stl"
    assert any(f["ext"] == ".stp" for f in info["exportFormats"])
    assert all("path" in e and e["path"].endswith(".vsp3") for e in info["examples"])


# --- geometry types & meshes ----------------------------------------------------------


MUST_MESH = ["FUSELAGE", "POD", "WING", "STACK", "PROP"]


def test_every_geom_type_meshes(rpc):
    types = rpc("app.info")["geomTypes"]
    for t in types:
        try:
            gid = rpc("geom.add", type=t)["id"]
        except RpcError:
            assert t not in MUST_MESH, f"{t} must be addable"
            continue
        mesh = rpc("mesh.get", ids=[gid])["meshes"][0]
        if t in MUST_MESH:
            assert mesh["surfaces"], f"{t} produced no surfaces"
            assert len(mesh["surfaces"][0]["positions"]) > 0
        for surf in mesh["surfaces"]:
            pos = _b64_floats(surf["positions"])
            nrm = _b64_floats(surf["normals"])
            idx = _b64_uints(surf["indices"])
            wire = _b64_uints(surf["wire"])
            nverts = len(pos) // 3
            assert len(pos) % 3 == 0 and len(nrm) == len(pos)
            assert len(idx) % 3 == 0 and all(i < nverts for i in idx)
            assert len(wire) % 2 == 0 and all(i < nverts for i in wire)
        assert len(mesh["bbox"]["min"]) == 3


def test_mesh_get_defaults_to_shown_geoms(rpc):
    a = rpc("geom.add", type="POD")["id"]
    b = rpc("geom.add", type="POD")["id"]
    rpc("geom.setShown", ids=[b], shown=False)
    ids = [m["geomId"] for m in rpc("mesh.get")["meshes"]]
    assert a in ids and b not in ids


# --- parms -----------------------------------------------------------------------------


def test_parms_set_changed_is_consistent(rpc):
    wing = rpc("geom.add", type="WING")["id"]
    span = _parm_id(rpc, wing, "Span")
    before = {p["id"]: p["value"] for g in rpc("parms.list", containerId=wing) for p in g["parms"]}
    res = rpc("parms.set", id=span, value=20.0)
    assert res["parm"]["id"] == span
    assert abs(res["parm"]["value"] - 20.0) < 1e-9
    assert wing in res["dirtyGeoms"]
    assert span not in [c["id"] for c in res["changed"]]
    now = {p["id"]: p["value"] for p in rpc("parms.get", ids=[c["id"] for c in res["changed"]])} if res["changed"] else {}
    for c in res["changed"]:
        assert c["value"] == now[c["id"]]
        assert c["value"] != before[c["id"]]


def test_parms_search_finds_span(rpc):
    rpc("geom.add", type="WING")
    hits = rpc("parms.search", query="Span")
    assert hits, "expected parms matching Span"
    assert any(h["parm"]["name"] == "Span" for h in hits)
    assert all({"parm", "containerId", "containerName"} <= set(h) for h in hits)
    assert len(rpc("parms.search", query="", limit=3)) == 3


def test_geom_parms_keeps_planform_and_drops_xsec_editor_groups(rpc):
    wing = rpc("geom.add", type="WING")["id"]
    groups = [g["group"] for g in rpc("geom.parms", id=wing)]
    assert "XSec" in groups  # wing planform (Span, Root_Chord...) lives here
    assert not [g for g in groups if g.startswith("XSecCurve")]


# --- undo / redo ----------------------------------------------------------------------


def test_undo_redo_restores_parm_and_geom_count(rpc):
    pod = rpc("geom.add", type="POD")["id"]
    length = _parm_id(rpc, pod, "Length")
    default = rpc("parms.get", ids=[length])[0]["value"]
    rpc("parms.set", id=length, value=default + 3.0)
    assert rpc("parms.get", ids=[length])[0]["value"] == pytest.approx(default + 3.0)

    st = rpc("model.undo")
    assert rpc("parms.get", ids=[length])[0]["value"] == pytest.approx(default)
    assert len(st["geoms"]) == 1 and st["canRedo"] is True

    st = rpc("model.undo")  # undo the add
    assert st["geoms"] == [] and st["canUndo"] is False

    st = rpc("model.redo")  # back to the state after the parm edit's predecessor: POD at default length
    assert len(st["geoms"]) == 1
    assert rpc("parms.get", ids=[length])[0]["value"] == pytest.approx(default)
    st = rpc("model.redo")  # and the edit itself
    assert rpc("parms.get", ids=[length])[0]["value"] == pytest.approx(default + 3.0)
    assert st["canRedo"] is False


def test_coalesced_mutations_share_one_undo_step(rpc):
    pod = rpc("geom.add", type="POD")["id"]
    length = _parm_id(rpc, pod, "Length")
    base = rpc("parms.get", ids=[length])[0]["value"]
    for k in range(5):  # a slider drag
        rpc("parms.set", id=length, value=base + k + 1, coalesceKey="drag-1")
    rpc("model.undo")
    assert rpc("parms.get", ids=[length])[0]["value"] == pytest.approx(base)


def test_undo_with_empty_history_is_a_noop(rpc):
    st = rpc("model.undo")
    assert st["canUndo"] is False and st["geoms"] == []


# --- files ----------------------------------------------------------------------------


def test_open_save_roundtrip(rpc, tmp_path):
    rpc("geom.add", type="WING")
    rpc("geom.add", type="POD")
    path = str(tmp_path / "design.vsp3")
    saved = rpc("model.save", path=path)
    assert os.path.isfile(saved["path"])
    assert rpc("model.state")["dirty"] is False

    rpc("model.new")
    assert rpc("model.state")["geoms"] == []
    st = rpc("model.open", path=path)
    assert len(st["geoms"]) == 2
    assert st["file"] == os.path.abspath(path)
    assert st["canUndo"] is False


def test_save_without_path_raises(rpc):
    with pytest.raises(RpcError):
        rpc("model.save")


# --- geometry editing -------------------------------------------------------------------


def test_copy_paste(rpc):
    pod = rpc("geom.add", type="POD")["id"]
    rpc("geom.copy", ids=[pod])
    res = rpc("geom.paste")
    assert len(res["ids"]) == 1
    assert len(res["state"]["geoms"]) == 2
    assert res["ids"][0] != pod


def test_reparent(rpc):
    a = rpc("geom.add", type="POD")["id"]
    b = rpc("geom.add", type="POD")["id"]
    st = rpc("geom.reparent", id=b, parentId=a)
    node = {g["id"]: g for g in st["geoms"]}
    assert node[b]["parentId"] == a
    assert b in node[a]["children"]
    with pytest.raises(RpcError):
        rpc("geom.reparent", id=a, parentId=b)  # would create a cycle


def test_set_shown_and_rename_and_color(rpc):
    g = rpc("geom.add", type="POD")["id"]
    rpc("geom.setShown", ids=[g], shown=False)
    _rename(g, "Nose")
    rpc("geom.setColor", id=g, color=[1.0, 0.0, 0.0])
    node = {n["id"]: n for n in rpc("model.state")["geoms"]}[g]
    assert node["shown"] is False
    assert node["name"] == "Nose"
    assert node["color"] == pytest.approx([1.0, 0.0, 0.0], abs=1e-2)


def test_delete(rpc):
    g = rpc("geom.add", type="POD")["id"]
    st = rpc("geom.delete", ids=[g])
    assert st["geoms"] == []


def test_unknown_geom_id_raises():
    with pytest.raises(RpcError):
        _rename("NOPE", "x")


# --- xsec ring ------------------------------------------------------------------------


def test_xsec_ring_is_closed_and_global(rpc):
    wing = rpc("geom.add", type="WING")["id"]
    ring = rpc("mesh.xsecRing", geomId=wing, surf=0, index=0, n=32)["points"]
    assert len(ring) == 33
    assert ring[0] == pytest.approx(ring[-1])
    assert all(all(math.isfinite(v) for v in p) for p in ring)

    # Move the wing: a global ring must follow it (ComputeXSecPnt would not).
    rpc("parms.set", id=_parm_id(rpc, wing, "X_Rel_Location"), value=10.0)
    moved = rpc("mesh.xsecRing", geomId=wing, surf=0, index=0, n=32)["points"]
    assert min(p[0] for p in moved) == pytest.approx(10.0 + min(p[0] for p in ring), abs=1e-3)


# --- stdio protocol ----------------------------------------------------------------------


def _start_stdio_engine(err_path: str) -> subprocess.Popen:
    err = open(err_path, "w", encoding="utf-8")
    return subprocess.Popen(
        [sys.executable, ENGINE_SCRIPT],
        cwd=APP_ROOT,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=err,
        text=True,
        encoding="utf-8",
        bufsize=1,
    )


def test_stdio_protocol_is_clean(tmp_path):
    proc = _start_stdio_engine(str(tmp_path / "engine_stderr.txt"))
    lines: queue.Queue = queue.Queue()

    def pump():
        for line in proc.stdout:
            lines.put(line)
        lines.put(None)

    threading.Thread(target=pump, daemon=True).start()
    seen: list[dict] = []

    def next_msg(timeout=120):
        raw = lines.get(timeout=timeout)
        assert raw is not None, "engine closed stdout early"
        msg = json.loads(raw)  # every stdout line must be a JSON object
        assert isinstance(msg, dict)
        seen.append(msg)
        return msg

    def reply_for(rid):
        while True:
            msg = next_msg()
            if msg.get("id") == rid:
                return msg

    try:
        ready = next_msg()
        assert ready == {"event": "ready", "data": {"version": ready["data"]["version"]}}
        assert "OpenVSP" in ready["data"]["version"]

        proc.stdin.write(json.dumps({"id": 1, "method": "app.ping"}) + "\n")
        proc.stdin.flush()
        assert reply_for(1)["result"] == "pong"

        proc.stdin.write(json.dumps({"id": 2, "method": "geom.add", "params": {"type": "POD"}}) + "\n")
        proc.stdin.flush()
        add = reply_for(2)
        assert "result" in add and add["result"]["id"]
        assert [g["type"].upper() for g in add["result"]["state"]["geoms"]] == ["POD"]  # OpenVSP reports "Pod"

        proc.stdin.write(json.dumps({"id": 3, "method": "no.such.method"}) + "\n")
        proc.stdin.flush()
        err = reply_for(3)
        assert err["error"]["code"] == 404
    finally:
        proc.stdin.close()
        proc.wait(timeout=120)
        assert proc.returncode == 0, open(str(tmp_path / "engine_stderr.txt"), encoding="utf-8").read()[-2000:]
