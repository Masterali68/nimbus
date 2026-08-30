"""Shared test fixtures.

Importing from the top-level ``main``/``telemetry`` modules works because
pytest inserts ``backend/`` onto ``sys.path`` (tests is a package whose
parent is not a package).
"""

from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from main import app
from models import RESOURCE_NAMES


@pytest.fixture(scope="session")
def client() -> TestClient:
    """TestClient with full lifespan (mock telemetry loop runs)."""
    with TestClient(app) as c:
        yield c


@pytest.fixture(scope="session")
def contract_keys() -> list[str]:
    """Canonical camelCase telemetry contract fields the frontend expects."""
    return [
        "timestampMs",
        "controllerMode",
        "activeEvent",
        "solarKw",
        "windKw",
        "totalGenerationKw",
        "batteryKwh",
        "batteryCapacityKwh",
        "batteryPct",
        "batteryChargeRateKw",
        "batteryDischargeRateKw",
        "totalDemandKw",
        "netPowerKw",
        "filteredNetPowerKw",
        "velocityKwS",
        "accelerationKwS2",
        "severity",
        "trajectory",
        "resources",
        "latestDecision",
        "explanation",
    ]


@pytest.fixture(scope="session")
def expected_resource_names() -> list[str]:
    return list(RESOURCE_NAMES)