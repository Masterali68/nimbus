import type { ControllerMode } from "@/types/nimbus";
import { cn } from "@/components/ui/cn";
import { Panel } from "@/components/ui/Panel";
import { CONTROLLERS } from "@/lib/api/catalog";

const ACTIVE_TONE: Record<ControllerMode, string> = {
  naive: "text-ops-text",
  reactive: "text-signal-cyan",
  nimbus: "text-signal-blue",
};

export function ControllerSelector({
  value,
  switching,
  error,
  onChange,
}: {
  value: ControllerMode;
  /** Controller whose switch is in flight, if any. */
  switching?: ControllerMode | null;
  error?: string | null;
  onChange: (mode: ControllerMode) => void;
}) {
  const shown = switching ?? value;
  const active = CONTROLLERS.find((c) => c.id === shown);
  const locked = switching != null;

  return (
    <Panel title="Controller">
      <div className="flex flex-col gap-3">
        <div className="inline-flex rounded-lg border border-ops-border bg-ops-bg p-1">
          {CONTROLLERS.map((c) => {
            const on = c.id === shown;
            const pending = switching === c.id;
            return (
              <button
                key={c.id}
                type="button"
                onClick={() => onChange(c.id)}
                disabled={locked}
                aria-pressed={on}
                className={cn(
                  "flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors",
                  on
                    ? cn("bg-ops-raised", ACTIVE_TONE[c.id])
                    : "text-ops-dim hover:text-ops-muted",
                  locked && "cursor-not-allowed",
                )}
              >
                {pending && (
                  <span
                    aria-hidden
                    className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent"
                  />
                )}
                {c.label}
              </button>
            );
          })}
        </div>

        {active && (
          <p className="text-xs leading-relaxed text-ops-muted">
            {locked ? `Switching to ${active.label}…` : active.blurb}
          </p>
        )}

        {error && (
          <p className="rounded-md bg-signal-red/10 px-2.5 py-1.5 text-xs text-signal-red ring-1 ring-inset ring-signal-red/30">
            {error}
          </p>
        )}
      </div>
    </Panel>
  );
}
