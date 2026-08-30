import { cn } from "./cn";

export type MeterTone = "cyan" | "blue" | "green" | "amber" | "orange" | "red" | "ice";

const TONE: Record<MeterTone, string> = {
  cyan: "bg-signal-cyan",
  blue: "bg-signal-blue",
  green: "bg-signal-green",
  amber: "bg-signal-amber",
  orange: "bg-signal-orange",
  red: "bg-signal-red",
  ice: "bg-signal-ice",
};

export function Meter({
  value,
  tone = "cyan",
  className,
}: {
  value: number;
  tone?: MeterTone;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, value));
  return (
    <div
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-ops-bg ring-1 ring-inset ring-ops-border",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out",
          TONE[tone],
        )}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
