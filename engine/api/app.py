"""app.* : install-level information (version, enums, analyses, examples)."""
from __future__ import annotations

import os

from engine.registry import method
from engine.vspctx import vsp, VSP_ROOT

# Friendly names for vsp.XS_* shape constants. The XS_SHIFT_* constants are not
# shape types (they share values with XS_POINT etc.), so they are excluded.
XS_NAMES = {
    "XS_POINT": "Point",
    "XS_CIRCLE": "Circle",
    "XS_ELLIPSE": "Ellipse",
    "XS_SUPER_ELLIPSE": "Super Ellipse",
    "XS_ROUNDED_RECTANGLE": "Rounded Rectangle",
    "XS_GENERAL_FUSE": "General Fuselage",
    "XS_FILE_FUSE": "File Fuselage",
    "XS_FOUR_SERIES": "NACA 4-Series",
    "XS_FOUR_DIGIT_MOD": "NACA 4-Digit Modified",
    "XS_FIVE_DIGIT": "NACA 5-Digit",
    "XS_FIVE_DIGIT_MOD": "NACA 5-Digit Modified",
    "XS_SIX_SERIES": "NACA 6-Series",
    "XS_ONE_SIX_SERIES": "NACA 1-6 Series",
    "XS_WEDGE": "Wedge",
    "XS_BICONVEX": "Biconvex",
    "XS_EDIT_CURVE": "Edit Curve",
    "XS_CST_AIRFOIL": "CST Airfoil",
    "XS_FILE_AIRFOIL": "File Airfoil",
    "XS_VKT_AIRFOIL": "VKT Airfoil",
    "XS_AC25_773": "AC 25.773 Airfoil",
}

IMPORT_INFO = {
    "IMPORT_STL": ("STL", ".stl"),
    "IMPORT_CART3D_TRI": ("Cart3D Triangulation", ".tri"),
    "IMPORT_NASCART": ("NASCART", ".dat"),
    "IMPORT_XSEC_MESH": ("XSec Mesh", ".hrm"),
    "IMPORT_XSEC_WIRE": ("XSec Wire", ".hrm"),
    "IMPORT_PTS": ("Point Cloud", ".pts"),
    "IMPORT_V2": ("V2", ".v2"),
    "IMPORT_BEM": ("BEM", ".bem"),
    "IMPORT_P3D_WIRE": ("PLOT3D Wire", ".p3d"),
}

EXPORT_INFO = {
    "EXPORT_AWAVE": ("AWAVE", ".awave"),
    "EXPORT_BEM": ("BEM", ".bem"),
    "EXPORT_BEZIER_AIRFOIL": ("Bezier Airfoil", ".bz"),
    "EXPORT_CART3D": ("Cart3D", ".tri"),
    "EXPORT_DXF": ("DXF", ".dxf"),
    "EXPORT_FACET": ("Facet", ".facet"),
    "EXPORT_FELISA": ("FELISA", ".fel"),
    "EXPORT_GMSH": ("GMSH", ".msh"),
    "EXPORT_IGES": ("IGES", ".igs"),
    "EXPORT_IGES_STITCH": ("IGES (stitched)", ".igs"),
    "EXPORT_IGES_STRUCTURE": ("IGES (structure)", ".igs"),
    "EXPORT_NASCART": ("NASCART", ".dat"),
    "EXPORT_OBJ": ("OBJ", ".obj"),
    "EXPORT_PLOT3D": ("PLOT3D", ".p3d"),
    "EXPORT_PMARC": ("PMARC", ".pmin"),
    "EXPORT_POVRAY": ("POV-Ray", ".pov"),
    "EXPORT_SELIG_AIRFOIL": ("Selig Airfoil", ".dat"),
    "EXPORT_STEP": ("STEP", ".stp"),
    "EXPORT_STEP_STITCH": ("STEP (stitched)", ".stp"),
    "EXPORT_STEP_STRUCTURE": ("STEP (structure)", ".stp"),
    "EXPORT_STL": ("STL", ".stl"),
    "EXPORT_SVG": ("SVG", ".svg"),
    "EXPORT_VORXSEC": ("VORXSEC", ".vorxsec"),
    "EXPORT_VSPGEOM": ("VSPGEOM", ".vspgeom"),
    "EXPORT_X3D": ("X3D", ".x3d"),
    "EXPORT_XSEC": ("XSec", ".xsec"),
    "EXPORT_XSECGEOM": ("XSec Geometry", ".xsecgeom"),
}

