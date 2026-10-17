"""subsurf.* (geometry sub-surfaces), controlGroups.* (VSPAERO control surface
groups) and measure.* (rulers and probes)."""
from __future__ import annotations

from engine.vspctx import vsp
from engine.registry import method, RpcError

SUBSURF_TYPES = [
    (vsp.SS_LINE, "Line"),
    (vsp.SS_RECTANGLE, "Rectangle"),
    (vsp.SS_ELLIPSE, "Ellipse"),
    (vsp.SS_CONTROL, "Control"),
    (vsp.SS_LINE_ARRAY, "Line Array"),
    (vsp.SS_FINITE_LINE, "Finite Line"),
    (vsp.SS_XSEC_CURVE, "XSec Curve"),
]


@method("subsurf.types")
def subsurf_types() -> list[dict]:
    return [{"value": v, "name": n} for v, n in SUBSURF_TYPES]


@method("subsurf.list")
def subsurf_list(geomId: str) -> list[dict]:
    return [
        {"id": sid, "name": vsp.GetSubSurfName(geomId, sid), "type": vsp.GetSubSurfType(sid)}
        for sid in vsp.GetSubSurfIDVec(geomId)
    ]


@method("subsurf.add", mutates=True)
def subsurf_add(geomId: str, type: int, surf: int = 0) -> None:
    vsp.AddSubSurf(geomId, type, surf)


@method("subsurf.delete", mutates=True)
def subsurf_delete(geomId: str, id: str) -> None:
    if id not in vsp.GetSubSurfIDVec(geomId):
        raise RpcError(f"no sub-surface {id} on geom {geomId}")
    vsp.DeleteSubSurf(geomId, id)


# --- VSPAERO control surface groups -------------------------------------------

@method("controlGroups.list")
def control_groups_list() -> list[dict]:
    return [
        {"index": i, "name": vsp.GetVSPAEROControlGroupName(i)}
        for i in range(vsp.GetNumControlSurfaceGroups())
    ]


@method("controlGroups.autoGroup", mutates=True)
def control_groups_auto_group() -> None:
    vsp.AutoGroupVSPAEROControlSurfaces()


# --- measure: rulers and probes ----------------------------------------------

@method("measure.list")
def measure_list() -> dict:
    return {
        "rulers": [{"id": r, "name": vsp.GetContainerName(r)} for r in vsp.GetAllRulers()],
        "probes": [{"id": p, "name": vsp.GetContainerName(p)} for p in vsp.GetAllProbes()],
    }


@method("measure.addRuler", mutates=True)
def measure_add_ruler(geomA: str, geomB: str) -> None:
    n = len(vsp.GetAllRulers()) + 1
    # Surface 0, u = w = 0.5 is the default placement used by the GUI.
    vsp.AddRuler(geomA, 0, 0.5, 0.5, geomB, 0, 0.5, 0.5, f"Ruler {n}")


@method("measure.addProbe", mutates=True)
def measure_add_probe(geomId: str) -> None:
    n = len(vsp.GetAllProbes()) + 1
    vsp.AddProbe(geomId, 0, 0.5, 0.5, f"Probe {n}")


@method("measure.delete", mutates=True)
def measure_delete(id: str) -> None:
    if id in vsp.GetAllRulers():
        vsp.DelRuler(id)
    elif id in vsp.GetAllProbes():
        vsp.DelProbe(id)
    else:
        raise RpcError(f"no ruler or probe {id}")
