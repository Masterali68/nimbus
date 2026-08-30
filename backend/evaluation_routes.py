"""REST routes for the Nimbus Phase 3 evaluation subsystem.

The evaluation runner lives on ``request.app.state.evaluation`` (created by the
app lifespan). A route that finds no runner returns 503 so a half-started
backend degrades cleanly — same pattern as ``api_routes._runtime``.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from evaluation_models import (
    ComparisonResult,
    EvaluationProgress,
    EvaluationResult,
    EvaluationRunRequest,
    EvaluationRunStarted,
    EvaluationSummary,
)
from evaluation_runner import (
    EvaluationInProgressError,
    EvaluationIntegrationError,
    EvaluationInvalidRequestError,
    EvaluationRunner,
)

router = APIRouter(prefix="/api/evaluate", tags=["evaluation"])


def _runner(request: Request) -> EvaluationRunner:
    runner = getattr(request.app.state, "evaluation", None)
    if runner is None:
        raise HTTPException(status_code=503, detail="evaluation runner not initialized")
    return runner


def _map_errors(exc: Exception) -> HTTPException:
    if isinstance(exc, EvaluationInProgressError):
        return HTTPException(status_code=409, detail=str(exc))
    if isinstance(exc, EvaluationIntegrationError):
        return HTTPException(status_code=503, detail=str(exc))
    if isinstance(exc, EvaluationInvalidRequestError):
        return HTTPException(status_code=400, detail=str(exc))
    return HTTPException(status_code=500, detail=f"internal evaluation error: {exc}")


@router.post(
    "",
    response_model=EvaluationRunStarted,
    status_code=201,
    summary="Start an evaluation",
)
async def start_evaluation(
    request: Request, body: EvaluationRunRequest
) -> EvaluationRunStarted:
    """Start a background evaluation. Returns immediately with a run id.

    The heavy work runs in a background asyncio task so this call does not
    block. Duplicate concurrent runs are rejected with 409.
    """
    runner = _runner(request)
    try:
        return runner.start(body)
    except Exception as exc:  # noqa: BLE001 - map to HTTP errors
        raise _map_errors(exc) from exc


@router.get(
    "/latest",
    response_model=EvaluationResult,
    summary="Get the latest completed evaluation result",
)
async def get_latest(request: Request) -> EvaluationResult:
    runner = _runner(request)
    result = runner.get_latest()
    if result is None or result.status != "completed":
        raise HTTPException(
            status_code=404,
            detail="no completed evaluation result yet",
        )
    return result


@router.get(
    "/{run_id}/progress",
    response_model=EvaluationProgress,
    summary="Get evaluation progress",
)
async def get_progress(request: Request, run_id: str) -> EvaluationProgress:
    runner = _runner(request)
    progress = runner.get_progress(run_id)
    if progress is None:
        raise HTTPException(status_code=404, detail=f"unknown runId: {run_id}")
    return progress


@router.get(
    "/{run_id}",
    response_model=EvaluationResult,
    summary="Get an evaluation result",
)
async def get_result(request: Request, run_id: str) -> EvaluationResult:
    runner = _runner(request)
    result = runner.get_result(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"unknown runId: {run_id}")
    return result


@router.get(
    "",
    response_model=list[EvaluationSummary],
    summary="List evaluation runs",
)
async def list_runs(request: Request) -> list[EvaluationSummary]:
    runner = _runner(request)
    return runner.list_runs()


@router.post(
    "/cancel/{run_id}",
    response_model=EvaluationProgress,
    summary="Cancel a queued/running evaluation (best-effort)",
)
async def cancel_run(request: Request, run_id: str) -> EvaluationProgress:
    runner = _runner(request)
    cancelled = runner.cancel(run_id)
    progress = runner.get_progress(run_id)
    if progress is None:
        raise HTTPException(status_code=404, detail=f"unknown runId: {run_id}")
    if not cancelled:
        # Not cancellable (e.g. already done) but we can still report state.
        return progress
    return progress


@router.get(
    "/aggregate/{run_id}",
    response_model=ComparisonResult,
    summary="Aggregated comparison across controllers (for charts/table)",
)
async def get_aggregate(request: Request, run_id: str) -> ComparisonResult:
    runner = _runner(request)
    result = runner.get_result(run_id)
    if result is None:
        raise HTTPException(status_code=404, detail=f"unknown runId: {run_id}")
    if result.status != "completed" or result.comparison is None:
        raise HTTPException(
            status_code=409,
            detail="aggregate is not ready until the run completes",
        )
    return result.comparison
