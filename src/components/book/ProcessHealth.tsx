import type { HealthItem, HealthStatus } from "@/lib/book/process";
import { healthLine } from "@/lib/book/process";

const TONE: Record<HealthStatus, string> = { good: "text-pos", watch: "text-accent", fix: "text-neg", none: "text-muted" };
const WORD: Record<HealthStatus, string> = { good: "Good", watch: "Watch", fix: "Fix", none: "Not yet" };

/** The process-health panel (src/lib/book/process.ts): server-rendered, printable. */
export function ProcessHealth({ items, heading = true }: { items: HealthItem[]; heading?: boolean }) {
  return (
    <section className="mt-4 break-inside-avoid-page" aria-label="Process health">
      {heading && <h2 className="text-[10px] uppercase tracking-wider text-muted">Process health (from the journal, the daily checks and the track record)</h2>}
      <p className="mt-0.5">{healthLine(items)}</p>
      <ul className="mt-1 grid gap-x-4 gap-y-1 sm:grid-cols-2">
        {items.map((x) => (
          <li key={x.key} className="text-[11.5px]">
            <span className={`font-semibold ${TONE[x.status]}`}>{WORD[x.status]}</span> · <span className="font-semibold">{x.label}</span>{x.value !== "—" ? <>: <span className="num">{x.value}</span></> : null}
            <span className="block text-muted">{x.detail}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
