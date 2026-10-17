"""fea.* : structures, parts, sub-surfaces, materials and properties of the
FEA structure model (Structure tab). Every mutating call returns fea.tree."""
from __future__ import annotations

from engine.vspctx import vsp
from engine.registry import method, RpcError
from engine.api.subsurf import SUBSURF_TYPES

PART_TYPES = [
    (vsp.FEA_SLICE, "Slice"),
    (vsp.FEA_RIB, "Rib"),
    (vsp.FEA_SPAR, "Spar"),
    (vsp.FEA_FIX_POINT, "Fix Point"),
    (vsp.FEA_DOME, "Dome"),
    (vsp.FEA_RIB_ARRAY, "Rib Array"),
    (vsp.FEA_SLICE_ARRAY, "Slice Array"),
    (vsp.FEA_SKIN, "Skin"),
    (vsp.FEA_TRIM, "Trim"),
    (vsp.FEA_POLY_SPAR, "Poly Spar"),
]

# Parm group names of an FEA sub-surface look like "SS_Rectangle", "SS_LineArray".
# GetSubSurfType() does not accept FEA sub-surface ids, so the type is read from these.
_SS_GROUP_TYPES = {
    "ssline": vsp.SS_LINE,
    "ssrectangle": vsp.SS_RECTANGLE,
    "ssellipse": vsp.SS_ELLIPSE,
    "sscontrol": vsp.SS_CONTROL,
    "sslinearray": vsp.SS_LINE_ARRAY,
    "ssfiniteline": vsp.SS_FINITE_LINE,
    "ssxseccurve": vsp.SS_XSEC_CURVE,
}

def _struct_loc(struct_id: str) -> tuple[str, int]:
    """FEA struct id -> (owning geom id, struct index) used by the Fea* calls."""
    return vsp.GetFeaStructParentGeomID(struct_id), vsp.GetFeaStructIndex(struct_id)


def _subsurf_type(ss_id: str) -> int:
    for pid in vsp.FindContainerParmIDs(ss_id):
        key = vsp.GetParmGroupName(pid).replace("_", "").lower()
        if key in _SS_GROUP_TYPES:
            return _SS_GROUP_TYPES[key]
    return -1


def _tree() -> dict:
    structs = []
    for sid in vsp.GetFeaStructIDVec():
        geom, idx = _struct_loc(sid)
        parts = [
            {"id": pid, "name": vsp.GetFeaPartName(pid), "type": vsp.GetFeaPartType(pid)}
            for pid in vsp.GetFeaPartIDVec(sid)
        ]
        subsurfs = [
            {"id": ssid, "name": vsp.GetFeaSubSurfName(ssid), "type": _subsurf_type(ssid)}
            for ssid in vsp.GetFeaSubSurfIDVec(sid)
        ]
        structs.append({
            "id": sid,
            "name": vsp.GetFeaStructName(geom, idx),
            "geomId": geom,
            "parts": parts,
            "subsurfs": subsurfs,
        })
    return {
        "structs": structs,
        "materials": [
            {"id": m, "name": vsp.GetContainerName(m)} for m in vsp.GetFeaMaterialIDVec()
        ],
        "properties": [
            {"id": p, "name": vsp.GetContainerName(p)} for p in vsp.GetFeaPropertyIDVec()
        ],
    }


def _require_struct(structId: str) -> None:
    if structId not in vsp.GetFeaStructIDVec():
        raise RpcError(f"no FEA structure {structId}")


def _locate(item_id: str) -> tuple[str, str]:
    """Classify an FEA id. Returns (kind, owning struct id). kind is one of
    'struct', 'part', 'subsurf', 'material', 'property', or '' if unknown.
    The owning struct id is only set for parts and sub-surfaces."""
    structs = vsp.GetFeaStructIDVec()
    if item_id in structs:
        return "struct", ""
    for sid in structs:
        if item_id in vsp.GetFeaPartIDVec(sid):
            return "part", sid
        if item_id in vsp.GetFeaSubSurfIDVec(sid):
            return "subsurf", sid
    if item_id in vsp.GetFeaMaterialIDVec():
        return "material", ""
    if item_id in vsp.GetFeaPropertyIDVec():
        return "property", ""
    return "", ""


@method("fea.tree")
def tree() -> dict:
    return _tree()


@method("fea.partTypes")
def part_types() -> list[dict]:
    return [{"value": v, "name": n} for v, n in PART_TYPES]


@method("fea.subsurfTypes")
def subsurf_types() -> list[dict]:
    return [{"value": v, "name": n} for v, n in SUBSURF_TYPES]


@method("fea.addStruct", mutates=True)
def add_struct(geomId: str, surf: int = 0) -> dict:
    vsp.AddFeaStruct(geomId, True, surf)
    return _tree()


@method("fea.addPart", mutates=True)
def add_part(structId: str, type: int) -> dict:
    _require_struct(structId)
    geom, idx = _struct_loc(structId)
    vsp.AddFeaPart(geom, idx, type)
    return _tree()


@method("fea.addSubSurf", mutates=True)
def add_subsurf(structId: str, type: int) -> dict:
    _require_struct(structId)
    geom, idx = _struct_loc(structId)
    vsp.AddFeaSubSurf(geom, idx, type)
    return _tree()


@method("fea.addMaterial", mutates=True)
def add_material() -> dict:
    vsp.AddFeaMaterial()
    return _tree()


@method("fea.addProperty", mutates=True)
def add_property(type: int = 0) -> dict:
    vsp.AddFeaProperty(type)
    return _tree()


@method("fea.delete", mutates=True)
def delete(id: str) -> dict:
    kind, sid = _locate(id)
    if kind == "struct":
        geom, idx = _struct_loc(id)
        vsp.DeleteFeaStruct(geom, idx)
    elif kind == "part":
        geom, idx = _struct_loc(sid)
        vsp.DeleteFeaPart(geom, idx, id)
    elif kind == "subsurf":
        geom, idx = _struct_loc(sid)
        vsp.DeleteFeaSubSurf(geom, idx, id)
    elif kind == "material":
        vsp.DeleteFeaMaterial(id)
        if id in vsp.GetFeaMaterialIDVec():
            raise RpcError("material cannot be deleted (library materials are read-only)")
    elif kind == "property":
        vsp.DeleteFeaProperty(id)
    else:
        raise RpcError(f"no FEA item {id}")
    return _tree()


@method("fea.rename", mutates=True)
def rename(id: str, name: str) -> dict:
    kind, _ = _locate(id)
    if kind == "struct":
        geom, idx = _struct_loc(id)
        vsp.SetFeaStructName(geom, idx, name)
    elif kind == "part":
        vsp.SetFeaPartName(id, name)
    elif kind == "subsurf":
        vsp.SetFeaSubSurfName(id, name)
    elif kind in ("material", "property"):
        vsp.SetContainerName(id, name)
    else:
        raise RpcError(f"no FEA item {id}")
    return _tree()
