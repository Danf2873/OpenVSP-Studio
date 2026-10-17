"""links.* : Advanced Links (the Advanced Linker / link script editor)."""
from __future__ import annotations

from engine.vspctx import vsp
from engine.registry import method, RpcError
from engine.parmutil import parm_dict


def _check_index(index: int) -> None:
    if not (0 <= index < len(vsp.GetAdvLinkNames())):
        raise RpcError(f"no advanced link at index {index}")


def _pairs(names: list[str], parms: list[str]) -> list[dict]:
    return [{"var": v, "parm": parm_dict(p)} for v, p in zip(names, parms)]


@method("links.list")
def links_list() -> list[dict]:
    return [{"index": i, "name": n} for i, n in enumerate(vsp.GetAdvLinkNames())]


@method("links.get")
def links_get(index: int) -> dict:
    _check_index(index)
    return {
        "index": index,
        "name": vsp.GetAdvLinkName(index),
        "code": vsp.GetAdvLinkCode(index),
        "inputs": _pairs(vsp.GetAdvLinkInputNames(index), vsp.GetAdvLinkInputParms(index)),
        "outputs": _pairs(vsp.GetAdvLinkOutputNames(index), vsp.GetAdvLinkOutputParms(index)),
    }


@method("links.add", mutates=True)
def links_add(name: str) -> None:
    vsp.AddAdvLink(name)


@method("links.delete", mutates=True)
def links_delete(index: int) -> None:
    _check_index(index)
    vsp.DelAdvLink(index)


@method("links.rename", mutates=True)
def links_rename(index: int, name: str) -> None:
    _check_index(index)
    vsp.SetAdvLinkName(index, name)


@method("links.setCode", mutates=True)
def links_set_code(index: int, code: str) -> None:
    _check_index(index)
    vsp.SetAdvLinkCode(index, code)


@method("links.addInput", mutates=True)
def links_add_input(index: int, parmId: str, var: str) -> None:
    _check_index(index)
    vsp.AddAdvLinkInput(index, parmId, var)


@method("links.addOutput", mutates=True)
def links_add_output(index: int, parmId: str, var: str) -> None:
    _check_index(index)
    vsp.AddAdvLinkOutput(index, parmId, var)


@method("links.removeInput", mutates=True)
def links_remove_input(index: int, var: str) -> None:
    _check_index(index)
    vsp.DelAdvLinkInput(index, var)


@method("links.removeOutput", mutates=True)
def links_remove_output(index: int, var: str) -> None:
    _check_index(index)
    vsp.DelAdvLinkOutput(index, var)


@method("links.build")
def links_build(index: int) -> dict:
    _check_index(index)
    # Drain stale errors so the message describes only this build.
    em = vsp.ErrorMgrSingleton.getInstance()
    while em.GetNumTotalErrors() > 0:
        em.PopLastError()
    ok = bool(vsp.BuildAdvLinkScript(index))
    messages = []
    while em.GetNumTotalErrors() > 0:
        messages.append(em.PopLastError().GetErrorString())
    if ok:
        message = "Build OK"
    else:
        message = "\n".join(messages) if messages else "Build failed"
    return {"ok": ok, "message": message}
