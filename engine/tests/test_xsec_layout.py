"""Section layout: positions, moving sections and inserting them anywhere."""
import pytest

from engine.vspctx import vsp
from engine.registry import RpcError


def _add(rpc, typ):
    g = vsp.AddGeom(typ)
    vsp.Update()
    return g


def _pos(lay):
    return [round(s["pos"], 6) for s in lay["stations"]]


def test_fuselage_insert_anywhere_and_move(rpc):
    g = _add(rpc, "FUSELAGE")
    lay = rpc("xsec.layout", geomId=g, surf=0)
    assert lay["kind"] == "fuselage" and _pos(lay) == [0, 7.5, 15, 22.5, 30]
    assert lay["stations"][0]["fixed"] and lay["stations"][-1]["fixed"]
    res = rpc("xsec.insertAt", geomId=g, surf=0, pos=5.0)
    assert res["index"] == 1 and _pos(res["layout"]) == [0, 5, 7.5, 15, 22.5, 30]
    # The new section is sized between its neighbours (nose point -> 2.5 wide).
    new = rpc("xsec.get", geomId=g, surf=0, index=1)
    assert 0 < new["width"] < 2.5
    lay = rpc("xsec.moveTo", geomId=g, surf=0, index=3, pos=12.0)
    assert _pos(lay) == [0, 5, 7.5, 12, 22.5, 30]
    # Moves are clamped between the neighbours.
    lay = rpc("xsec.moveTo", geomId=g, surf=0, index=3, pos=99.0)
    assert 15 < lay["stations"][3]["pos"] < 22.5
    with pytest.raises(RpcError):
        rpc("xsec.moveTo", geomId=g, surf=0, index=0, pos=1.0)


def test_wing_split_extend_keeps_planform(rpc):
    g = _add(rpc, "WING")

    def plan():
        xss = [vsp.GetXSec(vsp.GetXSecSurf(g, 0), i) for i in range(vsp.GetNumXSec(vsp.GetXSecSurf(g, 0)))]
        def val(xs, n):
            return round(next(vsp.GetParmVal(p) for p in vsp.GetXSecParmIDs(xs) if vsp.GetParmName(p) == n), 4)
        return [(val(x, "Span"), val(x, "Root_Chord"), val(x, "Tip_Chord")) for x in xss[1:]]

    assert plan() == [(9.0, 4.0, 1.0)]
    res = rpc("xsec.insertAt", geomId=g, surf=0, pos=3.0)
    assert res["index"] == 1
    assert plan() == [(3.0, 4.0, 3.0), (6.0, 3.0, 1.0)]
    lay = rpc("xsec.moveTo", geomId=g, surf=0, index=1, pos=5.0)
    assert _pos(lay) == [0, 5, 9]
    res = rpc("xsec.insertAt", geomId=g, surf=0, pos=11.0)
    assert res["index"] == 3 and _pos(res["layout"]) == [0, 5, 9, 11]
    assert plan()[-1] == (2.0, 1.0, 1.0)
    assert plan()[1] == (4.0, 3.0, 1.0)


def test_stack_and_prop(rpc):
    g = _add(rpc, "STACK")
    res = rpc("xsec.insertAt", geomId=g, surf=0, pos=2.0)
    assert _pos(res["layout"]) == [0, 1, 2, 3, 4, 4.5]
    lay = rpc("xsec.moveTo", geomId=g, surf=0, index=3, pos=3.5)
    assert _pos(lay) == [0, 1, 2, 3.5, 4, 4.5]
    p = _add(rpc, "PROP")
    lay = rpc("xsec.layout", geomId=p, surf=0)
    assert lay["kind"] == "prop"
    res = rpc("xsec.insertAt", geomId=p, surf=0, pos=0.7)
    assert _pos(res["layout"])[res["index"]] == 0.7
