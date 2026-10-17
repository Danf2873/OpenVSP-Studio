"""OpenVSP engine sidecar.

    python engine/vsp_engine.py            # JSON lines over stdin/stdout
    python engine/vsp_engine.py --ws 8765  # same messages over ws://127.0.0.1:8765/ws

Protocol (docs/API.md): requests {"id", "method", "params"}; responses
{"id", "result"} or {"id", "error": {code, message, traceback}}; events
{"event", "data"}. All OpenVSP calls run on one worker thread (FIFO), so the
library is never touched concurrently.

Stdio mode keeps the protocol clean: fd 1 is duplicated for the protocol and
redirected to stderr before OpenVSP is imported, so C++ printouts cannot
corrupt the JSON stream.
"""
import argparse
import ast
import importlib
import json
import math
import os
import sys
import threading
import traceback
import types
import uuid
from concurrent.futures import ThreadPoolExecutor

ENGINE_DIR = os.path.dirname(os.path.abspath(__file__))
PARENT_DIR = os.path.dirname(ENGINE_DIR)  # openvsp_gui/, which contains the `engine` package

_DEFAULT_MODULES = ["app", "model", "parms", "mesh"]
_LOAD_ERRORS: list[str] = []


def _log_stderr(text: str) -> None:
    print(f"[engine] {text}", file=sys.stderr, flush=True)


# --- JSON encoding -------------------------------------------------------------


def _json_default(o):
    if hasattr(o, "tolist"):  # numpy arrays / scalars
        return o.tolist()
    if isinstance(o, (set, frozenset)):
        return list(o)
    if callable(getattr(o, "x", None)) and callable(getattr(o, "z", None)):  # vec3d
        return [o.x(), o.y(), o.z()]
    return str(o)


