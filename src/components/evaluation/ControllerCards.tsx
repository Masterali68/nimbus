import { cn } from "@/components/ui/cn";
import { CONTROLLER_META, CONTROLLER_ORDER } from "./controllers";

/**
 * Three plain-English cards describing how each controller decides. Strategy
 * only — no metrics, no "winner" language. The table and charts show how the
 * strategies actually performed.
 */
export function ControllerCards() {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ops-muted">
        How each controller decides
      </h2>
      <div className="grid gap-4 md:grid-cols-3">
        {CONTROLLER_ORDER.map((key) => {
          const meta = CONTROLLER_META[key];
          return (
            <article
              key={key}
              className={cn(
                "flex flex-col gap-3 rounded-xl border border-l-4 border-ops-border bg-ops-panel p-4",
                meta.accent,
              )}
            >
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: meta.color }}
                />
                <h3 className="font-semibold text-ops-text">
                  {meta.label} Controller
                </h3>
              </div>
              <p className="text-xs font-medium text-ops-muted">{meta.tagline}</p>
              <ul className="flex flex-col gap-1.5 text-sm text-ops-muted">
                {meta.bullets.map((b) => (
                  <li key={b} className="flex gap-2">
                    <span className="text-ops-dim" aria-hidden>
                      •
                    </span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
      <p className="text-[11px] text-ops-dim">
        These describe each controller&rsquo;s method. The table and charts above
        show how those methods actually performed on this run.
      </p>
    </section>
  );
}
