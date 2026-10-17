"""Analyses and results (docs/API.md "analysis.*" and "results.*").

Notes from the OpenVSP build:
* Result set names differ from analysis names ("CompGeom" -> results "Comp_Geom",
  MassProp -> "Mass_Properties", VSPAEROSweep -> "VSPAERO_*"), so analysis.run
  returns the resultId from ExecAnalysis and results are never looked up by
  analysis name.
* VSPAERO analyses need VSPAEROComputeGeometry to have been run first (it writes
  the VSPGEOM file). VSPAEROSweep alone fails with "Could not load ... VSPGEOM".
* GetAnalysisInputType returns the same enum as the result-data types.
  BOOL_DATA is treated as int.
"""
from __future__ import annotations

import os

from engine.vspctx import vsp
from engine.registry import method, RpcError

SUMMARY_MAX = 20

# Analysis -> UI group (app.info uses the same grouping).
_GROUPS = {
    "Geometry": {"CompGeom", "DegenGeom", "GeometryAnalysis", "MassProp", "PlanarSlice",
                 "Projection", "SurfacePatches"},
    "Aero": {"BladeElement", "CpSlicer", "EmintonLord", "ParasiteDrag", "WaveDrag",
             "VSPAERODegenGeom", "VSPAEROComputeGeometry", "VSPAEROSinglePoint",
             "VSPAEROSweep", "VSPAEROReadPreviousAnalysis"},
    "Mesh": {"DegenGeomMesh", "FeaMeshAnalysis", "CfdMeshAnalysis", "FeaMeshExport",
             "SurfaceIntersection"},
}


def analysis_group(name: str) -> str:
    for group, names in _GROUPS.items():
        if name in names:
            return group
    return "Other"


# Friendly labels for common inputs. Unknown inputs show their raw name.
LABELS = {
    "Set": "Geometry set", "GeomSet": "Geometry set", "DegenSet": "Degen geometry set",
    "ThinGeomSet": "Thin geometry set", "CGGeomSet": "CG geometry set",
    "CGDegenSet": "CG degen set", "HalfMeshFlag": "Half mesh", "WriteCSVFlag": "Write CSV",
    "WriteTXTFlag": "Write TXT", "SubSurfFlag": "Include subsurfaces",
    "UseModeFlag": "Use mode", "ModeID": "Mode", "NumMassSlice": "Number of mass slices",
    "MassSliceDir": "Mass slice direction",
    "AlphaStart": "Alpha start", "AlphaEnd": "Alpha end", "AlphaNpts": "Alpha points",
    "BetaStart": "Beta start", "BetaEnd": "Beta end", "BetaNpts": "Beta points",
    "MachStart": "Mach start", "MachEnd": "Mach end", "MachNpts": "Mach points",
    "ReCref": "Reynolds number (Cref)", "ReCrefEnd": "Reynolds number end",
    "ReCrefNpts": "Reynolds number points", "Machref": "Mach reference",
    "Vinf": "Freestream velocity", "Rho": "Air density", "Vref": "Reference velocity",
    "Sref": "Reference area", "bref": "Reference span (bref)", "cref": "Reference chord (cref)",
    "Xcg": "CG x", "Ycg": "CG y", "Zcg": "CG z", "NCPU": "CPU threads",
    "Symmetry": "Symmetry", "WakeNumIter": "Wake iterations", "NumWakeNodes": "Wake nodes",
    "StallModel": "Stall model", "FarDist": "Far distance", "UnsteadyType": "Unsteady type",
    "Clo2D": "Lift coefficient at zero (2D)", "CLMax2D": "CL max (2D)",
    "WingID": "Wing", "CGModeID": "CG mode",
}

_FLAG_OPTIONS = [{"value": 0, "label": "Off"}, {"value": 1, "label": "On"}]

_INT_TYPES = {vsp.INT_DATA, vsp.BOOL_DATA}
_DOUBLE_TYPES = {vsp.DOUBLE_DATA}
_STRING_TYPES = {vsp.STRING_DATA}
_VEC3D_TYPES = {vsp.VEC3D_DATA}

_INPUT_TYPE_NAMES = {}
for _t in _INT_TYPES:
    _INPUT_TYPE_NAMES[_t] = "int"
for _t in _DOUBLE_TYPES:
    _INPUT_TYPE_NAMES[_t] = "double"
for _t in _STRING_TYPES:
    _INPUT_TYPE_NAMES[_t] = "string"
for _t in _VEC3D_TYPES:
    _INPUT_TYPE_NAMES[_t] = "vec3d"


def _errors_drain() -> list[str]:
    mgr = vsp.ErrorMgrSingleton.getInstance()
    msgs = []
    while mgr.GetNumTotalErrors() > 0:
        msgs.append(mgr.PopLastError().GetErrorString())
    return msgs


def _input_names(name: str) -> list[str]:
    if name not in set(vsp.ListAnalysis()):
        raise RpcError(f"unknown analysis {name}")
    return list(vsp.GetAnalysisInputNames(name))


def _get_input(name: str, inp: str, tname: str) -> list:
    if tname == "int":
        return [int(v) for v in vsp.GetIntAnalysisInput(name, inp, 0)]
    if tname == "double":
        return [float(v) for v in vsp.GetDoubleAnalysisInput(name, inp, 0)]
    if tname == "string":
        return [str(v) for v in vsp.GetStringAnalysisInput(name, inp, 0)]
    if tname == "vec3d":
        return [[p.x(), p.y(), p.z()] for p in vsp.GetVec3dAnalysisInput(name, inp, 0)]
    return []


# --- analysis.* -------------------------------------------------------------------------

