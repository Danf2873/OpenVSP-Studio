"""model.* and geom.* : model lifecycle, undo/redo, and geometry editing.

Undo design: every mutating call is preceded by a file snapshot of the whole
model (WriteVSPFile, SET_ALL) written to a temp dir. Undo/redo swap snapshots
via ClearVSPModel + ReadVSPFile. Consecutive mutations sharing a coalesceKey
(e.g. a slider drag) share one snapshot.

Note: WriteVSPFile also changes OpenVSP's own "current file name" to the
snapshot path. The engine tracks the user's file in STATE["file"] instead.
"""
from __future__ import annotations

import os
import shutil
import tempfile

from engine.registry import method, RpcError, notify, set_snapshot_hook
from engine.vspctx import vsp
from engine.parmutil import group_parms
from engine.state import STATE, model_state, all_geoms, geom_descendants

MAX_HISTORY = 50

_snap_root: str | None = None
_snap_count = 0
_undo: list[str] = []
_redo: list[str] = []
_last_key: str | None = None


# --- snapshot storage -----------------------------------------------------------


def _new_snap_path() -> str:
    global _snap_root, _snap_count
    if _snap_root is None or not os.path.isdir(_snap_root):
        _snap_root = tempfile.mkdtemp(prefix="vsp_undo_")
    _snap_count += 1
    return os.path.join(_snap_root, f"snap_{_snap_count:06d}.vsp3")


def _write_current(path: str) -> str:
    vsp.WriteVSPFile(path, vsp.SET_ALL)
    if not os.path.isfile(path):
        raise RpcError(f"could not write snapshot {path}")
    return path


def _remove_files(paths: list[str]) -> None:
    for p in paths:
        try:
            os.remove(p)
        except OSError:
            pass


def _update_flags() -> None:
    STATE["canUndo"] = bool(_undo)
    STATE["canRedo"] = bool(_redo)


def _clear_history() -> None:
    global _last_key
    _remove_files(_undo)
    _remove_files(_redo)
    _undo.clear()
    _redo.clear()
    _last_key = None
    _update_flags()


def _on_mutation(coalesce_key: str | None) -> None:
    """Snapshot hook: called by registry.call before every mutating method."""
    global _last_key
    if coalesce_key is not None and coalesce_key == _last_key:
        return  # same gesture: the snapshot taken at its start is still the undo point
    _undo.append(_write_current(_new_snap_path()))
    if len(_undo) > MAX_HISTORY:
        _remove_files([_undo.pop(0)])
    _remove_files(_redo)
    _redo.clear()
    _last_key = coalesce_key
    STATE["dirty"] = True
    _update_flags()


set_snapshot_hook(_on_mutation)


def _restore(path: str) -> None:
    vsp.ClearVSPModel()
    vsp.ReadVSPFile(path)
    vsp.Update()


# --- helpers ---------------------------------------------------------------------


def _require_geom(gid) -> str:
    if not isinstance(gid, str) or gid not in set(vsp.FindGeoms()):
        raise RpcError(f"no geometry with id {gid!r}")
    return gid


def _require_ids(ids) -> list[str]:
    if not isinstance(ids, (list, tuple)) or not ids:
        raise RpcError("ids must be a non-empty list")
    geoms = set(vsp.FindGeoms())
    out = []
    for gid in ids:
        if not isinstance(gid, str) or gid not in geoms:
            raise RpcError(f"no geometry with id {gid!r}")
        out.append(gid)
    return out


def _single_id(ids) -> str:
    ids = _require_ids(ids)
    if len(ids) != 1:
        # OpenVSP's clipboard holds exactly one geometry: a second copy/cut replaces the first.
        raise RpcError("copy and cut work on one geometry at a time")
    return ids[0]


# --- model.* ------------------------------------------------------------------------


@method("model.state")
def state() -> dict:
    return model_state()


@method("model.new", mutates=True)
def new() -> dict:
    vsp.VSPRenew()
    _clear_history()
    STATE.update(file=None, dirty=False)
    return model_state()


@method("model.open")
def open_(path: str) -> dict:
    if not isinstance(path, str) or not os.path.isfile(path):
        raise RpcError(f"file not found: {path}")
    vsp.VSPRenew()
    vsp.ReadVSPFile(path)
    vsp.Update()
    _clear_history()
    STATE.update(file=os.path.abspath(path), dirty=False)
    notify("model_changed", {"method": "model.open"})
    return model_state()


@method("model.save")
def save(path: str | None = None) -> dict:
    target = path or STATE["file"]
    if not target:
        raise RpcError("the model has no file yet; pass a path")
    target = os.path.abspath(target)
    folder = os.path.dirname(target)
    if not os.path.isdir(folder):
        raise RpcError(f"folder does not exist: {folder}")
    vsp.WriteVSPFile(target, vsp.SET_ALL)
    if not os.path.isfile(target):
        raise RpcError(f"could not write {target}")
    STATE.update(file=target, dirty=False)
    notify("model_changed", {"method": "model.save"})
    return {"path": target}


@method("model.insert", mutates=True)
def insert(path: str, parentId: str | None = None) -> dict:
    if not isinstance(path, str) or not os.path.isfile(path):
        raise RpcError(f"file not found: {path}")
    if parentId:
        _require_geom(parentId)
    vsp.InsertVSPFile(path, parentId or "")
    vsp.Update()
    return model_state()


