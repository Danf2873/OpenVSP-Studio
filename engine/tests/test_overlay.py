"""Tests for engine/api/overlay.py.

The parser tests use synthetic files and need no solver. The slow tests run a
real VSPAERO sweep and MassProp (about 5-20 s each). The model is saved before
VSPAERO runs so its files land in tmp_path.
"""
from __future__ import annotations

import json
import os
import queue
import subprocess
import sys
import threading

import pytest

from engine import registry
from engine.api import overlay
from engine.vspctx import vsp

APP_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
ENGINE_SCRIPT = os.path.join(APP_ROOT, "engine", "vsp_engine.py")


def call(method_name, **params):
    return registry.call(method_name, params)


# --- parsers (no solver) ----------------------------------------------------------------

LOD_TEXT = """Sref_    100.0
AoA_                    5.0000000 deg
Beta_                   0.0000000 deg
Iter         VortexSheet TrailVort     Xavg      Yavg      Zavg     dSpan     SoverB      Chord     dArea    V/Vref      Cl        Cd
1             1           1           5.97654   8.10000   0.00000   1.80000   0.10000   1.30000   2.34000   1.00000   0.10000   0.00950
1             1           2           5.53731   6.30000   0.00000   1.80000   0.20000   1.90000   3.42000   1.00000   0.20000   0.00895
1             1           3           5.09808   4.50000   0.00000   1.80000   0.30000   2.50000   4.50000   1.00000   0.30000   0.00859
AoA_                   10.0000000 deg
Beta_                   0.0000000 deg
Iter         VortexSheet TrailVort     Xavg      Yavg      Zavg     dSpan     SoverB      Chord     dArea    V/Vref      Cl        Cd
1             1           1           5.97654   8.10000   0.00000   1.80000   0.10000   1.30000   2.34000   1.00000   0.50000   0.00950
1             1           2           5.53731   6.30000   0.00000   1.80000   0.20000   1.90000   3.42000   1.00000   0.60000   0.00895
"""


def test_lod_parser_uses_last_block():
    blocks = overlay._parse_lod(LOD_TEXT)
    assert len(blocks) == 2
    assert blocks[0]["aoa"] == 5.0 and blocks[1]["aoa"] == 10.0
    last = blocks[-1]
    assert len(last["rows"]) == 2
    recs = overlay._strip_records(last)
    assert [r["cl"] for r in recs] == [0.5, 0.6]


def test_geometry_quads_arrows_and_polyline():
    recs = overlay._strip_records(overlay._parse_lod(LOD_TEXT)[0])
    geo = overlay._geometry(recs)
    assert len(geo["quads"]) == 3 and len(geo["values"]) == 3
    # Quad spans chordwise from Xavg - 0.25c to Xavg + 0.75c and dSpan across the strip.
    xs = [p[0] for p in geo["quads"][0]]
    assert min(xs) == pytest.approx(5.97654 - 0.25 * 1.3, abs=1e-9)
    assert max(xs) == pytest.approx(5.97654 + 0.75 * 1.3, abs=1e-9)
    # The largest lift arrow is about 25% of the span.
    lengths = [abs(v[2]) for v in geo["vectors"]]
    assert max(lengths) == pytest.approx(0.25 * geo["span"], rel=1e-6)
    assert len(geo["polylines"]) == 1 and len(geo["polylines"][0]) == 3


def test_freestream_arrow_points_along_relative_wind():
    recs = overlay._strip_records(overlay._parse_lod(LOD_TEXT)[0])
    items, legend = overlay._lift_items(overlay._geometry(recs), 0.0, 0.0)
    free = [i for i in items if i["kind"] == "arrows" and i.get("color") == "green"]
    assert len(free) == 1
    vec = free[0]["vectors"][0]
    assert vec[0] > 0 and abs(vec[2]) < 1e-9  # zero AoA: flow along +X
    assert legend == {"label": "Cl", "min": pytest.approx(0.1), "max": pytest.approx(0.3), "colormap": "cool-warm"}


