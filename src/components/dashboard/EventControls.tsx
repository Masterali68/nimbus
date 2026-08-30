import type { IslandEvent } from "@/types/nimbus";
import { cn } from "@/components/ui/cn";
import { Panel } from "@/components/ui/Panel";
import { EVENTS } from "@/lib/api/catalog";

function Spinner() {
  return (
    <span
      aria-hidden
      className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
    />
  );
}

export function EventControls({
  activeEvent,
  pendingEvent,
  busy = false,
  error,
  onTrigger,
  onReset,
}: {
  activeEvent: IslandEvent | null;
  pendingEvent: IslandEvent | "reset" | null;
  /** Disable the whole panel (e.g. controller mid-switch). */
  busy?: boolean;
  error?: string | null;
  onTrigger: (event: IslandEvent) => void;
  onReset: () => void;
}) {
  const anyPending = pendingEvent !== null;
  const lock = anyPending || busy;

  return (
    <Panel title="Event Controls">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {EVENTS.map((e) => {
          const active = activeEvent === e.id;
          const pending = pendingEvent === e.id;
          return (
            <button
              key={e.id}
              type="button"
              onClick={() => onTrigger(e.id)}
              disabled={lock}
              aria-pressed={active}
              title={e.blurb}
              className={cn(
                "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "border-signal-amber/60 bg-signal-amber/15 text-signal-amber"
                  : "border-ops-border text-ops-muted hover:border-ops-dim hover:bg-ops-raised hover:text-ops-text",
                lock && "cursor-not-allowed opacity-50 hover:bg-transparent",
                pending && "opacity-100",
              )}
            >
              {pending ? <Spinner /> : <span aria-hidden>{e.glyph}</span>}
              <span className="truncate">{e.label}</span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={onReset}
        disabled={lock}
        className={cn(
          "mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-signal-green/40 px-3 py-2 text-sm font-semibold text-signal-green transition-colors hover:bg-signal-green/10",
          lock && "cursor-not-allowed opacity-50 hover:bg-transparent",
        )}
      >
        {pendingEvent === "reset" && <Spinner />}
        Reset to stable
      </button>

      <p className="mt-2 text-xs text-ops-dim">
        {activeEvent
          ? "An event is active. Reset returns the island to a stable baseline."
          : "Island is stable. Trigger an event to see Nimbus respond."}
      </p>

      {error && (
        <p className="mt-2 rounded-md bg-signal-red/10 px-2.5 py-1.5 text-xs text-signal-red ring-1 ring-inset ring-signal-red/30">
          {error}
        </p>
      )}
    </Panel>
  );
}
