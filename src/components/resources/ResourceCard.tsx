import type { ResourceState, ResourceStatus } from "@/types/nimbus";
import { cn } from "@/components/ui/cn";
import { Meter, type MeterTone } from "@/components/ui/Meter";
import { n1 } from "@/components/ui/format";
import { CriticalityBadge } from "./CriticalityBadge";
import { StateBadge } from "./StateBadge";

const METER_TONE: Record<ResourceState, MeterTone> = {
  protected: "ice",
  normal: "cyan",
  throttled: "amber",
  reduced: "orange",
  shed: "red",
  cooldown: "blue",
};

const ACCENT: Record<ResourceStatus["criticality"], string> = {
  vital: "border-l-signal-ice",
  high: "border-l-signal-cyan",
  standard: "border-l-signal-blue",
  deferrable: "border-l-ops-dim",
};

export function ResourceCard({ resource }: { resource: ResourceStatus }) {
  const isVital = resource.criticality === "vital";
  const isDeferrable = resource.criticality === "deferrable";

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-l-4 border-ops-border bg-ops-panel p-4 transition-colors",
        ACCENT[resource.criticality],
        isVital && "bg-ops-raised",
        isDeferrable && "opacity-95",
      )}
      style={
        isVital
          ? {
              boxShadow:
                "0 0 0 1px rgba(219,234,254,0.22), 0 0 28px -8px rgba(56,189,248,0.4)",
            }
          : undefined
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {isVital && (
            <svg
              viewBox="0 0 24 24"
              aria-hidden
              className="h-4 w-4 fill-signal-ice"
            >
              <path d="M12 2l7 3v6c0 4.4-3 8.5-7 9.9C8 19.5 5 15.4 5 11V5l7-3z" />
            </svg>
          )}
          <span className="font-semibold text-ops-text">{resource.name}</span>
        </div>
        <CriticalityBadge criticality={resource.criticality} />
      </div>

      <div className="flex items-end justify-between gap-2">
        <span className="font-mono text-3xl tabular-nums text-ops-text">
          {resource.operatingPct}
          <span className="ml-0.5 text-base text-ops-dim">%</span>
        </span>
        <StateBadge state={resource.state} />
      </div>

      <Meter value={resource.operatingPct} tone={METER_TONE[resource.state]} />

      <div className="flex items-center justify-between text-xs text-ops-muted">
        <span>Current demand</span>
        <span className="font-mono tabular-nums text-ops-text">
          {n1(resource.demandKw)} kW
        </span>
      </div>
    </div>
  );
}