@method("analysis.list")
def analysis_list() -> list[dict]:
    return [{"name": n, "group": analysis_group(n)} for n in vsp.ListAnalysis()]


@method("analysis.inputs")
def analysis_inputs(name: str) -> list[dict]:
    out = []
    for inp in _input_names(name):
        tname = _INPUT_TYPE_NAMES.get(vsp.GetAnalysisInputType(name, inp))
        if tname is None:
            continue   # skip input types the UI cannot edit
        entry = {
            "name": inp,
            "type": tname,
            "value": _get_input(name, inp, tname),
            "label": LABELS.get(inp, inp),
        }
        if inp.endswith("Flag"):
            entry["options"] = _FLAG_OPTIONS
        out.append(entry)
    return out


@method("analysis.setInput")
def analysis_set_input(name: str, input: str, value) -> None:
    if input not in _input_names(name):
        raise RpcError(f"analysis {name} has no input {input}")
    tname = _INPUT_TYPE_NAMES.get(vsp.GetAnalysisInputType(name, input))
    if tname is None:
        raise RpcError(f"input {input} has an unsupported type")
    vals = value if isinstance(value, list) else [value]
    _errors_drain()
    if tname == "int":
        vsp.SetIntAnalysisInput(name, input, [int(v) for v in vals], 0)
    elif tname == "double":
        vsp.SetDoubleAnalysisInput(name, input, [float(v) for v in vals], 0)
    elif tname == "string":
        vsp.SetStringAnalysisInput(name, input, [str(v) for v in vals], 0)
    else:
        vecs = []
        for v in vals:
            if len(v) != 3:
                raise RpcError(f"{input} expects [x, y, z] vectors")
            vecs.append(vsp.vec3d(float(v[0]), float(v[1]), float(v[2])))
        vsp.SetVec3dAnalysisInput(name, input, vecs, 0)
    msgs = _errors_drain()
    if msgs:
        raise RpcError("; ".join(msgs))
    return None


@method("analysis.reset")
def analysis_reset(name: str) -> None:
    _input_names(name)
    vsp.SetAnalysisInputDefaults(name)
    return None


def _summary(rid: str) -> list[dict]:
    out = []
    for dname in vsp.GetAllDataNames(rid):
        if len(out) >= SUMMARY_MAX:
            break
        t = vsp.GetResultsType(rid, dname)
        if t in _INT_TYPES:
            vals = vsp.GetIntResults(rid, dname, 0)
            if len(vals) == 1:
                out.append({"name": dname, "value": int(vals[0])})
        elif t in _DOUBLE_TYPES:
            vals = vsp.GetDoubleResults(rid, dname, 0)
            if len(vals) == 1:
                out.append({"name": dname, "value": float(vals[0])})
    return out


@method("analysis.run", long=True)
def analysis_run(name: str) -> dict:
    _input_names(name)
    _errors_drain()
    rid = vsp.ExecAnalysis(name)
    if not rid:
        msgs = _errors_drain()
        raise RpcError(f"analysis {name} failed" + (": " + "; ".join(msgs) if msgs else ""))
    return {"resultId": rid, "summary": _summary(rid)}


# --- results.* ---------------------------------------------------------------------------

_RESULT_TYPE_NAMES = {
    vsp.INT_DATA: "int",
    vsp.BOOL_DATA: "int",
    vsp.DOUBLE_DATA: "double",
    vsp.STRING_DATA: "string",
    vsp.VEC3D_DATA: "vec3d",
    vsp.DOUBLE_MATRIX_DATA: "double_mat",
}


def _result_value(rid: str, dname: str, t: int):
    if t in _INT_TYPES:
        return [int(v) for v in vsp.GetIntResults(rid, dname, 0)]
    if t in _DOUBLE_TYPES:
        return [float(v) for v in vsp.GetDoubleResults(rid, dname, 0)]
    if t in _STRING_TYPES:
        return [str(v) for v in vsp.GetStringResults(rid, dname, 0)]
    if t in _VEC3D_TYPES:
        return [[p.x(), p.y(), p.z()] for p in vsp.GetVec3dResults(rid, dname, 0)]
    if t == vsp.DOUBLE_MATRIX_DATA:
        return [[float(x) for x in row] for row in vsp.GetDoubleMatResults(rid, dname, 0)]
    return None


@method("results.list")
def results_list() -> list[dict]:
    out = []
    for name in vsp.GetAllResultsNames():
        for i in range(vsp.GetNumResults(name)):
            out.append({"id": vsp.FindResultsID(name, i), "name": name})
    return out


@method("results.get")
def results_get(id: str) -> dict:
    _errors_drain()
    rname = vsp.GetResultsName(id)
    dnames = list(vsp.GetAllDataNames(id))
    msgs = _errors_drain()
    if msgs:
        raise RpcError(f"unknown results id {id}: " + "; ".join(msgs))
    data = []
    for dname in dnames:
        t = vsp.GetResultsType(id, dname)
        tname = _RESULT_TYPE_NAMES.get(t)
        if tname is None:
            continue   # int matrices and reference types are not exposed
        data.append({"name": dname, "type": tname, "value": _result_value(id, dname, t)})
    return {"id": id, "name": rname, "data": data}


@method("results.exportCsv")
def results_export_csv(id: str, path: str) -> None:
    _errors_drain()
    vsp.WriteResultsCSVFile(id, path)
    msgs = _errors_drain()
    if msgs:
        raise RpcError("; ".join(msgs))
    if not os.path.isfile(path):
        raise RpcError(f"CSV was not written: {path}")
    return None


@method("results.clear")
def results_clear() -> None:
    vsp.DeleteAllResults()
    return None
