"""Locate the OpenVSP install and import the `openvsp` Python package.

Usage everywhere in the engine:  `from engine.vspctx import vsp, VSP_ROOT`

The OpenVSP root is the parent of `openvsp_gui/` unless OPENVSP_ROOT is set.
"""
from __future__ import annotations

import os
import sys

VSP_ROOT = os.environ.get("OPENVSP_ROOT") or os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..")
)

for sub in ("python/openvsp", "python/degen_geom", "python/utilities"):
    p = os.path.join(VSP_ROOT, *sub.split("/"))
    if p not in sys.path:
        sys.path.insert(0, p)

# The OpenVSP .pyd files need the MSVC/OpenMP runtimes shipped in the install
# root; a bundled embeddable Python does not search there by default.
if hasattr(os, "add_dll_directory") and os.path.isdir(VSP_ROOT):
    os.add_dll_directory(VSP_ROOT)

import openvsp as vsp  # noqa: E402

vsp.VSPCheckSetup()
# Point VSPAERO & friends at the bundled executables in the install root.
vsp.SetVSPAEROPath(VSP_ROOT)
