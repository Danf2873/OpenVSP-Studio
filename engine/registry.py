"""Method registry shared by every engine/api module.

Every RPC method is a plain function taking keyword params (from the request's
"params" object) and returning JSON-serialisable data. Register with:

    from engine.registry import method, RpcError, notify

    @method("geom.add", mutates=True)
    def add(type: str, parentId: str | None = None, name: str | None = None) -> dict:
        ...

- mutates=True  -> the dispatcher takes an undo snapshot before the call (see
                   SNAPSHOT_HOOK) and emits a "model_changed" event afterwards.
                   A "coalesceKey" param, if present, is stripped before the call;
                   consecutive calls with the same key share one snapshot.
- long=True     -> the call may take minutes (VSPAERO, meshing). The server
                   replies immediately with {"jobId": ...}; the real result is
                   delivered later via a "job_done" event {jobId, result|error}.

All OpenVSP calls are serialised through VSP_LOCK by the server; handlers must
not spawn their own threads that touch `vsp`.
"""
from __future__ import annotations

import os
import sys
import threading
from dataclasses import dataclass
from typing import Any, Callable


class RpcError(Exception):
    """Raise for expected, user-facing failures (bad id, invalid input)."""

    def __init__(self, message: str, code: int = 1):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Method:
    name: str
    fn: Callable[..., Any]
    mutates: bool = False
    long: bool = False
    concurrent: bool = False


METHODS: dict[str, Method] = {}
VSP_LOCK = threading.RLock()


def method(name: str, *, mutates: bool = False, long: bool = False, concurrent: bool = False):
    """concurrent=True: the handler never touches `vsp` (e.g. it only reads result
    files), so the server may run it immediately on its own thread instead of
    queueing it behind a long job such as a VSPAERO run."""
    def deco(fn):
        if name in METHODS:
            raise RuntimeError(f"duplicate RPC method {name}")
        METHODS[name] = Method(name, fn, mutates, long, concurrent)
        return fn

    return deco


# --- event sink -------------------------------------------------------------
# The server replaces this with a function that writes {"event", "data"} to
# the client. Tests may replace it with a list appender.
_notify_impl: Callable[[str, dict], None] = lambda event, data: None


def set_notifier(fn: Callable[[str, dict], None]) -> None:
    global _notify_impl
    _notify_impl = fn


def notify(event: str, data: dict | None = None) -> None:
    _notify_impl(event, data or {})


# --- undo hook ----------------------------------------------------------------
# engine/api/model.py installs a callable(coalesce_key: str | None) that takes
# a snapshot before a mutating call.
SNAPSHOT_HOOK: Callable[[str | None], None] | None = None


def set_snapshot_hook(fn: Callable[[str | None], None]) -> None:
    global SNAPSHOT_HOOK
    SNAPSHOT_HOOK = fn


def call(name: str, params: dict | None = None) -> Any:
    """Synchronously dispatch a method (used by the server and by tests).

    Handles snapshotting for mutating methods. Long methods run inline here;
    the server is responsible for running them on a worker and emitting
    job_done.
    """
    m = METHODS.get(name)
    if m is None:
        raise RpcError(f"unknown method {name}", code=404)
    params = dict(params or {})
    coalesce = params.pop("coalesceKey", None)
    if m.mutates and os.environ.get("OPENVSP_STUDIO_TRACE"):
        print(f"[trace] {name} {params}", file=sys.stderr, flush=True)
    if m.concurrent:
        return m.fn(**params)
    with VSP_LOCK:
        if m.mutates and SNAPSHOT_HOOK is not None:
            SNAPSHOT_HOOK(coalesce)
        result = m.fn(**params)
    if m.mutates:
        notify("model_changed", {"method": name})
    return result
