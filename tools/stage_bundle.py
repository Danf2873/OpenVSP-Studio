"""Assemble the files the installer ships, under openvsp_gui/bundle/:

  bundle/openvsp/  the parts of an OpenVSP distribution the app needs (solvers,
                   OpenVSP Python API, airfoils, examples) plus openvsp_gui/engine,
                   laid out like the original install so engine/vspctx.py finds
                   everything relative to itself
  bundle/python/   a private Python with numpy + six (Windows and macOS only):
                   Windows: the embeddable CPython zip; macOS: a
                   python-build-standalone "install_only" tarball. Linux uses the
                   system python3 (the OpenVSP .deb build links libpython3.12),
                   so the .deb declares python3 / python3-numpy as dependencies.

Run from openvsp_gui/:
  python tools/stage_bundle.py                         # Windows dev box: OpenVSP = ..
  python tools/stage_bundle.py --vsp-root DIR --python-archive FILE
The Python version must match the cp3XX tag of the OpenVSP _vsp module.
"""
from __future__ import annotations

import argparse
import fnmatch
import os
import platform
import shutil
import stat
import subprocess
import sys
import tarfile
import time
import zipfile

GUI = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
BUNDLE = os.path.join(GUI, "bundle")
CACHE = os.path.join(GUI, "build_cache")
WINDOWS = sys.platform == "win32"
MACOS = sys.platform == "darwin"

PY_VERSION = platform.python_version()

TOOLS = ["vsp", "vspaero", "vspaero_opt", "vsploads", "vspscript", "vspviewer"]
ROOT_FILES = (["*.exe", "*.dll"] if WINDOWS else TOOLS) + ["LICENSE", "README.md", "CHANGELOG.md", "vspIcon.png"]
ROOT_DIRS = ["airfoil", "CustomScripts", "scripts", "textures", "help", "vspaero_ex"]
# OpenVSP Python packages the engine imports (paths relative to VSP_ROOT/python).
PY_PACKAGES = ["openvsp/openvsp", "degen_geom/degen_geom", "utilities/utilities"]
IGNORE = shutil.ignore_patterns("__pycache__", "*.pyc", "tests", ".pytest_cache")


def log(msg: str) -> None:
    print(f"[stage] {msg}", flush=True)


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


def _dereference_links(root: str) -> None:
    """Replace file symlinks (e.g. bin/python3 -> python3.13) with real copies, so the
    app bundler's resource copy cannot drop or break them."""
    for r, _dirs, files in os.walk(root):
        for f in files:
            p = os.path.join(r, f)
            if os.path.islink(p):
                target = os.path.realpath(p)
                os.unlink(p)
                if os.path.isfile(target):
                    shutil.copy2(target, p)


def bundled_python_exe() -> str | None:
    if WINDOWS:
        return os.path.join(BUNDLE, "python", "python.exe")
    if MACOS:
        return os.path.join(BUNDLE, "python", "bin", "python3")
    return None


def pip_install(target_python: str, extra: list[str]) -> None:
    subprocess.check_call([target_python, "-m", "pip", "install", "--quiet", "--disable-pip-version-check",
                           *extra, "numpy", "six"])


def stage_python(archive: str | None) -> None:
    dest = os.path.join(BUNDLE, "python")
    if WINDOWS:
        archive = archive or os.path.join(CACHE, f"python-{PY_VERSION}-embed-amd64.zip")
        if not os.path.isfile(archive):
            sys.exit(f"missing {archive}: download python-{PY_VERSION}-embed-amd64.zip from python.org first")
        log(f"python {PY_VERSION} (embeddable) -> {dest}")
        with zipfile.ZipFile(archive) as z:
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
    elif MACOS:
        if not archive or not os.path.isfile(archive):
            sys.exit("macOS needs --python-archive (python-build-standalone *-install_only.tar.gz)")
        log(f"python (standalone) {os.path.basename(archive)} -> {dest}")
        with tarfile.open(archive) as t:
            t.extractall(BUNDLE, filter="tar")   # the tarball's top folder is python/
        _dereference_links(dest)
        py = bundled_python_exe()
        log("numpy + six -> bundled site-packages")
        pip_install(py, ["--only-binary=:all:"])
    else:
        log("linux: using the system python3 (no bundled interpreter)")


def stage_openvsp(vsp_root: str) -> None:
    dest = os.path.join(BUNDLE, "openvsp")
    os.makedirs(dest, exist_ok=True)
    for name in os.listdir(vsp_root):
        src = os.path.join(vsp_root, name)
        if os.path.isfile(src) and any(fnmatch.fnmatch(name, p) for p in ROOT_FILES):
            shutil.copy2(src, dest)
    for d in ROOT_DIRS:
        log(f"openvsp/{d}")
        shutil.copytree(os.path.join(vsp_root, d), os.path.join(dest, d), ignore=IGNORE)
    for pkg in PY_PACKAGES:
        log(f"openvsp/python/{pkg}")
        shutil.copytree(os.path.join(vsp_root, "python", *pkg.split("/")),
                        os.path.join(dest, "python", *pkg.split("/")), ignore=IGNORE)
    log("openvsp/openvsp_gui/engine")
    shutil.copytree(os.path.join(GUI, "engine"), os.path.join(dest, "openvsp_gui", "engine"), ignore=IGNORE)
    if not WINDOWS:
        for tool in TOOLS:
            p = os.path.join(dest, tool)
            if os.path.isfile(p):
                os.chmod(p, 0o755)


def smoke_test() -> None:
    """Start the bundled engine over stdio and ping it."""
    py = bundled_python_exe() or "python3"
    eng = os.path.join(BUNDLE, "openvsp", "openvsp_gui", "engine", "vsp_engine.py")
    env = {k: v for k, v in os.environ.items() if k not in ("PYTHONPATH", "PYTHONHOME", "OPENVSP_ROOT")}
    proc = subprocess.run([py, "-u", eng], input='{"id":1,"method":"app.ping","params":{}}\n',
                          capture_output=True, text=True, timeout=180, env=env,
                          cwd=os.path.join(BUNDLE, "openvsp", "openvsp_gui"))
    if '"result": "pong"' not in proc.stdout and '"result":"pong"' not in proc.stdout:
        sys.exit(f"bundled engine smoke test failed:\nSTDOUT:{proc.stdout}\nSTDERR:{proc.stderr[-3000:]}")
    log("bundled engine answered ping")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--vsp-root", default=os.path.dirname(GUI),
                    help="OpenVSP distribution root (holds python/openvsp); default: parent of openvsp_gui")
    ap.add_argument("--python-archive", default=None,
                    help="Windows: embeddable zip (default build_cache/); macOS: python-build-standalone tar.gz")
    ap.add_argument("--no-smoke", action="store_true", help="skip starting the bundled engine")
    args = ap.parse_args()
    if os.path.isdir(BUNDLE):
        _rmtree(BUNDLE)
    os.makedirs(BUNDLE)
    stage_python(args.python_archive)
    stage_openvsp(os.path.abspath(args.vsp_root))
    if not args.no_smoke:
        smoke_test()
    total = sum(os.path.getsize(os.path.join(r, f)) for r, _d, fs in os.walk(BUNDLE) for f in fs
                if not os.path.islink(os.path.join(r, f)))
    log(f"done: {total / 1e6:.0f} MB in {BUNDLE}")


if __name__ == "__main__":
    main()
