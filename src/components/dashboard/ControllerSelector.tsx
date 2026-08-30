import type { ControllerMode } from "@/types/nimbus";
import { cn } from "@/components/ui/cn";
import { Panel } from "@/components/ui/Panel";
import { CONTROLLERS } from "@/lib/mock/nimbusMock";

const ACTIVE_TONE: Record<ControllerMode, string> = {
  naive: "text-ops-text",
  reactive: "text-signal-cyan",
  nimbus: "text-signal-blue",
};

export function ControllerSelector({
  value,
  onChange,
}: {
  value: ControllerMode;
  onChange: (mode: ControllerMode) => void;
}) {
  const active = CONTROLLERS.find((c) => c.id === value);

  return (
    <Panel title="Controller">
      <div className="flex flex-col gap-3">
        <div className="inline-flex rounded-lg border border-ops-border bg-ops-bg p-1">
          {CONTROLLERS.map((c) => {
            const on = c.id === value;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onChange(c.id)}
                aria-pressed={on}
                className={cn(
                  "flex-1 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                  on
                    ? cn("bg-ops-raised", ACTIVE_TONE[c.id])
                    : "text-ops-dim hover:text-ops-muted",
                )}
              >
                {c.label}
              </button>
            );
          })}
        </div>
        {active && (
          <p className="text-xs leading-relaxed text-ops-muted">{active.blurb}</p>
        )}
      </div>
    </Panel>
  );
}
