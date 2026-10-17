"""Assemble the files the installer ships, under openvsp_gui/bundle/:

  bundle/python/   embeddable CPython (same minor version as the OpenVSP .pyd
                   files) with numpy + six in Lib/site-packages
  bundle/openvsp/  the parts of the OpenVSP distribution the app needs
                   (solvers, OpenVSP Python API, airfoils, examples) plus
                   openvsp_gui/engine, laid out like the original install so
                   engine/vspctx.py finds everything relative to itself

Run from openvsp_gui/:  python tools/stage_bundle.py
The embeddable Python zip is read from build_cache/ (downloaded once).
"""
from __future__ import annotations

import fnmatch
import os
import platform
import shutil
import subprocess
import stat
import sys
import time
import zipfile

GUI = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
VSP_ROOT = os.path.dirname(GUI)
BUNDLE = os.path.join(GUI, "bundle")
CACHE = os.path.join(GUI, "build_cache")

PY_VERSION = platform.python_version()  # must match the cp3XX tag of _vsp.pyd
PY_ZIP = os.path.join(CACHE, f"python-{PY_VERSION}-embed-amd64.zip")

# Top-level items of the OpenVSP install to ship.
ROOT_FILES = ["*.exe", "*.dll", "LICENSE", "README.md", "CHANGELOG.md", "vspIcon.png"]
ROOT_DIRS = ["airfoil", "CustomScripts", "scripts", "textures", "help", "vspaero_ex"]
# OpenVSP Python packages the engine imports (paths relative to VSP_ROOT/python).
PY_PACKAGES = ["openvsp/openvsp", "degen_geom/degen_geom", "utilities/utilities"]
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", "tests", ".pytest_cache")


def log(msg: str) -> None:
    print(f"[stage] {msg}", flush=True)


def stage_python() -> None:
    dest = os.path.join(BUNDLE, "python")
    if not os.path.isfile(PY_ZIP):
        sys.exit(f"missing {PY_ZIP}: download python-{PY_VERSION}-embed-amd64.zip from python.org first")
    log(f"python {PY_VERSION} -> {dest}")
    with zipfile.ZipFile(PY_ZIP) as z:
        z.extractall(dest)
    site = os.path.join(dest, "Lib", "site-packages")
    os.makedirs(site, exist_ok=True)
    # The ._pth file fixes sys.path for the embeddable build (PYTHONPATH is ignored);
    # the engine adds the OpenVSP package folders itself.
    tag = "".join(PY_VERSION.split(".")[:2])
    with open(os.path.join(dest, f"python{tag}._pth"), "w", encoding="ascii") as fh:
        fh.write(f"python{tag}.zip\n.\nLib\\site-packages\n")
    log("numpy + six -> Lib/site-packages")
    subprocess.check_call([
        sys.executable, "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
        "--target", site, "--only-binary=:all:", "--platform", "win_amd64",
        "--python-version", PY_VERSION, "--implementation", "cp", "numpy", "six",
    ])


def stage_openvsp() -> None:
    dest = os.path.join(BUNDLE, "openvsp")
    os.makedirs(dest, exist_ok=True)
    for name in os.listdir(VSP_ROOT):
        src = os.path.join(VSP_ROOT, name)
        if os.path.isfile(src) and any(fnmatch.fnmatch(name, p) for p in ROOT_FILES):
            shutil.copy2(src, dest)
    for d in ROOT_DIRS:
        log(f"openvsp/{d}")
        shutil.copytree(os.path.join(VSP_ROOT, d), os.path.join(dest, d), ignore=IGNORE)
    for pkg in PY_PACKAGES:
        log(f"openvsp/python/{pkg}")
        shutil.copytree(os.path.join(VSP_ROOT, "python", *pkg.split("/")),
                        os.path.join(dest, "python", *pkg.split("/")), ignore=IGNORE)
    log("openvsp/openvsp_gui/engine")
    shutil.copytree(os.path.join(GUI, "engine"), os.path.join(dest, "openvsp_gui", "engine"), ignore=IGNORE)


def smoke_test() -> None:
    """Start the bundled engine over stdio and ping it."""
    py = os.path.join(BUNDLE, "python", "python.exe")
    eng = os.path.join(BUNDLE, "openvsp", "openvsp_gui", "engine", "vsp_engine.py")
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "PYTHONHOME", "OPENVSP_ROOT")}
    proc = subprocess.run([py, "-u", eng], input='{"id":1,"method":"app.ping","params":{}}\n',
                          capture_output=True, text=True, timeout=120, env=env,
                          cwd=os.path.join(BUNDLE, "openvsp", "openvsp_gui"))
    if '"result": "pong"' not in proc.stdout and '"result":"pong"' not in proc.stdout:
        sys.exit(f"bundled engine smoke test failed:\nSTDOUT:{proc.stdout}\nSTDERR:{proc.stderr[-3000:]}")
    log("bundled engine answered ping")


def _rmtree(path: str) -> None:
    """rmtree that survives OneDrive/AV briefly locking or read-only-flagging files."""
    def onexc(fn, p, _err):
        os.chmod(p, stat.S_IWRITE)
        for _ in range(10):
            try:
                fn(p)
                return
            except OSError:
                time.sleep(0.5)
        fn(p)
    for attempt in range(3):
        try:
            shutil.rmtree(path, onexc=onexc)
            return
        except OSError:
            if attempt == 2:
                raise
            time.sleep(2)


def main() -> None:
    if os.path.isdir(BUNDLE):
        _rmtree(BUNDLE)
    os.makedirs(BUNDLE)
    stage_python()
    stage_openvsp()
    smoke_test()
    total = sum(os.path.getsize(os.path.join(r, f)) for r, _d, fs in os.walk(BUNDLE) for f in fs)
    log(f"done: {total / 1e6:.0f} MB in {BUNDLE}")


if __name__ == "__main__":
    main()
