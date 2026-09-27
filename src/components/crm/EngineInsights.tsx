"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { api, btn, type PanelCtx } from "./shared";

type TrustRow = {
  bucket: string; label: string; observations: number; unchanged: number; state: "learning" | "trusted" | "probation";
  mean: number; lower: number; upper: number; certifiedBadRate: number; reason: string;
};
type Suggestion = { scope: string; bucket: string; text: string };
type Lesson = { id: number; context: string; rule: string; evidence: number; confirmed: boolean; updatedAt: string };
type Arm = { arm: string; label: string; pulls: number; rewards: number; negatives: number; pending: number; mean: number; lower: number; upper: number; pBest: number | null; crowdRate: number | null };
export type EngineData = {
  trust: TrustRow[]; suggestions: Suggestion[]; lessons: Lesson[]; angles: Arm[]; hours: Arm[]; signals30d: number;
  errorBudget: { autoSends7d: number; worstCertifiedBadRate: number };
};

const pct = (x: number) => `${Math.round(x * 100)}%`;
const STATE: Record<TrustRow["state"], { label: string; tone: string }> = {
  trusted: { label: "Earned autopilot", tone: "bg-pos/15 text-pos" },
  learning: { label: "Learning", tone: "bg-elevated text-muted" },
  probation: { label: "On probation", tone: "bg-neg/15 text-neg" },
};
const CONTEXT: Record<string, string> = {
  "reply:external": "Replies", "reply:internal": "Coworker replies", campaign: "Campaigns", nurture: "Reconnections", follow_up: "Follow-ups", compose: "New emails", any: "Everywhere",
};

/** A 0–100% track with the posterior mean and its 90% credible interval. */
function Interval({ mean, lower, upper }: { mean: number; lower: number; upper: number }) {
  return (
    <span className="relative block h-2.5 w-full overflow-hidden rounded-sm bg-elevated" aria-label={`${pct(mean)} (90% interval ${pct(lower)} to ${pct(upper)})`}>
      <span className="absolute inset-y-0 rounded-sm opacity-35" style={{ left: `${lower * 100}%`, width: `${Math.max(1, (upper - lower) * 100)}%`, background: "var(--chart-1)" }} />
      <span className="absolute inset-y-0 w-[3px] -translate-x-1/2 rounded-sm" style={{ left: `${mean * 100}%`, background: "var(--chart-emphasis, var(--accent))" }} />
    </span>
  );
}

/** One-click graduations, shown where the person reviews drafts. */
export function Graduations({ ctx }: { ctx: PanelCtx }) {
  const [items, setItems] = useState<Suggestion[]>([]);
  useEffect(() => {
    let cancelled = false;
    api<EngineData>("/api/crm/engine").then((d) => { if (!cancelled) setItems(d.suggestions); }).catch(() => {});
    return () => { cancelled = true; };
  }, [ctx.tick]);
  if (items.length === 0) return null;
  const graduate = (s: Suggestion) => ctx.run(`grad-${s.scope}`, async () => {
    await api("/api/crm/engine", { method: "POST", body: JSON.stringify({ action: "graduate", scope: s.scope }) });
    ctx.say("On autopilot. It still holds anything it is unsure of, and goes back to asking you if you start rewriting these.");
    ctx.refresh();
  });
  return (
    <section className="flex flex-col gap-2">
      {items.map((s) => (
        <article key={s.bucket} className="ctl flex flex-wrap items-center justify-between gap-2 border border-pos/40 bg-pos/5 p-3">
          <p className="flex min-w-0 items-start gap-1.5 text-[12px]"><Icon name="TrendingUp" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pos" /><span>{s.text}</span></p>
          <button type="button" disabled={!!ctx.busy} onClick={() => graduate(s)} className={btn.primary}>Put on autopilot</button>
        </article>
      ))}
    </section>
  );
}

