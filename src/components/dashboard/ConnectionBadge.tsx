import type { ConnectionState } from "@/lib/api/types";
import { Badge, type Tone } from "@/components/ui/Badge";

const MAP: Record<
  ConnectionState,
  { tone: Tone; label: string; pulse: boolean }
> = {
  connecting: { tone: "blue", label: "Connecting", pulse: true },
  live: { tone: "green", label: "Live", pulse: false },
  reconnecting: { tone: "amber", label: "Reconnecting", pulse: true },
  offline: { tone: "red", label: "Backend offline", pulse: true },
};

export function ConnectionBadge({
  connection,
  source,
}: {
  connection: ConnectionState;
  source: "live" | "mock";
}) {
  const c = MAP[connection];
  const label =
    source === "mock" && connection !== "connecting"
      ? "Simulated data"
      : c.label;
  const tone: Tone = source === "mock" && connection !== "connecting" ? "amber" : c.tone;

  return (
    <Badge tone={tone} dot pulse={c.pulse} className="px-3 py-1 text-xs">
      {label}
    </Badge>
  );
}
