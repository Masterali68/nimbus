"""Integration adapters for the Nimbus backend.

The runtime loop depends ONLY on the abstract adapter interfaces defined here —
never on concrete modules directly. This is the clean seam where Lalith's
simulation and Ali's decision engine plug in once their code lands in this
branch; until then the clearly-labeled mock adapters keep the whole Phase 2
pipeline runnable for local backend testing.

Do not copy or reimplement teammate logic here. The mocks are temporary
placeholders, honest about being placeholders.
"""

from integrations.controller import (
    AliControllerAdapter,
    ControllerAdapter,
    ControllerAdapterError,
    MockControllerAdapter,
    build_controller_adapter,
)
from integrations.simulation import (
    LalithSimulationAdapter,
    SimulationAdapter,
    SimulationAdapterError,
    MockSimulationAdapter,
    build_simulation_adapter,
)

__all__ = [
    "AliControllerAdapter",
    "ControllerAdapter",
    "ControllerAdapterError",
    "MockControllerAdapter",
    "build_controller_adapter",
    "LalithSimulationAdapter",
    "SimulationAdapter",
    "SimulationAdapterError",
    "MockSimulationAdapter",
    "build_simulation_adapter",
]