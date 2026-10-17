"""Curated, human-friendly metadata for common OpenVSP parms.

Interface (used by engine/parmutil.py; keep these signatures):
    meta_for(name, group) -> dict   # subset of {label, units, options, bitmask, advanced}
    group_label(group) -> str
    group_sort_key(group) -> tuple

Unknown parms/groups MUST still work (return {} / the raw name / sort last).

Enum option values come from the real vsp.* constants (verified against the
3.54 build), not hardcoded numbers. Note the planar symmetry bits are
XY=1, XZ=2, YZ=4 (not 2/4/8 as first assumed).
"""
from __future__ import annotations

from engine.vspctx import vsp

GROUP_ORDER = [
    "XForm", "Sym", "Design", "Shape", "WingGeom", "Attach", "Mass_Props",
    "Negative_Volume_Props", "EndCap", "Cap", "Skinning", "Blending", "Index",
]
GROUP_LABELS = {
    "XForm": "Transform", "Sym": "Symmetry", "Mass_Props": "Mass", "WingGeom": "Wing",
    "Negative_Volume_Props": "Negative volume", "EndCap": "End caps",
    "ParasiteDragProps": "Parasite drag", "WakeSettings": "Wake", "BBox": "Bounding box",
}
# (name) or (group, name) -> meta
PARMS: dict = {}


def _opts(*pairs):
    return [{"value": int(v), "label": lbl} for v, lbl in pairs]


def _p(key, label=None, units=None, options=None, bitmask=None, advanced=None):
    meta = {}
    if label is not None:
        meta["label"] = label
    if units is not None:
        meta["units"] = units
    if options is not None:
        meta["options"] = options
    if bitmask is not None:
        meta["bitmask"] = bitmask
    if advanced is not None:
        meta["advanced"] = advanced
    PARMS[key] = meta


# --- Transform (XForm) -------------------------------------------------------
_p(("XForm", "X_Location"), "X", "length")
_p(("XForm", "Y_Location"), "Y", "length")
_p(("XForm", "Z_Location"), "Z", "length")
_p(("XForm", "X_Rotation"), "Rotation X", "deg")
_p(("XForm", "Y_Rotation"), "Rotation Y", "deg")
_p(("XForm", "Z_Rotation"), "Rotation Z", "deg")
_p(("XForm", "X_Rel_Location"), "X (relative)", "length")
_p(("XForm", "Y_Rel_Location"), "Y (relative)", "length")
_p(("XForm", "Z_Rel_Location"), "Z (relative)", "length")
_p(("XForm", "X_Rel_Rotation"), "Rotation X (relative)", "deg")
_p(("XForm", "Y_Rel_Rotation"), "Rotation Y (relative)", "deg")
_p(("XForm", "Z_Rel_Rotation"), "Rotation Z (relative)", "deg")
_p(("XForm", "Scale"), "Scale")
_p(("XForm", "Origin"), "Origin", advanced=True)
_p(("XForm", "Last_Scale"), "Previous scale", advanced=True)
_p("Abs_Or_Relitive_flag", "Absolute location", advanced=True)

# --- Symmetry ------------------------------------------------------------------
_p("Sym_Planar_Flag", "Mirror planes", bitmask=True, options=_opts(
    (vsp.SYM_XY, "XY plane"), (vsp.SYM_XZ, "XZ plane"), (vsp.SYM_YZ, "YZ plane")))
_p("Sym_Axial_Flag", "Axial symmetry", bitmask=False, options=_opts(
    (0, "None"), (vsp.SYM_ROT_X, "About X axis"),
    (vsp.SYM_ROT_Y, "About Y axis"), (vsp.SYM_ROT_Z, "About Z axis")))
_p("Sym_Rot_N", "Axial copies")
_p("Sym_Ancestor", advanced=True)
_p("Sym_Ancestor_Origin_Flag", advanced=True)
_p("Flip_Flag", "Flip", advanced=True)

# --- Mass ----------------------------------------------------------------------
_p("Density", "Density", "mass/volume")
_p("Mass_Area", "Mass per area", "mass/area")
_p("PointMass", "Point mass", "mass")
_p("CGx", "CG X", "length", advanced=True)
_p("CGy", "CG Y", "length", advanced=True)
_p("CGz", "CG Z", "length", advanced=True)
_p("Ixx", "Ixx", advanced=True)
_p("Iyy", "Iyy", advanced=True)
_p("Izz", "Izz", advanced=True)
_p("Ixy", "Ixy", advanced=True)
_p("Ixz", "Ixz", advanced=True)
_p("Iyz", "Iyz", advanced=True)
_p("Mass_Prior", advanced=True)
_p("Shell_Flag", "Shell only", advanced=True)

# --- End caps (EndCap group; same names used for min-U / max-U) --------------
_CAP_OPTIONS = _opts(
    (vsp.NO_END_CAP, "None"), (vsp.FLAT_END_CAP, "Flat"), (vsp.ROUND_END_CAP, "Round"),
    (vsp.EDGE_END_CAP, "Edge"), (vsp.SHARP_END_CAP, "Sharp"), (vsp.POINT_END_CAP, "Point"),
)
_p("CapUMinOption", "Min-U end cap", options=_CAP_OPTIONS)
_p("CapUMaxOption", "Max-U end cap", options=_CAP_OPTIONS)
_p("CapUMinLength", "Min-U cap length", "length")
_p("CapUMaxLength", "Max-U cap length", "length")
_p("CapUMinOffset", "Min-U cap offset", advanced=True)
_p("CapUMaxOffset", "Max-U cap offset", advanced=True)
_p("CapUMinStrength", "Min-U cap strength", advanced=True)
_p("CapUMaxStrength", "Max-U cap strength", advanced=True)
_p("CapUMinSweepFlag", "Min-U cap sweep", advanced=True)
_p("CapUMaxSweepFlag", "Max-U cap sweep", advanced=True)
_p("CapUMinTess", "Min-U cap tessellation", advanced=True)

