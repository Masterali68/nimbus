import type { ResourceState } from "@/types/nimbus";
import { Badge, type Tone } from "@/components/ui/Badge";

const MAP: Record<ResourceState, { tone: Tone; label: string }> = {
  protected: { tone: "ice", label: "Protected" },
  normal: { tone: "cyan", label: "Normal" },
  throttled: { tone: "amber", label: "Throttled" },
  reduced: { tone: "orange", label: "Reduced" },
  shed: { tone: "red", label: "Shed" },
  cooldown: { tone: "blue", label: "Cooldown" },
};

export function StateBadge({ state }: { state: ResourceState }) {
  const s = MAP[state];
  return (
    <Badge tone={s.tone} dot pulse={state === "shed"}>
      {s.label}
    </Badge>
  );
}
