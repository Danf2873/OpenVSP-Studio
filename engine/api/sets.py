"""sets.* : geometry sets (the Set Editor / show-hide sets)."""
from __future__ import annotations

from engine.vspctx import vsp
from engine.registry import method, RpcError


def _set_list() -> list[dict]:
    return [{"index": i, "name": vsp.GetSetName(i)} for i in range(vsp.GetNumSets())]


@method("sets.list")
def sets_list() -> list[dict]:
    return _set_list()


@method("sets.rename", mutates=True)
def sets_rename(index: int, name: str) -> None:
    if not (0 <= index < vsp.GetNumSets()):
        raise RpcError(f"no set at index {index}")
    vsp.SetSetName(index, name)


@method("sets.matrix")
def sets_matrix() -> dict:
    sets = _set_list()
    rows = []
    for gid in vsp.FindGeoms():
        flags = [bool(vsp.GetSetFlag(gid, s["index"])) for s in sets]
        rows.append({"geomId": gid, "name": vsp.GetGeomName(gid), "flags": flags})
    return {"sets": sets, "rows": rows}


@method("sets.setFlag", mutates=True)
def sets_set_flag(geomId: str, index: int, value: bool) -> None:
    if not (0 <= index < vsp.GetNumSets()):
        raise RpcError(f"no set at index {index}")
    vsp.SetSetFlag(geomId, index, bool(value))


@method("sets.show", mutates=True)
def sets_show(index: int) -> None:
    vsp.ShowSet(index)


@method("sets.hide", mutates=True)
def sets_hide(index: int) -> None:
    vsp.NoShowSet(index)


@method("sets.showOnly", mutates=True)
def sets_show_only(index: int) -> None:
    vsp.ShowOnlySet(index)