_GEOMETRY = {
    "CompGeom", "MassProp", "PlanarSlice", "Projection", "GeometryAnalysis",
    "SurfaceIntersection", "DegenGeom", "DegenGeomMesh",
}
_AERO_EXACT = {"ParasiteDrag", "WaveDrag", "EmintonLord", "CpSlicer", "BladeElement"}
_MESH = {"CfdMeshAnalysis", "FeaMeshAnalysis", "FeaMeshExport", "SurfacePatches"}


def _analysis_group(name: str) -> str:
    if name in _GEOMETRY:
        return "Geometry"
    if name.startswith("VSPAERO") or name in _AERO_EXACT or any(name.startswith(p) for p in _AERO_EXACT):
        return "Aero"
    if name in _MESH:
        return "Mesh"
    return "Other"


def _enum_list(prefix: str, info: dict) -> list[dict]:
    out = []
    for const in sorted(d for d in dir(vsp) if d.startswith(prefix)):
        if const in info:
            friendly, ext = info[const]
        else:
            friendly, ext = const[len(prefix):].replace("_", " ").title(), ""
        out.append({"value": int(getattr(vsp, const)), "name": friendly, "ext": ext})
    return out


def _examples() -> list[dict]:
    out = []
    for sub in ("vspaero_ex", "airfoil"):
        base = os.path.join(VSP_ROOT, sub)
        if not os.path.isdir(base):
            continue
        for dirpath, _dirs, files in os.walk(base):
            for f in files:
                if f.lower().endswith(".vsp3"):
                    full = os.path.join(dirpath, f)
                    rel = os.path.relpath(full, base).replace(os.sep, "/")
                    out.append({"name": rel[: -len(".vsp3")], "path": full})
    out.sort(key=lambda e: e["name"].lower())
    return out


@method("app.info")
def info() -> dict:
    xs = []
    for const in sorted(d for d in dir(vsp) if d.startswith("XS_")):
        if const in ("XS_UNDEFINED", "XS_NUM_TYPES") or const.startswith("XS_SHIFT_"):
            continue
        xs.append({"value": int(getattr(vsp, const)), "name": XS_NAMES.get(const, const[3:].replace("_", " ").title())})
    return {
        "version": vsp.GetVSPVersion(),
        "vspRoot": VSP_ROOT,
        "geomTypes": list(vsp.GetGeomTypes()),
        "analyses": [{"name": a, "group": _analysis_group(a)} for a in vsp.ListAnalysis()],
        "xsecShapes": xs,
        "importFormats": _enum_list("IMPORT_", IMPORT_INFO),
        "exportFormats": _enum_list("EXPORT_", EXPORT_INFO),
        "examples": _examples(),
    }


@method("app.ping")
def ping() -> str:
    return "pong"


@method("app.fileDialog")
def file_dialog(mode: str = "open", title: str | None = None, filters: list | None = None,
                multiple: bool = False, defaultPath: str | None = None):
    """Native file dialog for browser mode (the Tauri app uses its own dialogs).

    Returns a path, a list of paths (multiple), or None when cancelled.
    """
    import tkinter
    from tkinter import filedialog

    types = [(f.get("name", "Files"), " ".join(f"*.{e}" for e in f.get("extensions", []))) for f in (filters or [])]
    types.append(("All files", "*.*"))
    root = tkinter.Tk()
    root.withdraw()
    root.attributes("-topmost", True)
    try:
        kw = {"parent": root, "title": title or ("Save as" if mode == "save" else "Open"), "filetypes": types}
        if defaultPath:
            kw["initialdir"] = os.path.dirname(defaultPath) or None
            kw["initialfile"] = os.path.basename(defaultPath)
        if mode == "save":
            ext = (filters or [{}])[0].get("extensions", [""])[0] if filters else ""
            path = filedialog.asksaveasfilename(defaultextension=f".{ext}" if ext else "", **kw)
            return os.path.normpath(path) if path else None
        if multiple:
            paths = filedialog.askopenfilenames(**kw)
            return [os.path.normpath(p) for p in paths] if paths else None
        path = filedialog.askopenfilename(**kw)
        return os.path.normpath(path) if path else None
    finally:
        root.destroy()