def test_history_parser_reads_cases_and_rows():
    text = (
        "Solver Case: 1 \n\n"
        "      Iter             Mach             AoA              CLtot             CDtot          L2 Residual      Max Residual     Wall_Time\n"
        "         1   0.001000000000   0.000000000000   0.100000000000   0.005000000000   -1.000000000000   -0.5   0.3\n"
        "         2   0.001000000000   0.000000000000   0.141000000000   0.005100000000   -2.670000000000   -0.6   0.6\n"
        "Solver Case: 2 \n\n"
        "      Iter             Mach             AoA              CLtot             CDtot          L2 Residual      Max Residual     Wall_Time\n"
        "         1   0.001000000000   5.000000000000   0.400000000000   0.006000000000   -1.500000000000   -0.4   0.2\n"
    )
    cases, rows = overlay._parse_history(text)
    assert cases == 2
    assert len(rows) == 3
    assert rows[-1]["CLtot"] == pytest.approx(0.4) and rows[-1]["Case"] == 2
    assert rows[-1]["AoA"] == pytest.approx(5.0)


def test_slc_parser_keeps_last_case_per_cut():
    text = (
        "BLOCK Cut_1_at_Y:_0.000000 \n"
        "Case: 1 ... Mach: 0.001000 ... Alpha: 0.000000 ...\n"
        "     x          y          z         dCp\n"
        "    4.0000     0.0000     1.0000     0.1000\n"
        "    3.0000     0.0000     1.0000     0.2000\n"
        "Case: 2 ... Mach: 0.001000 ... Alpha: 5.000000 ...\n"
        "     x          y          z         dCp\n"
        "    4.0000     0.0000     1.0000     0.5000\n"
        "    3.0000     0.0000     1.0000     0.6000\n"
    )
    cuts = overlay._parse_slc(text)
    assert list(cuts) == [("Y", "0.000000")]
    assert [p[3] for p in cuts[("Y", "0.000000")]] == [0.5, 0.6]


def test_unknown_analysis_returns_note():
    out = call("overlay.get", analysis="NoSuchAnalysis")
    assert out["items"] == []
    assert "NoSuchAnalysis" in out["note"]


def test_progress_without_prepare_is_empty():
    overlay._run_state.update(base=None, since=0.0, analysis=None)
    out = call("overlay.progress", analysis="VSPAEROSweep")
    assert out["iteration"] == 0 and out["rows"] == []


# --- real solver ---------------------------------------------------------------------------

@pytest.mark.slow
def test_vspaero_overlay_and_progress(tmp_path):
    vsp.AddGeom("WING")
    vsp.Update()
    path = str(tmp_path / "wing.vsp3")
    vsp.WriteVSPFile(path, vsp.SET_ALL)
    call("overlay.prepare", analysis="VSPAEROSweep")
    call("analysis.run", name="VSPAEROComputeGeometry")
    call("analysis.setInput", name="VSPAEROSweep", input="AlphaStart", value=[0.0])
    call("analysis.setInput", name="VSPAEROSweep", input="AlphaEnd", value=[1.0])
    call("analysis.setInput", name="VSPAEROSweep", input="AlphaNpts", value=[2])
    call("overlay.prepare", analysis="VSPAEROSweep")
    call("analysis.run", name="VSPAEROSweep")

    lod = os.path.splitext(path)[0] + ".lod"
    assert os.path.isfile(lod)
    text = open(lod, encoding="utf-8", errors="replace").read()
    expected_rows = len(overlay._parse_lod(text)[-1]["rows"])

    out = call("overlay.get", analysis="VSPAEROSweep")
    strips = [i for i in out["items"] if i["kind"] == "strips"]
    arrows = [i for i in out["items"] if i["kind"] == "arrows"]
    assert len(strips) == 1 and len(strips[0]["values"]) == expected_rows
    assert len(strips[0]["quads"]) == expected_rows
    assert arrows, "lift arrows missing"
    assert out["legend"]["colormap"] == "cool-warm"

    prog = call("overlay.progress", analysis="VSPAEROSweep")
    assert prog["iteration"] >= 1
    assert prog["rows"] and "CLtot" in prog["rows"][-1]


