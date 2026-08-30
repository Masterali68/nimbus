import { cn } from "@/components/ui/cn";

export function MetricCard({
  label,
  value,
  unit,
  tone,
}: {
  label: string;
  value: string;
  unit: string;
  tone?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-ops-border bg-ops-panel p-3">
      <span className="text-[11px] font-medium uppercase tracking-wide text-ops-dim">
        {label}
      </span>
      <span className="flex items-baseline gap-1">
        <span
          className={cn("font-mono text-xl tabular-nums", tone ?? "text-ops-text")}
        >
          {value}
        </span>
        <span className="text-xs text-ops-dim">{unit}</span>
      </span>
    </div>
  );
}
