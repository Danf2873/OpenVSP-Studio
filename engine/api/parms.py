"""parms.* : generic parameter access for any container (geom, xsec, settings...)."""
from __future__ import annotations

from engine import parmmeta
from engine.registry import method, RpcError
from engine.vspctx import vsp
from engine.parmutil import parm_dict, group_parms
from engine.state import geom_descendants


def _require_container(cid) -> str:
    if not isinstance(cid, str) or cid not in set(vsp.FindContainers()):
        raise RpcError(f"no parm container with id {cid!r}")
    return cid


def _require_parm(pid) -> str:
    if not isinstance(pid, str) or not vsp.GetParmContainer(pid):
        raise RpcError(f"no parm with id {pid!r}")
    return pid


def _owner_geom(cid: str) -> str | None:
    """Geom that owns a container: the geom itself, or the geom holding the xsec surface/xsec."""
    geoms = list(vsp.FindGeoms())
    if cid in geoms:
        return cid
    for g in geoms:
        for s in range(vsp.GetNumXSecSurfs(g)):
            xs = vsp.GetXSecSurf(g, s)
            if xs == cid:
                return g
            for k in range(vsp.GetNumXSec(xs)):
                if vsp.GetXSec(xs, k) == cid:
                    return g
    return None


def _dirty_geoms(cid: str) -> list[str]:
    owner = _owner_geom(cid)
    if owner is None:
        return list(vsp.FindGeoms())  # not owned by a geom (settings, vehicle, ...): everything may change
    return [owner] + geom_descendants(owner)


@method("parms.list")
def parms_list(containerId: str) -> list[dict]:
    _require_container(containerId)
    return group_parms(list(vsp.FindContainerParmIDs(containerId)))


@method("parms.get")
def parms_get(ids: list[str]) -> list[dict]:
    if not isinstance(ids, (list, tuple)):
        raise RpcError("ids must be a list")
    return [parm_dict(_require_parm(pid)) for pid in ids]


@method("parms.set", mutates=True)
def parms_set(id: str, value: float) -> dict:
    _require_parm(id)
    cid = vsp.GetParmContainer(id)
    siblings = list(vsp.FindContainerParmIDs(cid))
    before = {p: vsp.GetParmVal(p) for p in siblings}
    vsp.SetParmValUpdate(id, float(value))
    after = {p: vsp.GetParmVal(p) for p in siblings}
    changed = [{"id": p, "value": after[p]} for p in siblings if p != id and after[p] != before[p]]
    return {"parm": parm_dict(id), "changed": changed, "dirtyGeoms": _dirty_geoms(cid)}


@method("parms.containers")
def parms_containers() -> list[dict]:
    return [{"id": c, "name": vsp.GetContainerName(c)} for c in vsp.FindContainers()]


@method("parms.search")
def parms_search(query: str, limit: int = 200) -> list[dict]:
    q = (query or "").strip().lower()
    cap = max(1, int(limit))
    out: list[dict] = []
    for cid in vsp.FindContainers():
        cname = vsp.GetContainerName(cid)
        for pid in vsp.FindContainerParmIDs(cid):
            name = vsp.GetParmName(pid)
            group = vsp.GetParmGroupName(pid)
            label = parmmeta.meta_for(name, group).get("label", name)
            haystack = (name, label, group, cname)
            if any(q in h.lower() for h in haystack):
                out.append({"parm": parm_dict(pid), "containerId": cid, "containerName": cname})
                if len(out) >= cap:
                    return out
    return out
