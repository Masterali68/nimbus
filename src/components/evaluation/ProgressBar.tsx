import { cn } from "@/components/ui/cn";

/**
 * Thin horizontal progress bar. Pass `percent` for a determinate fill, or
 * `indeterminate` for an honest "working, no detail" state.
 */
export function ProgressBar({
  percent,
  indeterminate = false,
  tone = "bg-signal-blue",
  className,
}: {
  percent?: number | null;
  indeterminate?: boolean;
  tone?: string;
  className?: string;
}) {
  const pct =
    percent == null ? 0 : Math.max(0, Math.min(100, percent));

  return (
    <div
      className={cn(
        "h-2 w-full overflow-hidden rounded-full bg-ops-bg ring-1 ring-inset ring-ops-border",
        className,
      )}
      role="progressbar"
      aria-valuenow={indeterminate ? undefined : Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={cn(
          "h-full rounded-full transition-[width] duration-500 ease-out",
          tone,
          indeterminate && "w-1/3 animate-pulse",
        )}
        style={indeterminate ? undefined : { width: `${pct}%` }}
      />
    </div>
  );
}