# --- Shape / tessellation --------------------------------------------------------
_p("Tess_U", "Tessellation U", advanced=True)
_p("Tess_W", "Tessellation W", advanced=True)
_p("Wake", "Wake", advanced=True)

# --- Bounding box (read-only results, advanced) ------------------------------------
_p(("BBox", "X_Len"), "Bounding box X", "length", advanced=True)
_p(("BBox", "Y_Len"), "Bounding box Y", "length", advanced=True)
_p(("BBox", "Z_Len"), "Bounding box Z", "length", advanced=True)
_p(("BBox", "X_Min"), "Bounding box min X", "length", advanced=True)
_p(("BBox", "Y_Min"), "Bounding box min Y", "length", advanced=True)
_p(("BBox", "Z_Min"), "Bounding box min Z", "length", advanced=True)

# --- Body / design ----------------------------------------------------------------
_p("Length", "Length", "length")
_p("FineRatio", "Fineness ratio")
_p("Diameter", "Diameter", "length")

# --- Wing planform (XSec group holds planform parms for wings and props) ----------
_p("Span", "Span", "length")
_p("ProjectedSpan", "Projected span", "length")
_p("Root_Chord", "Root chord", "length")
_p("Tip_Chord", "Tip chord", "length")
_p("Avg_Chord", "Average chord", "length")
_p("Aspect", "Aspect ratio")
_p("Taper", "Taper")
_p("Area", "Area", "area")
_p("Sweep", "Sweep", "deg")
_p("Sec_Sweep", "Section sweep", "deg")
_p("Dihedral", "Dihedral", "deg")
_p("Twist", "Twist", "deg")
_p("Twist_Location", "Twist location", "fraction")
_p("SectTess_U", "Section tessellation", advanced=True)
_p("InLESweep", advanced=True)
_p("InTESweep", advanced=True)
_p("OutLESweep", advanced=True)
_p("OutTESweep", advanced=True)
_p("InLEDihedral", advanced=True)
_p("InTEDihedral", advanced=True)
_p("OutLEDihedral", advanced=True)
_p("OutTEDihedral", advanced=True)
_p("InLEStrength", advanced=True)
_p("InTEStrength", advanced=True)
_p("OutLEStrength", advanced=True)
_p("OutTEStrength", advanced=True)

# --- Wing geometry summaries (WingGeom group) -------------------------------------
_p(("WingGeom", "TotalSpan"), "Total span", "length")
_p(("WingGeom", "TotalProjectedSpan"), "Total projected span", "length")
_p(("WingGeom", "TotalChord"), "Total chord", "length")
_p(("WingGeom", "TotalArea"), "Total area", "area")
_p(("WingGeom", "TotalAR"), "Total aspect ratio")
_p(("WingGeom", "MAC"), "Mean aerodynamic chord", "length")
_p(("WingGeom", "CurvedArea"), "Curved area", "area", advanced=True)
_p(("WingGeom", "LECluster"), "Leading-edge cluster", advanced=True)
_p(("WingGeom", "TECluster"), "Trailing-edge cluster", advanced=True)
_p(("WingGeom", "SmallPanelW"), advanced=True)
_p(("WingGeom", "MaxGrowth"), "Max panel growth", advanced=True)
_p(("WingGeom", "RelativeDihedralFlag"), "Relative dihedral")
_p(("WingGeom", "RelativeTwistFlag"), "Relative twist")
_p(("WingGeom", "RotateAirfoilMatchDideralFlag"), "Rotate airfoil to match dihedral", advanced=True)
_p(("WingGeom", "CorrectAirfoilthicknessFlag"), "Correct airfoil thickness", advanced=True)
_p(("WingGeom", "TwistAllInXZPlaneFlag"), "Twist in XZ plane", advanced=True)

# --- Attachment (advanced; surface-attach parms) ----------------------------------
_p("Trans_Attach_Flag", "Attach translation", advanced=True)
_p("Rots_Attach_Flag", "Attach rotation", advanced=True)
_p("U_Attach_Location", "Attach U", advanced=True)
_p("V_Attach_Location", "Attach V", advanced=True)
_p("W_Attach_Location", "Attach W", advanced=True)

# --- Parasite drag (advanced) ------------------------------------------------------
_p(("ParasiteDragProps", "PercLam"), "Percent laminar", advanced=True)
_p(("ParasiteDragProps", "Roughness"), "Surface roughness", advanced=True)
_p(("ParasiteDragProps", "TeTwRatio"), "Trailing-edge thickness ratio", advanced=True)


def meta_for(name: str, group: str) -> dict:
    return dict(PARMS.get((group, name)) or PARMS.get(name) or {})


def group_label(group: str) -> str:
    return GROUP_LABELS.get(group, group.replace("_", " "))


def group_sort_key(group: str) -> tuple:
    return (GROUP_ORDER.index(group) if group in GROUP_ORDER else len(GROUP_ORDER), group)
