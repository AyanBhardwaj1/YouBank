"use client";

/**
 * Two Home widgets that need nothing from a server: World markets (which exchanges trade now, and when
 * that changes in the person's own time) and Quick calc (the calc engine the AI uses, in a box).
 */
import { useMemo, useState } from "react";
import { useNow } from "@/components/ui/useNow";
import { WIDGET_LABEL } from "@/lib/desk/desk";
import { EXCHANGES, marketStatus, until } from "@/lib/desk/markets";
import { evaluateScript } from "@/lib/calc";

const box = (roomy?: boolean) => (roomy ? "home-card p-5" : "panel p-3");
const H = ({ children, right, roomy }: { children: React.ReactNode; right?: React.ReactNode; roomy?: boolean }) => (
  <div className="mb-2 flex items-baseline justify-between gap-2">
    <h2 className={roomy ? "text-[14px] font-semibold text-fg" : "text-[11px] uppercase tracking-wider text-muted"}>{children}</h2>
    {right}
  </div>
);

export function MarketsWidget({ roomy }: { roomy?: boolean }) {
  const t = useNow();
  const now = useMemo(() => (t === null ? null : new Date(t)), [t]);
  const rows = useMemo(() => (now ? EXCHANGES.map((ex) => ({ ex, s: marketStatus(ex, now) })) : []), [now]);
  const local = (d: Date) => d.toLocaleString(undefined, { weekday: d.toDateString() === now?.toDateString() ? undefined : "short", hour: "numeric", minute: "2-digit" });
  return (
    <section className={box(roomy)} aria-label={WIDGET_LABEL.markets}>
      <H roomy={roomy} right={<span className="text-[10.5px] text-faint">your time · holidays not counted</span>}>{WIDGET_LABEL.markets}</H>
      {!now ? <div className="shimmer h-24 ctl" /> : (
        <ul className={`grid gap-x-4 gap-y-0.5 ${roomy ? "sm:grid-cols-2 text-[12.5px]" : "text-[12px]"}`}>
          {rows.map(({ ex, s }) => (
            <li key={ex.id} className="flex items-center gap-2 py-1">
              <span className={`h-2 w-2 shrink-0 rounded-full ${s.state === "open" ? "bg-pos" : s.state === "lunch" ? "bg-accent" : "bg-line-strong"}`} aria-hidden />
              <span className="min-w-0 flex-1 truncate"><span className="text-fg">{ex.name}</span> <span className="text-muted">{ex.city}</span></span>
              <span className="num shrink-0 text-[11px] text-muted" title={s.next ? `${s.nextIs === "opens" ? "Opens" : "Closes"} ${local(s.next)}` : undefined}>
                {s.next ? <>{s.state === "open" ? "closes" : s.state === "lunch" ? "lunch, back" : "opens"} {s.state === "closed" && s.next.getTime() - now.getTime() > 12 * 3600_000 ? local(s.next) : `in ${until(s.next, now)}`}</> : "always open"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const fmtNum = (v: number) => (Math.abs(v) >= 1e12 || (Math.abs(v) < 1e-4 && v !== 0) ? v.toExponential(4) : v.toLocaleString("en-US", { maximumFractionDigits: 6 }));

export function CalcWidget({ roomy }: { roomy?: boolean }) {
  const [src, setSrc] = useState("");
  const out = useMemo(() => {
    if (!src.trim()) return null;
    try { return { ok: true as const, ...evaluateScript(src) }; } catch (e) { return { ok: false as const, msg: e instanceof Error && e.message.length < 120 ? e.message : "That could not be read as a calculation." }; }
  }, [src]);
  const last = out?.ok ? out.results[out.results.length - 1] : null;
  return (
    <section className={box(roomy)} aria-label={WIDGET_LABEL.calc}>
      <H roomy={roomy} right={<span className="text-[10.5px] text-faint">k m b %, npv irr pmt</span>}>{WIDGET_LABEL.calc}</H>
      <textarea value={src} onChange={(e) => setSrc(e.target.value)} rows={roomy ? 3 : 2} spellCheck={false} aria-label="Calculation"
        placeholder={"ev = 5.4b + 1.2b - 0.8b\nev / 380m"}
        className="num ctl w-full resize-y border border-line bg-bg/40 px-2.5 py-1.5 text-[12.5px] text-fg outline-none placeholder:text-faint focus:border-accent" />
      <div className="mt-1.5 flex min-h-[1.5rem] items-baseline justify-between gap-2" aria-live="polite">
        {out && !out.ok && <span className="text-[11.5px] text-muted">{out.msg}</span>}
        {last && <><span className="truncate text-[11px] text-muted">{out?.ok && out.results.length > 1 ? `${out.results.length} lines` : "="}</span><span className="num text-[16px] font-semibold text-fg">{fmtNum(last.value)}</span></>}
      </div>
    </section>
  );
}
