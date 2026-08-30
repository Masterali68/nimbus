"use client";

import { useNimbusMock } from "@/lib/mock/useNimbusMock";
import { Panel } from "@/components/ui/Panel";
import { EnergyChart } from "@/components/charts/EnergyChart";
import { Header } from "./Header";
import { MetricsGrid } from "./MetricsGrid";

export function DashboardView() {
  const { state } = useNimbusMock();

  return (
    <div className="flex w-full flex-1 flex-col">
      <Header state={state} />

      <main className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col gap-4 px-4 py-5 sm:px-6">
        <MetricsGrid energy={state.energy} />

        <Panel title="Live Energy">
          <EnergyChart history={state.history} />
        </Panel>
      </main>
    </div>
  );
}
