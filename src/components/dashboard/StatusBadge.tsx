import type { SystemStatus } from "@/types/nimbus";
import { Badge, type Tone } from "@/components/ui/Badge";

const MAP: Record<SystemStatus, { tone: Tone; label: string }> = {
  stable: { tone: "cyan", label: "Stable" },
  watch: { tone: "blue", label: "Watch" },
  warning: { tone: "amber", label: "Warning" },
  critical: { tone: "red", label: "Critical" },
};

export function StatusBadge({ status }: { status: SystemStatus }) {
  const s = MAP[status];
  return (
    <Badge
      tone={s.tone}
      dot
      pulse={status === "warning" || status === "critical"}
      className="px-3 py-1 text-xs"
    >
      {s.label}
    </Badge>
  );
}