@method("model.undo")
def undo() -> dict:
    global _last_key
    if not _undo:
        return model_state()
    current = _write_current(_new_snap_path())
    target = _undo.pop()
    _redo.append(current)
    _restore(target)
    _remove_files([target])
    _last_key = None
    STATE["dirty"] = True
    _update_flags()
    notify("model_changed", {"method": "model.undo"})
    return model_state()


@method("model.redo")
def redo() -> dict:
    global _last_key
    if not _redo:
        return model_state()
    current = _write_current(_new_snap_path())
    target = _redo.pop()
    _undo.append(current)
    _restore(target)
    _remove_files([target])
    _last_key = None
    STATE["dirty"] = True
    _update_flags()
    notify("model_changed", {"method": "model.redo"})
    return model_state()


@method("model.autosave")
def autosave() -> dict:
    path = os.path.join(tempfile.gettempdir(), "openvsp_studio_autosave.vsp3")
    vsp.WriteVSPFile(path, vsp.SET_ALL)
    return {"path": path}


# --- geom.* -------------------------------------------------------------------------


@method("geom.add", mutates=True)
def geom_add(type: str, parentId: str | None = None, name: str | None = None) -> dict:
    known = list(vsp.GetGeomTypes())
    if type not in known:
        raise RpcError(f"unknown geometry type {type!r}")
    if parentId:
        _require_geom(parentId)
    gid = vsp.AddGeom(type, parentId or "")
    if not gid or gid == "NONE" or gid not in set(vsp.FindGeoms()):
        # OpenVSP reports refusals (e.g. CONFORMAL without a suitable parent) as "NONE" plus a log line.
        raise RpcError(f"could not add a {type}")
    if name:
        vsp.SetGeomName(gid, name)
    vsp.Update()
    return {"id": gid, "state": model_state()}


@method("geom.delete", mutates=True)
def geom_delete(ids: list[str]) -> dict:
    ids = _require_ids(ids)
    vsp.DeleteGeomVec(ids)
    vsp.Update()
    return model_state()


@method("geom.copy")
def geom_copy(ids: list[str]):
    gid = _single_id(ids)
    vsp.CopyGeomToClipboard(gid)
    return None


@method("geom.cut", mutates=True)
def geom_cut(ids: list[str]) -> dict:
    gid = _single_id(ids)
    vsp.CutGeomToClipboard(gid)
    vsp.Update()
    return model_state()


@method("geom.paste", mutates=True)
def geom_paste(parentId: str | None = None) -> dict:
    if parentId:
        _require_geom(parentId)
    new_ids = list(vsp.PasteGeomClipboard(parentId or ""))
    vsp.Update()
    return {"ids": new_ids, "state": model_state()}


@method("geom.rename", mutates=True)
def geom_rename(id: str, name: str) -> dict:
    gid = _require_geom(id)
    if not isinstance(name, str) or not name.strip():
        raise RpcError("name must not be empty")
    vsp.SetGeomName(gid, name.strip())
    return model_state()


@method("geom.reparent", mutates=True)
def geom_reparent(id: str, parentId: str | None = None) -> dict:
    gid = _require_geom(id)
    if parentId is None:
        # SetGeomParent ignores "" and "NONE" in OpenVSP 3.54, so a geom cannot be detached to root.
        if vsp.GetGeomParent(gid) in ("", "NONE"):
            return model_state()  # already at root
        raise RpcError("OpenVSP cannot move a geometry to the top level; reparent it under another geometry")
    pid = _require_geom(parentId)
    if pid == gid or pid in geom_descendants(gid):
        raise RpcError("a geometry cannot be parented under itself or its own descendants")
    vsp.SetGeomParent(gid, pid)
    vsp.Update()
    if vsp.GetGeomParent(gid) != pid:
        raise RpcError("reparent failed")
    return model_state()


@method("geom.setShown", mutates=True)
def geom_set_shown(ids: list[str], shown: bool) -> dict:
    for gid in _require_ids(ids):
        vsp.SetSetFlag(gid, vsp.SET_SHOWN, bool(shown))
    vsp.Update()
    return model_state()


@method("geom.setColor", mutates=True)
def geom_set_color(id: str, color: list[float]) -> dict:
    gid = _require_geom(id)
    if not isinstance(color, (list, tuple)) or len(color) != 3:
        raise RpcError("color must be [r, g, b] in 0..1")
    r, g, b = [int(round(min(1.0, max(0.0, float(c))) * 255)) for c in color]
    vsp.SetGeomWireColor(gid, r, g, b)
    return model_state()


@method("geom.parms")
def geom_parms(id: str) -> list[dict]:
    gid = _require_geom(id)
    # XSec* groups (curve/background editors) belong to the cross-section editor.
    # The plain "XSec" group holds wing/prop planform parms (Span, Root_Chord...), so it stays.
    pids = list(vsp.FindContainerParmIDs(gid))
    groups = {vsp.GetParmGroupName(p) for p in pids}  # FindContainerGroupNames is empty for geoms
    excluded = {g for g in groups if g.startswith("XSec") and g != "XSec"}
    return group_parms(pids, exclude_groups=excluded)
