"""Pydantic schemas for the Nimbus backend.

All outbound JSON uses camelCase field names to match the shared
Nimbus frontend contract. Python internals are snake_case.

This is the canonical backend schema. The frontend TypeScript types and
Lalith's simulation / Ali's decision engine must produce values that map
1:1 onto these fields.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

ControllerMode = Literal["naive", "reactive", "nimbus"]
SeverityLevel = Literal["stable", "watch", "warning", "critical"]
TrajectoryState = Literal["deteriorating", "stable", "improving", "critical"]
ResourceName = Literal["hospital", "desalination", "residential", "resort"]

# Full decision-engine resource-state vocabulary (mapped to lowercase on the
# wire). Phase 2 extends Phase 1's {normal, throttled, restoring, shed} with
# the states Ali's decision engine actually emits.
RESOURCE_STATES = ("normal", "throttled", "reduced", "shed", "cooldown", "restoring", "protected")

RESOURCE_NAMES: tuple[ResourceName, ...] = (
    "hospital",
    "desalination",
    "residential",
    "resort",
)


class CamelModel(BaseModel):
    """Base model: snake_case internally, camelCase on the wire."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)


# --------------------------------------------------------------------------- #
# Health
# --------------------------------------------------------------------------- #
class HealthResponse(CamelModel):
    status: str = "ok"
    service: str = "nimbus-backend"
    version: str = "0.1.0"
    timestamp_ms: int
    uptime_s: float = 0.0
    last_tick_ms: int | None = None
    connected_clients: int = 0
    telemetry_running: bool = False
    controller_mode: ControllerMode = "reactive"
    active_event: str | None = None
    simulation_backend: str = "mock"
    controller_backend: str = "mock"
    simulation_ok: bool = True
    controller_ok: bool = True
    last_error: str | None = None


# --------------------------------------------------------------------------- #
# Phase 2 control-plane requests / responses
# --------------------------------------------------------------------------- #
class EventRequest(CamelModel):
    """POST /api/event body. eventType is validated by the route (400 on unknown)."""

    event_type: str
    params: dict | None = None


class EventResponse(CamelModel):
    accepted: bool = True
    event_type: str
    active_event: str | None = None
    timestamp_ms: int


class ControllerRequest(CamelModel):
    """POST /api/controller body. mode is validated at the schema (422 on unknown)."""

    mode: ControllerMode


class ControllerResponse(CamelModel):
    mode: ControllerMode
    previous_mode: ControllerMode
    adopted: bool = True
    adopted_at_ms: int


class ResetResponse(CamelModel):
    reset: bool = True
    timestamp_ms: int
    sequence: int
    controller_mode: ControllerMode
    active_event: str | None = None


# --------------------------------------------------------------------------- #
# Resources
# --------------------------------------------------------------------------- #
class ResourceState(CamelModel):
    """Per-resource island telemetry (hospital, desalination, residential, resort).

    Phase 2 additive fields (max_demand_kw, minimum_operating_pct, criticality,
    throttleable) give the dashboard the same resource metadata the shared
    contract carries, while keeping the Phase 1 wire fields unchanged.
    """

    name: ResourceName
    demand_kw: float = Field(ge=0.0)
    operating_pct: float = Field(ge=0.0, le=100.0)
    state: str = "normal"
    shedable: bool = False
    max_demand_kw: float | None = Field(default=None, ge=0.0)
    minimum_operating_pct: float | None = Field(default=None, ge=0.0, le=100.0)
    criticality: float | None = Field(default=None, ge=0.0, le=100.0)
    throttleable: bool = False

    @field_validator("state")
    @classmethod
    def state_must_be_known(cls, v: str) -> str:
        allowed = set(RESOURCE_STATES)
        if v not in allowed:
            raise ValueError(f"state must be one of {sorted(allowed)!r}, got {v!r}")
        return v


Resources = dict[ResourceName, ResourceState]


# --------------------------------------------------------------------------- #
# Telemetry
# --------------------------------------------------------------------------- #
class TelemetryFrame(CamelModel):
    """Full island telemetry snapshot. This is THE contract."""

    timestamp_ms: int
    sequence: int = Field(ge=0)

    controller_mode: ControllerMode = "reactive"
    active_event: str | None = None

    solar_kw: float = Field(ge=0.0)
    wind_kw: float = Field(ge=0.0)
    total_generation_kw: float = Field(ge=0.0)

    battery_kwh: float = Field(ge=0.0)
    battery_capacity_kwh: float = Field(gt=0.0)
    battery_pct: float = Field(ge=0.0, le=100.0)
    battery_charge_rate_kw: float = Field(ge=0.0)
    battery_discharge_rate_kw: float = Field(ge=0.0)

    total_demand_kw: float = Field(ge=0.0)
    net_power_kw: float
    filtered_net_power_kw: float
    velocity_kw_s: float
    acceleration_kw_s2: float

    severity: SeverityLevel = "stable"
    trajectory: TrajectoryState = "stable"

    resources: Resources
    latest_decision: dict | None = None
    explanation: str | None = None

    @field_validator("resources")
    @classmethod
    def all_four_resources_present(cls, v: Resources) -> Resources:
        if set(v.keys()) != set(RESOURCE_NAMES):
            raise ValueError(
                f"resources must contain exactly {set(RESOURCE_NAMES)!r}, got {set(v.keys())!r}"
            )
        return v

    @model_validator(mode="after")
    def derived_fields_consistent(self) -> TelemetryFrame:
        if abs(self.total_generation_kw - (self.solar_kw + self.wind_kw)) > 0.001:
            raise ValueError(
                f"total_generation_kw={self.total_generation_kw} != "
                f"solar_kw + wind_kw = {self.solar_kw + self.wind_kw}"
            )
        if abs(self.total_demand_kw - sum(r.demand_kw for r in self.resources.values())) > 0.001:
            raise ValueError(
                "total_demand_kw must equal the sum of resource demand_kw values"
            )
        if self.battery_kwh > self.battery_capacity_kwh + 0.001:
            raise ValueError("battery_kwh cannot exceed battery_capacity_kwh")
        return self


class HistoryResponse(CamelModel):
    items: list[TelemetryFrame] = Field(default_factory=list)
    count: int = 0
    limit: int = 0