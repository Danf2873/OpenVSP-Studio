"""console.* : Python console (persistent namespace with `vsp`) and vspscript runner."""
from __future__ import annotations

import ast
import contextlib
import io
import os
import subprocess
import traceback

from engine.vspctx import vsp, VSP_ROOT
from engine.registry import method, RpcError

_NS: dict = {"vsp": vsp}


def _run(code: str):
    """Execute `code` in the persistent namespace. If the last statement is an
    expression, its value is returned (REPL style); otherwise None."""
    tree = ast.parse(code, filename="<console>", mode="exec")
    last = None
    if tree.body and isinstance(tree.body[-1], ast.Expr):
        last = ast.Expression(tree.body.pop().value)
    exec(compile(tree, "<console>", "exec"), _NS)
    if last is not None:
        return eval(compile(last, "<console>", "eval"), _NS)
    return None


@method("console.exec", mutates=True)
def console_exec(code: str) -> dict:
    out = io.StringIO()
    result = None
    error = None
    try:
        with contextlib.redirect_stdout(out):
            value = _run(code)
        if value is not None:
            result = repr(value)
    except Exception:
        error = traceback.format_exc()
    return {"stdout": out.getvalue(), "result": result, "error": error}


@method("console.runScript")
def console_run_script(path: str) -> dict:
    exe = os.path.join(VSP_ROOT, "vspscript.exe" if os.name == "nt" else "vspscript")
    if not os.path.isfile(exe):
        raise RpcError(f"vspscript not found at {exe}")
    if not os.path.isfile(path):
        raise RpcError(f"script not found: {path}")
    try:
        proc = subprocess.run(
            [exe, "-script", path],
            cwd=VSP_ROOT,
            capture_output=True,
            text=True,
            timeout=600,
        )
    except subprocess.TimeoutExpired:
        raise RpcError("vspscript timed out after 600 s")
    return {"output": (proc.stdout or "") + (proc.stderr or ""), "code": proc.returncode}
