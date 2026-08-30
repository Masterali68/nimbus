import type { ReactNode } from "react";
import { cn } from "./cn";

export type Tone =
  | "cyan"
  | "blue"
  | "green"
  | "amber"
  | "orange"
  | "red"
  | "ice"
  | "neutral";

const TONE: Record<Tone, string> = {
  cyan: "bg-signal-cyan/12 text-signal-cyan ring-signal-cyan/30",
  blue: "bg-signal-blue/12 text-signal-blue ring-signal-blue/30",
  green: "bg-signal-green/12 text-signal-green ring-signal-green/30",
  amber: "bg-signal-amber/12 text-signal-amber ring-signal-amber/30",
  orange: "bg-signal-orange/14 text-signal-orange ring-signal-orange/30",
  red: "bg-signal-red/14 text-signal-red ring-signal-red/40",
  ice: "bg-signal-ice/15 text-signal-ice ring-signal-ice/40",
  neutral: "bg-ops-raised text-ops-muted ring-ops-border",
};

export function Badge({
  tone = "neutral",
  children,
  dot = false,
  pulse = false,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  dot?: boolean;
  pulse?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset",
        TONE[tone],
        className,
      )}
    >
      {dot && (
        <span
          className={cn("h-1.5 w-1.5 rounded-full bg-current", pulse && "nimbus-pulse")}
        />
      )}
      {children}
    </span>
  );
}
