"""Shared helpers turning OpenVSP parm ids into the `Parm` / `ParmGroup` JSON
shapes defined in docs/API.md. Every module that returns parms uses these."""
from __future__ import annotations

from engine.vspctx import vsp
from engine import parmmeta

_LIM = 1e12

_TYPES = {
    vsp.PARM_DOUBLE_TYPE: "double",
    vsp.PARM_INT_TYPE: "int",
    vsp.PARM_BOOL_TYPE: "bool",
    vsp.PARM_FRACTION_TYPE: "fraction",
    vsp.PARM_LIMITED_INT_TYPE: "limited_int",
    vsp.PARM_NOTEQ_TYPE: "noteq",
    vsp.PARM_POWER_INT_TYPE: "power_int",
}


def _clamp(x: float) -> float:
    return max(-_LIM, min(_LIM, float(x)))


def parm_dict(pid: str) -> dict:
    name = vsp.GetParmName(pid)
    group = vsp.GetParmGroupName(pid)
    d = {
        "id": pid,
        "name": name,
        "group": group,
        "label": name,
        "value": vsp.GetParmVal(pid),
        "type": _TYPES.get(vsp.GetParmType(pid), "other"),
        "min": _clamp(vsp.GetParmLowerLimit(pid)),
        "max": _clamp(vsp.GetParmUpperLimit(pid)),
        "descr": vsp.GetParmDescript(pid),
    }
    d.update(parmmeta.meta_for(name, group))  # label/units/options/bitmask/advanced
    return d


def group_parms(pids: list[str], exclude_groups: set[str] | None = None) -> list[dict]:
    """Bucket parm ids into ParmGroup[] ordered by parmmeta.group_order."""
    buckets: dict[str, list[dict]] = {}
    for pid in pids:
        g = vsp.GetParmGroupName(pid)
        if exclude_groups and g in exclude_groups:
            continue
        buckets.setdefault(g, []).append(parm_dict(pid))
    ordered = sorted(buckets, key=parmmeta.group_sort_key)
    return [{"group": g, "label": parmmeta.group_label(g), "parms": buckets[g]} for g in ordered]
