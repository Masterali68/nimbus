"use client";

/**
 * Persistent, unmissable marker shown whenever the page is rendering the local
 * sample fallback instead of a live evaluation. Sample numbers are illustrative
 * and must never be presented as real simulation results.
 */
export function SampleDataBanner({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-signal-amber/50 bg-signal-amber/10 px-4 py-2.5 text-sm text-signal-amber">
      <span>
        <span className="font-bold uppercase tracking-wide">Sample data</span>{" "}
        — illustrative local values, <span className="font-semibold">not</span> a
        live simulation run. Start the backend and run an evaluation for real
        results.
      </span>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded-md border border-signal-amber/40 px-2.5 py-1 text-xs font-semibold hover:bg-signal-amber/10"
        >
          Dismiss
        </button>
      )}
    </div>
  );
}
