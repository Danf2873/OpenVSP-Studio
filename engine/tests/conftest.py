import os
import sys

import pytest

# Make `engine` importable when pytest runs from openvsp_gui/ or the OpenVSP root.
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from engine.vspctx import vsp  # noqa: E402
from engine import registry  # noqa: E402
import engine.api  # noqa: E402,F401  (registers every RPC method)


@pytest.fixture(autouse=True)
def fresh_model():
    """Every test starts with an empty model and a captured event list."""
    vsp.VSPRenew()
    events: list = []
    registry.set_notifier(lambda e, d: events.append((e, d)))
    yield events
    vsp.VSPRenew()


@pytest.fixture
def rpc():
    """Call a registered method by name: rpc("geom.add", type="POD")."""
    return lambda _method, /, **params: registry.call(_method, params)
