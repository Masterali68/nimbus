"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/Panel";
import { cn } from "@/components/ui/cn";

/**
 * Presenter script for the 90–120 second hackathon demo. This is a static
 * teleprompter for whoever is driving the live dashboard + this evaluation
 * page — it does not automate the dashboard (that lives on another route/owner).
 */

interface Step {
  t: string;
  title: string;
  detail: string;
}

const STEPS: Step[] = [
  { t: "0:00", title: "Stable island", detail: "Open the dashboard. Solar + wind cover demand, battery healthy, all four resources green." },
  { t: "0:12", title: "Explain the setup", detail: "Point out solar, wind, battery, and the four consumers ranked by priority: Hospital → Desalination → Residential → Resort." },
  { t: "0:28", title: "Trigger STORM", detail: "Fire the Storm event. Call it out: same event every controller will face." },
  { t: "0:38", title: "Generation collapses", detail: "Live Energy chart: solar and wind fall away, net power goes negative, the island runs on battery." },
  { t: "0:50", title: "Trajectory: DETERIORATING", detail: "Stability panel flips to Deteriorating — velocity and acceleration turn negative before the battery is low. Nimbus is already acting." },
  { t: "1:02", title: "Hospital protected", detail: "Hospital card stays at 100% — held, never reduced." },
  { t: "1:10", title: "Desalination throttled", detail: "Desalination smoothly ramps down — water slows, it doesn't stop." },
  { t: "1:18", title: "Resort shed", detail: "Resort, lowest priority, is shed first to preserve the essentials." },
  { t: "1:26", title: "Why Nimbus Acted", detail: "Read the plain-English explanation panel — the decision and its expected outcome." },
  { t: "1:36", title: "Compare controllers", detail: "Switch the controller to Naive, same storm: blunt threshold cut that also hits essential loads." },
  { t: "1:48", title: "Evaluation results", detail: "Come to this page. Run (or show the last) evaluation: comparison table + charts across identical scenarios." },
  { t: "2:00", title: "Close", detail: "Nimbus doesn't just react to how much energy is left — it responds to where the system is heading, while protecting what matters most." },
];

export function DemoGuide() {
  const [open, setOpen] = useState(false);

  return (
    <Panel
      title="Presenter demo script (90–120s)"
      right={
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-ops-border px-2.5 py-1 text-[11px] font-semibold text-ops-muted hover:bg-ops-raised"
          aria-expanded={open}
        >
          {open ? "Hide" : "Show"}
        </button>
      }
    >
      {open ? (
        <ol className="flex flex-col gap-2">
          {STEPS.map((s, i) => (
            <li
              key={s.t}
              className={cn(
                "flex gap-3 rounded-lg border border-ops-border bg-ops-bg/40 p-2.5 text-sm",
                i === STEPS.length - 1 && "border-signal-blue/40 bg-signal-blue/5",
              )}
            >
              <span className="w-10 shrink-0 font-mono text-xs text-ops-dim">
                {s.t}
              </span>
              <span>
                <span className="font-semibold text-ops-text">{s.title}</span>
                <span className="block text-ops-muted">{s.detail}</span>
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="text-sm text-ops-muted">
          A step-by-step teleprompter for the live demo — stable island → storm →
          trajectory → priority-aware response → controller comparison → these
          results. Click “Show”.
        </p>
      )}
    </Panel>
  );
}
