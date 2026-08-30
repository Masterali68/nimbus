"use client";

import { useEffect, useRef, useState } from "react";
import { useNimbusTelemetry } from "@/hooks/useNimbusTelemetry";
import { cn } from "@/components/ui/cn";
import { Panel } from "@/components/ui/Panel";
import { EnergyChart } from "@/components/charts/EnergyChart";
import { ResourceGrid } from "@/components/resources/ResourceGrid";
import { Header } from "./Header";
import { MetricsGrid } from "./MetricsGrid";
import { StabilityPanel } from "./StabilityPanel";
import { EventControls } from "./EventControls";
import { ControllerSelector } from "./ControllerSelector";
import { WhyNimbusPanel } from "./WhyNimbusPanel";

export function DashboardView() {
  const {
    state,
    decision,
    severityLabel,
    connection,
    source,
    loading,
    error,
    pendingEvent,
    switchingController,
    actionError,
    triggerEvent,
    setController,
    reset,
    retry,
  } = useNimbusTelemetry();

  // one-shot accent when a disruptive event begins
  const [alert, setAlert] = useState(false);
  const prevEvent = useRef(state.activeEvent);
  useEffect(() => {
    if (state.activeEvent && state.activeEvent !== prevEvent.current) {
      setAlert(true);
      const id = setTimeout(() => setAlert(false), 1200);
      prevEvent.current = state.activeEvent;
      return () => clearTimeout(id);
    }
    prevEvent.current = state.activeEvent;
  }, [state.activeEvent]);

  const dim = connection === "reconnecting" || (loading && connection === "connecting");

  return (
    <div className={cn("flex w-full flex-1 flex-col", alert && "nimbus-alert")}>
      <Header
        state={state}
        connection={connection}
        source={source}
        switchingController={switchingController}
      />

      {connection === "offline" && (
        <div className="border-b border-signal-red/30 bg-signal-red/10 px-4 py-2 text-sm text-signal-red sm:px-6">
          <div className="mx-auto flex w-full max-w-[1600px] items-center justify-between gap-3">
            <span>
              {error ??
                "Backend unavailable."}{" "}
              {source === "mock" && "Dashboard is running on simulated data."}
            </span>
            <button
              type="button"
              onClick={retry}
              className="rounded-md border border-signal-red/40 px-3 py-1 text-xs font-semibold text-signal-red hover:bg-signal-red/10"
            >
              Retry backend
            </button>
          </div>
        </div>
      )}

      {connection === "connecting" && loading && (
        <div className="border-b border-ops-border bg-ops-panel/60 px-4 py-2 text-sm text-ops-muted sm:px-6">
          <div className="mx-auto w-full max-w-[1600px]">
            Connecting to Nimbus backend…
          </div>
        </div>
      )}

      <main
        className={cn(
          "mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-5 transition-opacity duration-300 sm:px-6",
          dim && "opacity-60",
        )}
      >
        <MetricsGrid energy={state.energy} />

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Live Energy" className="xl:col-span-2">
            <EnergyChart history={state.history} />
          </Panel>
          <StabilityPanel
            stability={state.stability}
            severityLabel={severityLabel}
          />
        </div>

        <ResourceGrid resources={state.resources} />

        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <WhyNimbusPanel
              decision={decision}
              controller={state.controller}
              trajectory={state.stability.trajectory}
              severityLabel={severityLabel}
            />
          </div>
          <div className="flex flex-col gap-4">
            <ControllerSelector
              value={state.controller}
              switching={switchingController}
              error={
                actionError && actionError.startsWith("Controller")
                  ? actionError
                  : null
              }
              onChange={setController}
            />
            <EventControls
              activeEvent={state.activeEvent}
              pendingEvent={pendingEvent}
              busy={switchingController != null || connection === "reconnecting"}
              error={
                actionError && !actionError.startsWith("Controller")
                  ? actionError
                  : null
              }
              onTrigger={triggerEvent}
              onReset={reset}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
