"""File import / export (docs/API.md "io.*").

format values are the vsp.IMPORT_* / vsp.EXPORT_* integers (see app.info).
io.export passes its arguments to vsp.ExportFile(file, set, format); the
returned mesh id is ignored.
"""
from __future__ import annotations

import os

from engine.vspctx import vsp
from engine.registry import method, RpcError
from engine.parmutil import group_parms
from engine.state import model_state

_EXPORT_GROUPS_BY_VALUE = {
    getattr(vsp, name): group
    for name, group in {
        "EXPORT_STEP": "STEPSettings",
        "EXPORT_STEP_STITCH": "STEPSettings",
        "EXPORT_STEP_STRUCTURE": "STEPSettings",
        "EXPORT_IGES": "IGESSettings",
        "EXPORT_IGES_STITCH": "IGESSettings",
        "EXPORT_IGES_STRUCTURE": "IGESSettings",
        "EXPORT_DXF": "DXFSettings",
        "EXPORT_SVG": "SVGSettings",
        "EXPORT_STL": "STLSettings",
    }.items()
}


def _drain_errors() -> list[str]:
    mgr = vsp.ErrorMgrSingleton.getInstance()
    msgs = []
    while mgr.GetNumTotalErrors() > 0:
        msgs.append(mgr.PopLastError().GetErrorString())
    return msgs


@method("io.import", mutates=True)
def import_file(path: str, format: int) -> dict:
    if not os.path.isfile(path):
        raise RpcError(f"file not found: {path}")
    _drain_errors()
    vsp.ImportFile(path, format, "")
    vsp.Update()
    msgs = _drain_errors()
    if msgs:
        raise RpcError("import failed: " + "; ".join(msgs))
    return model_state()


@method("io.export")
def export_file(path: str, format: int, set: int = 0) -> dict:
    _drain_errors()
    vsp.ExportFile(path, set, format)
    msgs = _drain_errors()
    if msgs:
        raise RpcError("export failed: " + "; ".join(msgs))
    if not os.path.isfile(path) or os.path.getsize(path) == 0:
        raise RpcError(f"export wrote no data to {path}")
    return {"path": path}


@method("io.exportOptions")
def export_options(format: int) -> list[dict]:
    group = _EXPORT_GROUPS_BY_VALUE.get(format)
    if group is None:
        return []
    vid = vsp.GetVehicleID()
    pids = [p for p in vsp.FindContainerParmIDs(vid) if vsp.GetParmGroupName(p) == group]
    return group_parms(pids)
