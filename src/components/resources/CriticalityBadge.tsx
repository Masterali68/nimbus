import type { ResourceCriticality } from "@/types/nimbus";
import { Badge, type Tone } from "@/components/ui/Badge";

const MAP: Record<ResourceCriticality, { tone: Tone; label: string }> = {
  vital: { tone: "ice", label: "Vital" },
  high: { tone: "cyan", label: "High" },
  standard: { tone: "blue", label: "Standard" },
  deferrable: { tone: "neutral", label: "Deferrable" },
};

export function CriticalityBadge({
  criticality,
}: {
  criticality: ResourceCriticality;
}) {
  const c = MAP[criticality];
  return <Badge tone={c.tone}>{c.label}</Badge>;
}
