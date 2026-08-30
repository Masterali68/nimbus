"use client";

import type { CSSProperties } from "react";
import type { ResourceState, ResourceStatus } from "@/types/nimbus";
import { cn } from "@/components/ui/cn";
import { Meter, type MeterTone } from "@/components/ui/Meter";
import { n1 } from "@/components/ui/format";
import { useFlash } from "@/components/ui/useFlash";
import { operatingCaption, STATE_MEANING } from "@/lib/api/catalog";
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

const FLASH_COLOR: Record<ResourceState, string> = {
  protected: "rgba(219,234,254,0.55)",
  normal: "rgba(56,189,248,0.45)",
  throttled: "rgba(251,191,36,0.55)",
  reduced: "rgba(251,146,60,0.55)",
  shed: "rgba(248,113,113,0.6)",
  cooldown: "rgba(59,130,246,0.5)",
};

const ACCENT: Record<ResourceStatus["criticality"], string> = {
  vital: "border-l-signal-ice",
  high: "border-l-signal-cyan",
  standard: "border-l-signal-blue",
  deferrable: "border-l-ops-dim",
};

export function ResourceCard({ resource }: { resource: ResourceStatus }) {
  const isVital = resource.criticality === "vital";
  const isProtected = resource.state === "protected";
  const isShed = resource.state === "shed";
  const isCooldown = resource.state === "cooldown";
  const flash = useFlash(resource.state);

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-xl border border-l-4 border-ops-border bg-ops-panel p-4 transition-all duration-500",
        ACCENT[resource.criticality],
        isVital && "bg-ops-raised",
        isShed && "opacity-60",
        flash && "nimbus-flash",
      )}
      style={
        {
          "--nimbus-flash-color": FLASH_COLOR[resource.state],
          boxShadow:
            isVital && isProtected
              ? "0 0 0 1px rgba(219,234,254,0.3), 0 0 32px -6px rgba(56,189,248,0.5)"
              : undefined,
        } as CSSProperties
      }
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          {isVital && (
            <svg viewBox="0 0 24 24" aria-hidden className="h-4 w-4 fill-signal-ice">
              <path d="M12 2l7 3v6c0 4.4-3 8.5-7 9.9C8 19.5 5 15.4 5 11V5l7-3z" />
            </svg>
          )}
          <span className="font-semibold text-ops-text">{resource.name}</span>
        </div>
        <CriticalityBadge criticality={resource.criticality} />
      </div>

      <div className="flex items-end justify-between gap-2">
        <span className="font-mono text-3xl tabular-nums text-ops-text">
          {Math.round(resource.operatingPct)}
          <span className="ml-0.5 text-base text-ops-dim">%</span>
        </span>
        <StateBadge state={resource.state} />
      </div>

      <div className="relative">
        <Meter value={resource.operatingPct} tone={METER_TONE[resource.state]} />
        {isCooldown && (
          <span className="pointer-events-none absolute inset-0 rounded-full nimbus-sheen" />
        )}
      </div>

      <div className="flex items-center justify-between text-xs">
        <span
          className={cn(
            "font-medium",
            isProtected
              ? "text-signal-ice"
              : isShed
                ? "text-signal-red"
                : "text-ops-muted",
          )}
        >
          {operatingCaption(resource.state, resource.operatingPct)}
        </span>
        <span className="font-mono tabular-nums text-ops-text">
          {n1(resource.demandKw)} kW
        </span>
      </div>

      <p className="text-[11px] leading-snug text-ops-dim">
        {STATE_MEANING[resource.state]}
      </p>
    </div>
  );
}
