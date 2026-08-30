import type { ControllerMode, IslandState } from "@/types/nimbus";
import { CONTROLLER_LABEL, EVENTS } from "@/lib/api/catalog";
import type { ConnectionState } from "@/lib/api/types";
import { StatusBadge } from "./StatusBadge";
import { ConnectionBadge } from "./ConnectionBadge";

export function Header({
  state,
  connection,
  source,
  switchingController,
}: {
  state: IslandState;
  connection: ConnectionState;
  source: "live" | "mock";
  switchingController?: ControllerMode | null;
}) {
  const event = state.activeEvent
    ? EVENTS.find((e) => e.id === state.activeEvent)
    : null;

  return (
    <header className="sticky top-0 z-10 border-b border-ops-border bg-ops-bg/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-lg font-bold tracking-[0.3em] text-ops-text">
            NIMBUS
          </span>
          <span className="hidden text-sm text-ops-muted sm:inline">
            Autonomous Island Energy Management
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-ops-dim">
              Controller
            </span>
            <span className="font-medium text-ops-text">
              {CONTROLLER_LABEL[state.controller]}
              {switchingController && switchingController !== state.controller && (
                <span className="ml-1 text-ops-dim">
                  → {CONTROLLER_LABEL[switchingController]}
                </span>
              )}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-ops-dim">
              Active event
            </span>
            <span className="font-medium text-ops-text">
              {event ? `${event.glyph} ${event.label}` : "None"}
            </span>
          </div>
          <StatusBadge status={state.status} />
          <ConnectionBadge connection={connection} source={source} />
        </div>
      </div>
    </header>
  );
}
