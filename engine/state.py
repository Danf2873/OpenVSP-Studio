"""Model-wide state shared across api modules (file path, dirty flag, undo
availability) plus the ModelState / GeomNode builders from docs/API.md.

engine/api/model.py owns the undo stacks and updates STATE; everyone else just
calls model_state() to build a response.
"""
from __future__ import annotations

from engine.vspctx import vsp

STATE = {"file": None, "dirty": False, "canUndo": False, "canRedo": False}


def all_geoms() -> list[str]:
    return list(vsp.FindGeoms())


def geom_descendants(gid: str) -> list[str]:
    out, stack = [], list(vsp.GetGeomChildren(gid))
    while stack:
        c = stack.pop()
        out.append(c)
        stack.extend(vsp.GetGeomChildren(c))
    return out


def geom_node(gid: str) -> dict:
    parent = vsp.GetGeomParent(gid)
    c = vsp.GetGeomWireColor(gid)
    shown = vsp.GetSetFlag(gid, vsp.SET_SHOWN)
    return {
        "id": gid,
        "name": vsp.GetGeomName(gid),
        "type": vsp.GetGeomTypeName(gid),
        "parentId": parent if parent and parent != "NONE" else None,
        "children": list(vsp.GetGeomChildren(gid)),
        "shown": bool(shown),
        "numXSecSurfs": vsp.GetNumXSecSurfs(gid),
        "color": [c.x() / 255.0, c.y() / 255.0, c.z() / 255.0],
    }


def model_state() -> dict:
    geoms = all_geoms()
    ids = set(geoms)
    nodes = {g: geom_node(g) for g in geoms}
    ordered: list[dict] = []

    def visit(g):
        ordered.append(nodes[g])
        for c in nodes[g]["children"]:
            if c in nodes:
                visit(c)

    for g in geoms:
        if not nodes[g]["parentId"] or nodes[g]["parentId"] not in ids:
            visit(g)
    return {**STATE, "geoms": ordered}
