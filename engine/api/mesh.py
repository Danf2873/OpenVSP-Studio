"""mesh.* : tessellated surfaces for the 3D view, and cross-section rings.

Coordinate frames (verified against OpenVSP 3.54):
- CompVecPnt01 / CompVecNorm01 return GLOBAL coordinates (they include the geom
  transform; X_Rel_Location moves them).
- ComputeXSecPnt returns LOCAL coordinates of the xsec surface. Its
  GetXSecSurfGlobalXForm matrix does NOT include the geom transform (translation
  stays 0 when the geom moves), so applying it gives the wrong place.
- Therefore xsecRing samples the tessellation surface at the station of each
  cross-section (u01 = index/(numXSecs-1), which maps linearly onto the
  stations) and sweeps w01 around the profile. That yields global points.
"""
from __future__ import annotations

import base64
import math
import sys
from array import array

from engine.registry import method, RpcError
from engine.vspctx import vsp


def _require_geom(gid) -> str:
    if not isinstance(gid, str) or gid not in set(vsp.FindGeoms()):
        raise RpcError(f"no geometry with id {gid!r}")
    return gid


def _u32_array(values) -> array:
    # 'I' is 4 bytes on all supported platforms; checked once here.
    if array("I").itemsize != 4:  # pragma: no cover
        raise RuntimeError("unsigned int is not 4 bytes on this platform")
    return array("I", values)


def _b64(arr: array) -> str:
    if sys.byteorder == "big":  # binary payload is little-endian
        arr = array(arr.typecode, arr)
        arr.byteswap()
    return base64.b64encode(arr.tobytes()).decode("ascii")


def _grid_triangles(nu: int, nw: int):
    tris = []
    for i in range(nu - 1):
        for j in range(nw - 1):
            a = i * nw + j
            b = (i + 1) * nw + j
            c = (i + 1) * nw + j + 1
            d = i * nw + j + 1
            tris.append((a, b, c))
            tris.append((a, c, d))
    return tris


def _fill_degenerate_normals(pts, normals, tris) -> None:
    """CompVecNorm01 returns zero vectors where dP/dw vanishes (sharp LE/TE).
    Replace those with the average of adjacent triangle normals."""
    acc = [[0.0, 0.0, 0.0] for _ in pts]
    for a, b, c in tris:
        pa, pb, pc = pts[a], pts[b], pts[c]
        ux, uy, uz = pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]
        vx, vy, vz = pc[0] - pa[0], pc[1] - pa[1], pc[2] - pa[2]
        n = (uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx)
        for v in (a, b, c):
            acc[v][0] += n[0]
            acc[v][1] += n[1]
            acc[v][2] += n[2]
    for i, n in enumerate(normals):
        if math.sqrt(n[0] * n[0] + n[1] * n[1] + n[2] * n[2]) < 1e-9:
            x, y, z = acc[i]
            length = math.sqrt(x * x + y * y + z * z)
            normals[i] = (x / length, y / length, z / length) if length > 1e-12 else (0.0, 0.0, 1.0)


def _surface_mesh(gid: str, s: int):
    us, ws = vsp.GetUWTess01(gid, s)
    us, ws = list(us), list(ws)
    nu, nw = len(us), len(ws)
    if nu < 2 or nw < 2:
        return None
    U = [u for u in us for _ in range(nw)]
    W = ws * nu  # index = i * nw + j
    pts_vec = vsp.CompVecPnt01(gid, s, U, W)
    pts = [(p.x(), p.y(), p.z()) for p in pts_vec]
    nrm_vec = vsp.CompVecNorm01(gid, s, U, W)
    normals = [(n.x(), n.y(), n.z()) for n in nrm_vec]

    tris = _grid_triangles(nu, nw)
    _fill_degenerate_normals(pts, normals, tris)

    positions = array("f")
    for p in pts:
        positions.extend(p)
    normal_arr = array("f")
    for n in normals:
        normal_arr.extend(n)
    indices = _u32_array(v for t in tris for v in t)
    wire = array("I")
    for i in range(nu):
        for j in range(nw - 1):
            wire.extend((i * nw + j, i * nw + j + 1))
    for i in range(nu - 1):
        for j in range(nw):
            wire.extend((i * nw + j, (i + 1) * nw + j))

    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    zs = [p[2] for p in pts]
    bounds = ([min(xs), min(ys), min(zs)], [max(xs), max(ys), max(zs)])
    encoded = {
        "positions": _b64(positions),
        "normals": _b64(normal_arr),
        "indices": _b64(indices),
        "wire": _b64(wire),
    }
    return encoded, bounds


@method("mesh.get")
def mesh_get(ids: list[str] | None = None) -> dict:
    if ids is None:
        targets = [g for g in vsp.FindGeoms() if vsp.GetSetFlag(g, vsp.SET_SHOWN)]
    else:
        targets = [_require_geom(g) for g in ids]

    meshes = []
    for gid in targets:
        surfaces = []
        mn = [math.inf] * 3
        mx = [-math.inf] * 3
        for s in range(vsp.GetTotalNumSurfs(gid)):
            res = _surface_mesh(gid, s)
            if res is None:
                continue
            encoded, (smin, smax) = res
            surfaces.append(encoded)
            for k in range(3):
                mn[k] = min(mn[k], smin[k])
                mx[k] = max(mx[k], smax[k])
        if not surfaces:
            mn, mx = [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]
        meshes.append({"geomId": gid, "surfaces": surfaces, "bbox": {"min": mn, "max": mx}})
    return {"meshes": meshes}


@method("mesh.xsecRing")
def mesh_xsec_ring(geomId: str, surf: int, index: int, n: int = 96) -> dict:
    gid = _require_geom(geomId)
    surf = int(surf)
    index = int(index)
    if not (0 <= surf < vsp.GetNumXSecSurfs(gid)):
        raise RpcError(f"geometry {gid} has no xsec surface {surf}")
    xsurf = vsp.GetXSecSurf(gid, surf)
    count = vsp.GetNumXSec(xsurf)
    if not (0 <= index < count):
        raise RpcError(f"xsec index {index} out of range (0..{count - 1})")
    n = max(8, int(n))
    u01 = index / (count - 1) if count > 1 else 0.0
    ws = [k / n for k in range(n + 1)]  # w=1 repeats w=0: the ring closes
    pts = vsp.CompVecPnt01(gid, surf, [u01] * (n + 1), ws)
    return {"points": [[p.x(), p.y(), p.z()] for p in pts]}
