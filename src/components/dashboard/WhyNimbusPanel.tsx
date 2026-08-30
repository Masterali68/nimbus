import type { NimbusDecision, ResourceId } from "@/types/nimbus";
import { Panel } from "@/components/ui/Panel";
import { Badge, type Tone } from "@/components/ui/Badge";

const NAME: Record<ResourceId, string> = {
  hospital: "Hospital",
  desalination: "Desalination",
  residential: "Residential",
  resort: "Resort",
};

type GroupKey =
  | "protectedResources"
  | "throttledResources"
  | "reducedResources"
  | "shedResources";

const GROUPS: { key: GroupKey; label: string; tone: Tone }[] = [
  { key: "protectedResources", label: "Protected", tone: "ice" },
  { key: "throttledResources", label: "Throttled", tone: "amber" },
  { key: "reducedResources", label: "Reduced", tone: "orange" },
  { key: "shedResources", label: "Shed", tone: "red" },
];

export function WhyNimbusPanel({ decision }: { decision: NimbusDecision }) {
  return (
    <Panel title="Why Nimbus Acted">
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="font-semibold text-ops-text">{decision.title}</h3>
          <p className="mt-1 text-sm leading-relaxed text-ops-muted">
            {decision.explanation}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ops-dim">
            Actions taken
          </span>
          {decision.actions.length === 0 ? (
            <p className="text-sm text-ops-muted">
              No load adjustments — all resources nominal.
            </p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {decision.actions.map((a) => (
                <li
                  key={a.resource}
                  className="flex items-center justify-between gap-3 text-sm"
                >
                  <span className="text-ops-text">{NAME[a.resource]}</span>
                  <span className="text-ops-muted">{a.action}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {GROUPS.map((g) => {
            const ids = decision[g.key];
            if (!ids.length) return null;
            return (
              <div key={g.label} className="flex items-center gap-1.5">
                <Badge tone={g.tone}>{g.label}</Badge>
                <span className="text-xs text-ops-muted">
                  {ids.map((id) => NAME[id]).join(", ")}
                </span>
              </div>
            );
          })}
        </div>

        <div>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ops-dim">
            Expected outcome
          </span>
          <p className="mt-1 text-sm leading-relaxed text-ops-muted">
            {decision.expectedOutcome}
          </p>
        </div>
      </div>
    </Panel>
  );
}
