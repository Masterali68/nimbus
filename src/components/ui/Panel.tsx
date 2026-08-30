import type { ReactNode } from "react";
import { cn } from "./cn";

export function Panel({
  title,
  right,
  children,
  className,
  bodyClassName,
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("rounded-xl border border-ops-border bg-ops-panel", className)}>
      {(title || right) && (
        <header className="flex items-center justify-between gap-3 border-b border-ops-border px-4 py-3">
          {title && (
            <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ops-muted">
              {title}
            </h2>
          )}
          {right}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}