@pytest.mark.slow
def test_massprop_cg_marker(tmp_path):
    vsp.AddGeom("WING")
    vsp.Update()
    call("analysis.run", name="MassProp")
    out = call("overlay.get", analysis="MassProp")
    markers = [i for i in out["items"] if i["kind"] == "marker"]
    cg = [m for m in markers if m["label"] == "CG"]
    assert len(cg) == 1 and len(cg[0]["position"]) == 3


# --- concurrent dispatch over the stdio transport --------------------------------------------

def _start_engine(err_path: str) -> subprocess.Popen:
    err = open(err_path, "w", encoding="utf-8")
    return subprocess.Popen(
        [sys.executable, ENGINE_SCRIPT],
        cwd=APP_ROOT,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=err,
        text=True,
        encoding="utf-8",
        bufsize=1,
    )


@pytest.mark.slow
def test_progress_is_answered_during_a_long_job(tmp_path):
    proc = _start_engine(str(tmp_path / "engine_stderr.txt"))
    lines: queue.Queue = queue.Queue()

    def pump():
        for line in proc.stdout:
            lines.put(line)
        lines.put(None)

    threading.Thread(target=pump, daemon=True).start()
    seen: list[dict] = []

    def next_msg(timeout=300):
        raw = lines.get(timeout=timeout)
        assert raw is not None, "engine closed stdout early"
        msg = json.loads(raw)
        seen.append(msg)
        return msg

    def send(rid, method, params=None):
        proc.stdin.write(json.dumps({"id": rid, "method": method, "params": params or {}}) + "\n")
        proc.stdin.flush()

    def reply_for(rid):
        while True:
            msg = next_msg()
            if msg.get("id") == rid:
                return msg

    def job_done_for(job_id):
        while True:
            msg = next_msg()
            if msg.get("event") == "job_done" and msg["data"]["jobId"] == job_id:
                return msg["data"]

    try:
        next_msg()  # ready
        model_path = str(tmp_path / "wing.vsp3").replace("\\", "/")
        send(1, "geom.add", {"type": "WING"})
        assert "result" in reply_for(1)
        send(2, "model.save", {"path": model_path})
        assert "result" in reply_for(2)
        send(3, "overlay.prepare", {"analysis": "VSPAEROSweep"})
        assert "result" in reply_for(3)
        send(4, "analysis.run", {"name": "VSPAEROComputeGeometry"})
        job = reply_for(4)["result"]["jobId"]
        assert job_done_for(job).get("error") is None
        send(5, "analysis.setInput", {"name": "VSPAEROSweep", "input": "AlphaNpts", "value": [8]})
        assert "result" in reply_for(5)
        send(6, "overlay.prepare", {"analysis": "VSPAEROSweep"})
        assert "result" in reply_for(6)

        send(7, "analysis.run", {"name": "VSPAEROSweep"})
        job = reply_for(7)["result"]["jobId"]
        send(8, "overlay.progress", {"analysis": "VSPAEROSweep"})
        progress = reply_for(8)
        assert "result" in progress

        # The progress reply must arrive before the long job finishes.
        job_done_seen = any(m.get("event") == "job_done" and m["data"]["jobId"] == job for m in seen)
        assert not job_done_seen, "progress was queued behind the VSPAERO job"
        assert job_done_for(job).get("error") is None
    finally:
        proc.stdin.close()
        proc.wait(timeout=300)
        assert proc.returncode == 0, open(str(tmp_path / "engine_stderr.txt"), encoding="utf-8").read()[-2000:]
