"""Importing this package registers every RPC method in engine.registry.METHODS."""
import importlib

MODULES = [
    "app", "model", "parms", "mesh",            # core
    "xsec", "xsec_layout", "analysis", "io",    # geometry detail, analyses, files
    "sets", "vars", "links", "fea", "subsurf", "console",
    "overlay",                                  # analysis visualisations
]

for _m in MODULES:
    importlib.import_module(f"engine.api.{_m}")