def _sanitize(o):
    """Replace NaN/Inf with None (JSON has no such values)."""
    if isinstance(o, float):
        return o if math.isfinite(o) else None
    if isinstance(o, dict):
        return {k: _sanitize(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_sanitize(v) for v in o]
    return o


def encode(obj) -> str:
    return json.dumps(_sanitize(obj), default=_json_default, ensure_ascii=False, separators=(",", ":"))


def _error_payload(exc: BaseException, registry) -> dict:
    if isinstance(exc, registry.RpcError):
        return {"code": exc.code, "message": exc.message, "traceback": None}
    return {"code": 500, "message": f"{type(exc).__name__}: {exc}", "traceback": traceback.format_exc()}


# --- API loading ------------------------------------------------------------------


def _read_module_list() -> list[str]:
    """Read MODULES from engine/api/__init__.py without executing it."""
    path = os.path.join(ENGINE_DIR, "api", "__init__.py")
    try:
        with open(path, encoding="utf-8") as f:
            tree = ast.parse(f.read())
        for node in tree.body:
            if isinstance(node, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "MODULES" for t in node.targets
            ):
                return list(ast.literal_eval(node.value))
    except Exception as e:  # pragma: no cover - defensive
        _LOAD_ERRORS.append(f"could not read MODULES from api/__init__.py: {e}")
    return list(_DEFAULT_MODULES)


def load_api() -> None:
    """Import every RPC module, tolerating modules that are missing or broken.

    Fast path: `import engine.api`. If any submodule fails, the package __init__
    aborts; the modules that did load stay registered in sys.modules. We then
    install a bare `engine.api` package object (no __init__ execution) and import
    each listed module on its own, logging the ones that fail.
    """
    try:
        import engine.api  # noqa: F401
        return
    except Exception as e:
        _LOAD_ERRORS.append(f"engine.api package import failed: {type(e).__name__}: {e}")
        _log_stderr(_LOAD_ERRORS[-1])

    sys.modules.pop("engine.api", None)
    pkg = types.ModuleType("engine.api")
    pkg.__path__ = [os.path.join(ENGINE_DIR, "api")]
    pkg.__package__ = "engine.api"
    sys.modules["engine.api"] = pkg

    for name in _read_module_list():
        try:
            importlib.import_module(f"engine.api.{name}")
        except Exception as e:
            msg = f"module engine.api.{name} not loaded: {type(e).__name__}: {e}"
            _LOAD_ERRORS.append(msg)
            _log_stderr(msg)
            _log_stderr(traceback.format_exc())


# --- dispatch core -------------------------------------------------------------------


class Server:
    """Routes requests to the single VSP worker thread.

    `reply(obj)` sends to the requesting client; `broadcast(obj)` sends to all.
    Both are supplied by the transport (stdio or websocket).
    """

    def __init__(self, registry):
        self.registry = registry
        self.pool = ThreadPoolExecutor(max_workers=1, thread_name_prefix="vsp-worker")
        # Handlers flagged concurrent=True never touch `vsp`; they run here so they
        # are answered while the FIFO worker is busy with a long job.
        self.side_pool = ThreadPoolExecutor(max_workers=4, thread_name_prefix="vsp-side")

    def handle_request(self, req: dict, reply, broadcast) -> None:
        rid = req.get("id")
        method = req.get("method")
        params = req.get("params") or {}
        if not isinstance(method, str) or not isinstance(params, dict):
            reply({"id": rid, "error": {"code": 400, "message": "request needs a string method and object params", "traceback": None}})
            return
        m = self.registry.METHODS.get(method)
        if m is None:
            reply({"id": rid, "error": {"code": 404, "message": f"unknown method {method}", "traceback": None}})
            return
        if m.long:
            job_id = uuid.uuid4().hex
            reply({"id": rid, "result": {"jobId": job_id}})
            self.pool.submit(self._run_job, job_id, method, params, broadcast)
        elif m.concurrent:
            self.side_pool.submit(self._run_call, rid, method, params, reply)
        else:
            self.pool.submit(self._run_call, rid, method, params, reply)

    def _run_call(self, rid, method, params, reply) -> None:
        try:
            result = self.registry.call(method, params)
        except Exception as e:
            reply({"id": rid, "error": _error_payload(e, self.registry)})
            return
        reply({"id": rid, "result": result})

    def _run_job(self, job_id, method, params, broadcast) -> None:
        try:
            result = self.registry.call(method, params)
        except Exception as e:
            broadcast({"event": "job_done", "data": {"jobId": job_id, "error": _error_payload(e, self.registry)}})
            return
        broadcast({"event": "job_done", "data": {"jobId": job_id, "result": result}})

    def shutdown(self) -> None:
        self.pool.shutdown(wait=True)
        self.side_pool.shutdown(wait=True)


def _safe_encode(obj, registry) -> str:
    """Encode a message; if the payload cannot be encoded, send an error instead."""
    try:
        return encode(obj)
    except Exception as e:
        rid = obj.get("id") if isinstance(obj, dict) else None
        return encode({"id": rid, "error": _error_payload(e, registry)})


# --- stdio transport ---------------------------------------------------------------


def run_stdio(server: Server, registry, version: str, proto_out) -> None:
    lock = threading.Lock()

    def write(obj) -> None:
        text = _safe_encode(obj, registry)
        with lock:
            proto_out.write(text + "\n")
            proto_out.flush()

    registry.set_notifier(lambda event, data: write({"event": event, "data": data}))
    for err in _LOAD_ERRORS:
        registry.notify("log", {"level": "warn", "text": err})
    write({"event": "ready", "data": {"version": version}})

    def reader() -> None:
        for raw in sys.stdin.buffer:
            line = raw.decode("utf-8", errors="replace").strip()
            if not line:
                continue
            try:
                req = json.loads(line)
            except ValueError as e:
                write({"id": None, "error": {"code": -32700, "message": f"parse error: {e}", "traceback": None}})
                continue
            if not isinstance(req, dict):
                write({"id": None, "error": {"code": 400, "message": "request must be a JSON object", "traceback": None}})
                continue
            server.handle_request(req, write, write)

    t = threading.Thread(target=reader, name="stdin-reader")
    t.start()
    t.join()  # stdin closed: let queued work finish, then exit
    server.shutdown()


# --- websocket transport -----------------------------------------------------------


def run_ws(server: Server, registry, version: str, port: int) -> None:
    import asyncio

    import uvicorn
    from fastapi import FastAPI, WebSocket, WebSocketDisconnect

    clients: set = set()  # (queue, loop) pairs, one per connected client
    clients_lock = threading.Lock()

    def broadcast(obj) -> None:
        text = _safe_encode(obj, registry)
        with clients_lock:
            targets = list(clients)
        for q, loop in targets:
            loop.call_soon_threadsafe(q.put_nowait, text)

    registry.set_notifier(lambda event, data: broadcast({"event": event, "data": data}))
    for err in _LOAD_ERRORS:
        registry.notify("log", {"level": "warn", "text": err})

    app = FastAPI()

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await ws.accept()
        loop = asyncio.get_running_loop()
        q: asyncio.Queue = asyncio.Queue()
        entry = (q, loop)
        with clients_lock:
            clients.add(entry)

        def reply(obj) -> None:
            loop.call_soon_threadsafe(q.put_nowait, _safe_encode(obj, registry))

        async def writer() -> None:
            while True:
                await ws.send_text(await q.get())

        reply({"event": "ready", "data": {"version": version}})
        wtask = asyncio.create_task(writer())
        try:
            while True:
                text = await ws.receive_text()
                try:
                    req = json.loads(text)
                except ValueError as e:
                    reply({"id": None, "error": {"code": -32700, "message": f"parse error: {e}", "traceback": None}})
                    continue
                if not isinstance(req, dict):
                    reply({"id": None, "error": {"code": 400, "message": "request must be a JSON object", "traceback": None}})
                    continue
                server.handle_request(req, reply, broadcast)
        except WebSocketDisconnect:
            pass
        finally:
            wtask.cancel()
            with clients_lock:
                clients.discard(entry)

    _log_stderr(f"listening on ws://127.0.0.1:{port}/ws")
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")
    server.shutdown()


# --- entry point ----------------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="OpenVSP engine sidecar")
    parser.add_argument("--ws", nargs="?", type=int, const=8765, default=None,
                        metavar="PORT", help="serve over WebSocket on 127.0.0.1:PORT (default 8765)")
    args = parser.parse_args(argv)

    proto_out = None
    if args.ws is None:
        # Protect the protocol before OpenVSP (which prints to fd 1) is imported.
        proto_fd = os.dup(1)
        os.dup2(2, 1)
        proto_out = os.fdopen(proto_fd, "w", buffering=1, encoding="utf-8", newline="\n")
        sys.stdout = sys.stderr

    if PARENT_DIR not in sys.path:
        sys.path.insert(0, PARENT_DIR)
    # Drop the engine/ directory itself from sys.path so its files cannot shadow imports.
    sys.path[:] = [p for p in sys.path if os.path.abspath(p or ".") != ENGINE_DIR]

    from engine import registry
    from engine.vspctx import vsp

    load_api()
    version = vsp.GetVSPVersion()
    server = Server(registry)
    if args.ws is None:
        run_stdio(server, registry, version, proto_out)
    else:
        run_ws(server, registry, version, args.ws)
    return 0


if __name__ == "__main__":
    sys.exit(main())