/** What the adaptive engine has learned, with the uncertainty shown rather than hidden. */
export function EngineInsights({ ctx }: { ctx: PanelCtx }) {
  const [d, setD] = useState<EngineData | null>(null);
  useEffect(() => {
    let cancelled = false;
    api<EngineData>("/api/crm/engine").then((x) => { if (!cancelled) setD(x); }).catch(() => {});
    return () => { cancelled = true; };
  }, [ctx.tick]);
  if (!d) return null;

  const retire = (id: number) => ctx.run(`retire-${id}`, async () => { await api(`/api/crm/engine/lessons/${id}`, { method: "DELETE" }); ctx.refresh(); });
  const confirm = (id: number) => ctx.run(`confirm-${id}`, async () => { await api(`/api/crm/engine/lessons/${id}`, { method: "POST" }); ctx.say("Confirmed. It applies to the next draft."); ctx.refresh(); });
  const round = (x: number) => Math.round(x * 10) / 10;
  const arms = (title: string, rows: Arm[], note: string) => (
    <div>
      <h4 className="text-[12px] font-semibold">{title}</h4>
      <p className="text-[10.5px] text-muted">{note}</p>
      <table className="mt-1.5 w-full font-sans text-[11.5px]">
        <thead><tr className="text-left text-[10px] text-muted"><th className="pb-1 pr-2 font-normal">Choice</th><th className="pb-1 pr-2 font-normal">Settled</th><th className="pb-1 pr-2 font-normal">Replies</th><th className="pb-1 pr-2 font-normal">Opt-outs</th><th className="w-[34%] pb-1 font-normal">Estimated reply rate (90% interval)</th><th className="pb-1 text-right font-normal">Chance it is best</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.arm} className="border-t border-line">
              <td className="py-1.5 pr-2">{a.label}</td>
              <td className="num py-1.5" title={a.pending ? `plus ${round(a.pending)} failure-equivalents from sends still waiting` : undefined}>{round(a.pulls)}</td>
              <td className="num py-1.5">{round(a.rewards)}</td>
              <td className="num py-1.5">{round(a.negatives)}</td>
              <td className="py-1.5 pr-3"><span className="flex items-center gap-2"><Interval mean={a.mean} lower={a.lower} upper={a.upper} /><span className="num w-9 shrink-0 text-right text-[10.5px]">{pct(a.mean)}</span></span></td>
              <td className="num py-1.5 text-right" title={a.pBest === null ? "Not tried yet" : undefined}>{a.pBest === null ? "–" : pct(a.pBest)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <section className="ctl border border-line bg-elevated/30 p-4">
      <h3 className="flex items-center gap-1.5 text-[13px] font-semibold"><Icon name="Sparkles" className="h-4 w-4 text-accent" />What the agent has learned</h3>
      <p className="mt-0.5 max-w-[95ch] text-[11px] text-muted">
        The adaptive engine learns from what you do, not from what the model says about itself: every draft you send unchanged or edit, every automatic send you stop, and every reply your outreach earns. {d.signals30d} learning signals in the last 30 days. Estimates show their uncertainty; nothing is claimed from thin evidence.
      </p>
      {d.errorBudget.autoSends7d > 0 && (
        <p className="mt-2 ctl border border-line bg-bg/50 px-2.5 py-1.5 text-[11px]">
          Error budget: autopilot sent {d.errorBudget.autoSends7d} emails in the last 7 days. At the certified rates, at most about {Math.max(1, Math.round(d.errorBudget.autoSends7d * d.errorBudget.worstCertifiedBadRate))} of them would have needed your edits.
        </p>
      )}

      <div className="mt-4 grid gap-5 lg:grid-cols-2">
        <div>
          <h4 className="text-[12px] font-semibold">Earned autonomy</h4>
          <p className="text-[10.5px] text-muted">How often you send each kind of draft exactly as written, with no number, date or link changed. A kind is offered autopilot once the engine is 90% confident at most 10% would need your edits (about 22 clean in a row); stopping automatic sends or editing more hands it back.</p>
          {d.trust.length === 0
            ? <p className="mt-2 text-[11.5px] text-muted">Nothing yet. Each draft you send teaches the agent whether that kind of email can be trusted to it.</p>
            : (
              <ul className="mt-2 flex flex-col gap-2">
                {d.trust.map((t) => (
                  <li key={t.bucket} className="text-[11.5px]">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <span>{t.label}{t.state === "trusted" && <span className="text-muted"> · certified ≤ {pct(t.certifiedBadRate)} need edits</span>}{t.state === "probation" && <span className="text-neg"> · {t.reason}</span>}</span>
                      <span className="flex items-center gap-2 text-[10.5px] text-muted">
                        <span className="num">{t.unchanged} of {t.observations} unchanged</span>
                        <span className={`ctl px-1.5 py-0.5 text-[10px] ${STATE[t.state].tone}`}>{STATE[t.state].label}</span>
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-2"><Interval mean={t.mean} lower={t.lower} upper={t.upper} /><span className="num w-9 shrink-0 text-right text-[10.5px]">{pct(t.mean)}</span></div>
                  </li>
                ))}
              </ul>
            )}
        </div>

        <div>
          <h4 className="text-[12px] font-semibold">Lessons from your edits</h4>
          <p className="text-[10.5px] text-muted">When you change a draft before sending, the agent works out why. A lesson applies once it has seen it twice, or when you confirm it. Lessons shape wording only; they never authorise a fact or relax a rule.</p>
          {d.lessons.length === 0
            ? <p className="mt-2 text-[11.5px] text-muted">None yet. Edit a draft before sending it and the agent will learn from the change.</p>
            : (
              <ul className="mt-2 flex flex-col gap-1.5">
                {d.lessons.map((l) => (
                  <li key={l.id} className="flex items-start justify-between gap-2 text-[11.5px]">
                    <span className={l.evidence < 2 && !l.confirmed ? "text-muted" : ""}><span className="text-muted">{CONTEXT[l.context] ?? l.context} · </span>{l.rule}{l.evidence > 1 && <span className="num text-muted"> · seen {l.evidence}×</span>}{l.evidence < 2 && !l.confirmed && <span className="text-muted"> · waiting to see it again</span>}</span>
                    <span className="flex shrink-0 gap-2">
                      {l.evidence < 2 && !l.confirmed && <button type="button" disabled={!!ctx.busy} onClick={() => confirm(l.id)} className={btn.link}>Confirm</button>}
                      <button type="button" disabled={!!ctx.busy} onClick={() => retire(l.id)} className={btn.danger}>Retire</button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {arms("Outreach: opening angle", d.angles, "Each campaign's first email opens one of these ways, chosen by Thompson sampling; 1 in 10 is chosen at random so the estimates stay honest. Replies count for an angle, opt-outs against it, and sends still waiting count as partial misses. “Why now” is only used with a fresh Form D.")}
        {arms("Outreach: send time", d.hours, "When autopilot sends a first email, within your sending hours. New accounts start from what replies look like across YouBank, then learn their own audience.")}
      </div>
    </section>
  );
}
