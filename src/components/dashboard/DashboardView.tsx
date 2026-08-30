"use client";

import { useNimbusMock } from "@/lib/mock/useNimbusMock";
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
    activeEvent,
    controller,
    triggerEvent,
    reset,
    setController,
  } = useNimbusMock();

  return (
    <div className="flex w-full flex-1 flex-col">
      <Header state={state} />

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <MetricsGrid energy={state.energy} />

        <div className="grid gap-4 xl:grid-cols-3">
          <Panel title="Live Energy" className="xl:col-span-2">
            <EnergyChart history={state.history} />
          </Panel>
          <StabilityPanel stability={state.stability} />
        </div>

        <ResourceGrid resources={state.resources} />

        <div className="grid gap-4 xl:grid-cols-3">
          <div className="xl:col-span-2">
            <WhyNimbusPanel decision={decision} />
          </div>
          <div className="flex flex-col gap-4">
            <ControllerSelector value={controller} onChange={setController} />
            <EventControls
              activeEvent={activeEvent}
              onTrigger={triggerEvent}
              onReset={reset}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
