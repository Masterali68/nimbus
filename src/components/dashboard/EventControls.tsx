import type { IslandEvent } from "@/types/nimbus";
import { cn } from "@/components/ui/cn";
import { Panel } from "@/components/ui/Panel";
import { EVENTS } from "@/lib/mock/nimbusMock";

export function EventControls({
  activeEvent,
  onTrigger,
  onReset,
}: {
  activeEvent: IslandEvent | null;
  onTrigger: (event: IslandEvent) => void;
  onReset: () => void;
}) {
  return (
    <Panel title="Event Controls">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {EVENTS.map((e) => {
          const active = activeEvent === e.id;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onTrigger(e.id)}
              aria-pressed={active}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-signal-amber/50 bg-signal-amber/15 text-signal-amber"
                  : "border-ops-border text-ops-muted hover:border-ops-dim hover:bg-ops-raised hover:text-ops-text",
              )}
            >
              <span aria-hidden>{e.glyph}</span>
              <span>{e.label}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onReset}
        className="mt-2 w-full rounded-lg border border-signal-green/40 px-3 py-2 text-sm font-semibold text-signal-green transition-colors hover:bg-signal-green/10"
      >
        Reset
      </button>
    </Panel>
  );
}
