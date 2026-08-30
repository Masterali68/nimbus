"use client";

import { Panel } from "@/components/ui/Panel";
import { cn } from "@/components/ui/cn";
import { n0 } from "@/components/ui/format";
import type {
  EvaluationResult,
  ScoreComponent,
} from "@/lib/api/evaluation";
import { CONTROLLER_META, CONTROLLER_ORDER } from "./controllers";
import { ProgressBar } from "./ProgressBar";

const SCORE_DISCLAIMER =
  "Prototype Evaluation Score. Weighting is configurable and is not presented as a scientifically optimal utility-grid metric.";

const REWARDS = [
  "Critical-service uptime",
  "Water availability",
  "Energy stability",
  "Battery preservation",
  "Faster recovery",
];

const PENALTIES = [
  "Unnecessary shedding",
  "Oscillation",
  "Repeated state changes",
  "Critical-service interruptions",
  "Long recovery time",
];

function collectComponents(
  result: EvaluationResult,
  kind: "reward" | "penalty",
): { label: string; byController: Record<string, number | null> }[] {
  const order: string[] = [];
  const map = new Map<string, Record<string, number | null>>();
  for (const key of CONTROLLER_ORDER) {
    const bd = result.controllers[key]?.scoreBreakdown;
    const list: ScoreComponent[] =
      bd == null ? [] : kind === "reward" ? bd.rewards : bd.penalties;
    for (const c of list) {
      if (!map.has(c.label)) {
        map.set(c.label, { naive: null, reactive: null, nimbus: null });
        order.push(c.label);
      }
      map.get(c.label)![key] = c.value;
    }
  }
  return order.map((label) => ({ label, byController: map.get(label)! }));
}

export function NimbusScorePanel({ result }: { result: EvaluationResult }) {
  const scores = CONTROLLER_ORDER.map((key) => ({
    key,
    value: result.controllers[key]?.nimbusScore ?? null,
  }));
  const known = scores.filter((s) => s.value != null) as {
    key: (typeof scores)[number]["key"];
    value: number;
  }[];
  const maxScore = known.length ? Math.max(...known.map((s) => s.value)) : 0;
  const best =
    known.length >= 2 && !known.every((s) => s.value === known[0].value)
      ? maxScore
      : null;

  const rewardRows = collectComponents(result, "reward");
  const penaltyRows = collectComponents(result, "penalty");
  const hasBreakdown = rewardRows.length > 0 || penaltyRows.length > 0;

  return (
    <Panel title="Prototype Nimbus Score">
      <div className="flex flex-col gap-5">
        {/* score tiles */}
        <div className="grid gap-3 sm:grid-cols-3">
          {scores.map((s) => {
            const meta = CONTROLLER_META[s.key];
            const isBest = best != null && s.value === best;
            return (
              <div
                key={s.key}
                className={cn(
                  "flex flex-col gap-2 rounded-lg border border-ops-border bg-ops-bg/40 p-3",
                  isBest && "ring-1 ring-inset ring-signal-green/40",
                )}
              >
                <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-ops-dim">
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: meta.color }}
                  />
                  {meta.label}
                </div>
                <div className="font-mono text-2xl tabular-nums text-ops-text">
                  {s.value == null ? "—" : n0(s.value)}
                  <span className="ml-1 text-xs text-ops-dim">pts</span>
                </div>
                <ProgressBar
                  percent={
                    s.value == null || maxScore === 0
                      ? 0
                      : (s.value / maxScore) * 100
                  }
                  tone="bg-signal-cyan"
                />
              </div>
            );
          })}
        </div>

        {known.length === 0 && (
          <p className="text-[11px] text-ops-dim">
            Scores were not reported by the backend for this run.
          </p>
        )}

        {/* what the score rewards / penalizes */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-signal-green">
              Rewards
            </h3>
            <ul className="flex flex-col gap-1 text-sm text-ops-muted">
              {REWARDS.map((r) => (
                <li key={r} className="flex gap-2">
                  <span className="text-signal-green" aria-hidden>
                    +
                  </span>
                  {r}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-signal-red">
              Penalizes
            </h3>
            <ul className="flex flex-col gap-1 text-sm text-ops-muted">
              {PENALTIES.map((p) => (
                <li key={p} className="flex gap-2">
                  <span className="text-signal-red" aria-hidden>
                    −
                  </span>
                  {p}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* optional per-component contributions, only if backend supplies them */}
        {hasBreakdown && (
          <div className="flex flex-col gap-2 rounded-lg border border-ops-border bg-ops-bg/40 p-3">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-ops-dim">
              Score contributions (from backend)
            </span>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="text-ops-dim">
                    <th className="py-1 text-left font-medium">Component</th>
                    {CONTROLLER_ORDER.map((k) => (
                      <th key={k} className="py-1 text-right font-medium">
                        {CONTROLLER_META[k].label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[...rewardRows, ...penaltyRows].map((row) => (
                    <tr key={row.label} className="border-t border-ops-border/50">
                      <td className="py-1 pr-2 text-ops-muted">{row.label}</td>
                      {CONTROLLER_ORDER.map((k) => (
                        <td
                          key={k}
                          className="py-1 text-right font-mono tabular-nums text-ops-text"
                        >
                          {row.byController[k] == null
                            ? "—"
                            : row.byController[k]! > 0
                              ? `+${n0(row.byController[k]!)}`
                              : n0(row.byController[k]!)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <p className="text-sm leading-relaxed text-ops-muted">
          The score is one configurable way to summarize the trade-offs in the
          table above — not a definitive measure of success.
        </p>
        <p className="rounded-md bg-ops-raised px-3 py-2 text-[11px] font-medium text-ops-muted ring-1 ring-inset ring-ops-border">
          {SCORE_DISCLAIMER}
        </p>
      </div>
    </Panel>
  );
}

export { SCORE_DISCLAIMER };
