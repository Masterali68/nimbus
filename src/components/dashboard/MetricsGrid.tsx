import type { EnergyMetrics } from "@/types/nimbus";
import { n0, signed1 } from "@/components/ui/format";
import { MetricCard } from "./MetricCard";

export function MetricsGrid({ energy }: { energy: EnergyMetrics }) {
  const netTone =
    energy.netKw > 1
      ? "text-signal-green"
      : energy.netKw < -1
        ? "text-signal-red"
        : "text-ops-text";

  const battTone =
    energy.batteryPct > 50
      ? "text-signal-green"
      : energy.batteryPct > 28
        ? "text-signal-amber"
        : "text-signal-red";

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
      <MetricCard label="Solar" value={n0(energy.solarKw)} unit="kW" tone="text-signal-amber" />
      <MetricCard label="Wind" value={n0(energy.windKw)} unit="kW" tone="text-signal-cyan" />
      <MetricCard
        label="Total Gen"
        value={n0(energy.totalGenerationKw)}
        unit="kW"
        tone="text-signal-blue"
      />
      <MetricCard label="Total Demand" value={n0(energy.totalDemandKw)} unit="kW" />
      <MetricCard label="Net Power" value={signed1(energy.netKw)} unit="kW" tone={netTone} />
      <MetricCard label="Battery" value={n0(energy.batteryPct)} unit="%" tone={battTone} />
      <MetricCard
        label="Battery Energy"
        value={n0(energy.batteryEnergyKwh)}
        unit="kWh"
        tone="text-signal-green"
      />
    </div>
  );
}
