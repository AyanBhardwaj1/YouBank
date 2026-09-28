"use client";

import { useEffect, useState } from "react";
import type { CrmInsights } from "@/lib/crm/insights";
import { STAGE_LABEL, isStage } from "@/lib/crm/model";
import { Empty, ago, api, btn, money, type PanelCtx } from "./shared";

type Knowledge = { topics: { topic: string; awareness: number; interest: number; told: number; engaged: number; evidence: string; lastTold: string | null; lastSeen: string | null }[]; talkingPoints: { topic: string; why: string }[]; tagged: number };

const pct = (v: number | null | undefined, d = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "—" : `${(v * 100).toFixed(d)}%`);
const BAND = { good: "text-pos", fair: "text-chart-emphasis", poor: "text-neg" } as const;

function Bar({ value, tone = "bg-chart-1" }: { value: number; tone?: string }) {
  return <span className="inline-block h-1.5 w-20 rounded-full bg-elevated align-middle"><span className={`block h-full rounded-full ${tone}`} style={{ width: `${Math.max(3, Math.min(100, value * 100))}%` }} /></span>;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-md border border-line bg-elevated/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className="num mt-1 text-[17px] font-semibold leading-none">{value}</div>
      {sub && <div className="mt-1 text-[10.5px] text-muted">{sub}</div>}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2"><h3 className="text-[13px] font-semibold">{title}</h3>{note && <span className="text-[11px] text-muted">{note}</span>}</div>
      {children}
    </section>
  );
}

/**
 * Relationship intelligence: who is strong, who is going quiet, which threads are due a nudge, how
 * likely a new email is to get a reply, what each contact already knows, and what the pipeline is
 * likely to close. Every number here is a model's estimate from your own mail, with its working shown.
 */
export function InsightsPanel({ ctx }: { ctx: PanelCtx }) {
  const [data, setData] = useState<CrmInsights | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<{ id: number; name: string; k?: Knowledge } | null>(null);

  useEffect(() => {
    let cancelled = false;
    api<CrmInsights>("/api/crm/insights").then((d) => { if (!cancelled) { setData(d); setError(null); } }).catch((e: Error) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [ctx.tick]);

  const openContact = async (id: number, name: string) => {
    setOpen({ id, name });
    const k = await api<Knowledge>(`/api/crm/insights/contact/${id}`).catch(() => null);
    setOpen((o) => (o && o.id === id ? { ...o, k: k ?? { topics: [], talkingPoints: [], tagged: 0 } } : o));
  };
  const tag = () => ctx.run("tag-topics", async () => {
    const r = await api<{ tagged: number }>("/api/crm/insights", { method: "POST", body: JSON.stringify({ action: "tag" }) });
    ctx.say(r.tagged ? `Tagged ${r.tagged} emails with their topics.` : "Every recent email is already tagged."); ctx.refresh();
    if (open) void openContact(open.id, open.name);
  });
  const nudge = (threadId: number) => ctx.run(`nudge-${threadId}`, async () => {
    await api(`/api/crm/threads/${threadId}`, { method: "POST", body: JSON.stringify({ action: "draft", instruction: "A short, friendly follow-up on my last email: two or three sentences, no pressure, easy to answer." }) });
    ctx.say("Nudge drafted. It is in the queue."); ctx.refresh();
  });
  const reconnect = (contactId: number) => ctx.run(`reconnect-${contactId}`, async () => {
    const r = await api<{ drafted: boolean; reason: string }>("/api/crm/insights", { method: "POST", body: JSON.stringify({ action: "reconnect", contactId }) });
    ctx.say(r.drafted ? "Reconnect note drafted. It is in the queue." : `No draft: ${r.reason}`); ctx.refresh();
  });

  if (error) return <Empty>{error}</Empty>;
  if (!data) return <div className="flex flex-col gap-2">{[0, 1, 2].map((i) => <div key={i} className="shimmer h-20 ctl" />)}</div>;
  const m = data.replyModel, t = data.timing, pl = data.pipeline;
  const bands = { good: data.contacts.filter((c) => c.band === "good").length, fair: data.contacts.filter((c) => c.band === "fair").length, poor: data.contacts.filter((c) => c.band === "poor").length };
  if (!data.contacts.length) return <Empty>Insights appear once the agent has read some of your mail: connect a mailbox and sync.</Empty>;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Reply rate" value={pct(m.replyRate)} sub={`${m.n} emails with a known outcome`} />
        <Stat label="Reply model" value={m.model === "logistic" ? "Learned" : m.model === "beta-binomial" ? "Per-contact rates" : "Not enough data"} sub={m.brier !== null ? `Brier ${m.brier.toFixed(3)}${m.skill !== null ? ` · skill ${pct(m.skill)}` : ""}` : undefined} />
        <Stat label="Typical reply time" value={t.medianDays !== null ? `${t.medianDays < 1 ? `${Math.round(t.medianDays * 24)}h` : `${t.medianDays.toFixed(1)}d`}` : "—"} sub={t.p90Days !== null ? `90% within ${t.p90Days.toFixed(0)} days` : undefined} />
        <Stat label="Nudge after" value={t.nudgeDay !== null ? `${t.nudgeDay} days` : "—"} sub="when an unprompted reply gets unlikely" />
        <Stat label="Relationships" value={`${bands.good} / ${bands.fair} / ${bands.poor}`} sub="good / fair / poor" />
        <Stat label="Pipeline, likely" value={pl.simulation.value ? money(pl.simulation.value.p50) : `${pl.simulation.wins.p50} wins`} sub={pl.simulation.value ? `80% range ${money(pl.simulation.value.p10)}–${money(pl.simulation.value.p90)}` : `${pl.deals.length} open`} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Section title="Waiting on a reply" note={t.nudgeDay !== null ? `Your threads rarely get an unprompted reply after day ${t.nudgeDay}` : undefined}>
          {data.awaiting.length ? (
            <ul className="divide-y divide-line/60 rounded-md border border-line">
              {data.awaiting.slice(0, 12).map((a) => (
                <li key={a.threadId} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate"><button type="button" onClick={() => void openContact(a.contactId, a.name)} className="font-semibold hover:text-accent">{a.name}</button> <span className="text-muted">· {a.subject}</span></div>
                    <div className="text-[11px] text-muted">{a.daysWaiting} days waiting · {pct(a.pNext3)} chance they reply in the next 3 days</div>
                  </div>
                  {a.nudge && <span className="rounded-full border border-chart-emphasis/40 bg-chart-emphasis/10 px-2 py-px text-[10.5px] text-chart-emphasis">nudge due</span>}
                  {a.hasInbound && <button type="button" disabled={ctx.busy !== null} onClick={() => void nudge(a.threadId)} className={btn.ghost}>{ctx.busy === `nudge-${a.threadId}` ? "Writing…" : "Draft a nudge"}</button>}
                </li>
              ))}
            </ul>
          ) : <Empty>No thread is waiting on the other side.</Empty>}
        </Section>

        <Section title="Going quiet" note="Contacts who wrote regularly and have gone well past their usual gap">
          {data.quiet.length ? (
            <ul className="divide-y divide-line/60 rounded-md border border-line">
              {data.quiet.slice(0, 10).map((q) => (
                <li key={q.contactId} className="flex items-center gap-3 px-3 py-2 text-[12px]">
                  <div className="min-w-0 flex-1">
                    <div className="truncate"><button type="button" onClick={() => void openContact(q.contactId, q.name)} className="font-semibold hover:text-accent">{q.name}</button>{q.company && <span className="text-muted"> · {q.company}</span>}</div>
                    <div className="text-[11px] text-muted">{q.reason} Strength {q.strength}/100.</div>
                  </div>
                  <button type="button" disabled={ctx.busy !== null} onClick={() => void reconnect(q.contactId)} className={btn.ghost}>{ctx.busy === `reconnect-${q.contactId}` ? "Writing…" : "Draft a reconnect"}</button>
                </li>
              ))}
            </ul>
          ) : <Empty>Nobody who writes to you regularly has gone quiet.</Empty>}
        </Section>
      </div>

      {open && (
        <Section title={`What ${open.name} knows`} note="Tracked from your emails: each mention teaches, their replies are evidence, and it all fades without contact">
          <div className="rounded-md border border-accent/30 bg-accent-soft/20 p-3">
            {!open.k ? <div className="text-[12px] text-muted">Reading their history…</div> : !open.k.topics.length ? (
              <div className="text-[12px] text-muted">No topics tagged for them yet. <button type="button" onClick={() => void tag()} className="text-accent hover:underline">Tag recent emails</button> ({data.knowledge.untagged} untagged).</div>
            ) : (
              <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
                <table className="w-full text-[12px]">
                  <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line"><th className="py-1 text-left font-normal">Topic</th><th className="py-1 text-left font-normal">Knows it</th><th className="py-1 text-left font-normal">Engages</th><th className="py-1 text-left font-normal">Evidence</th></tr></thead>
                  <tbody>
                    {open.k.topics.slice(0, 14).map((s) => (
                      <tr key={s.topic} className="border-b border-line/50 last:border-0">
                        <td className="py-1 pr-2">{s.topic}</td>
                        <td className="py-1 pr-2"><Bar value={s.awareness} tone={s.awareness >= 0.9 ? "bg-pos" : s.awareness >= 0.5 ? "bg-chart-1" : "bg-chart-emphasis"} /> <span className="num text-[11px] text-muted">{pct(s.awareness)}</span></td>
                        <td className="py-1 pr-2"><Bar value={s.interest} tone="bg-info" /> <span className="num text-[11px] text-muted">{pct(s.interest)}</span></td>
                        <td className="py-1 text-[11px] text-muted">{s.evidence}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div>
                  <div className="text-[10.5px] uppercase tracking-wider text-muted">Worth raising next</div>
                  <ul className="mt-1 space-y-1 text-[12px]">{open.k.talkingPoints.map((p) => <li key={p.topic}><span className="font-semibold">{p.topic}</span> <span className="text-muted">— {p.why}</span></li>)}</ul>
                  <p className="mt-2 text-[10.5px] text-muted">Drafts to {open.name} are told not to re-explain what they know well and to refer back to what they heard before.</p>
                  <button type="button" onClick={() => setOpen(null)} className={`${btn.link} mt-2`}>Close</button>
                </div>
              </div>
            )}
          </div>
        </Section>
      )}

      <Section title="Relationships" note="Strength: recency-weighted emails times how two-way they are, scaled to your own mail volume">
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="w-full text-[12px]">
            <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line"><th className="px-3 py-1.5 text-left font-normal">Contact</th><th className="px-2 py-1.5 text-left font-normal">Strength</th><th className="px-2 py-1.5 text-right font-normal">Two-way</th><th className="px-2 py-1.5 text-right font-normal">Reply odds</th><th className="px-2 py-1.5 text-right font-normal">Last heard</th><th className="px-2 py-1.5 text-right font-normal">Last wrote</th></tr></thead>
            <tbody>
              {data.contacts.slice(0, 60).map((c) => (
                <tr key={c.id} className="cursor-pointer border-b border-line/50 last:border-0 hover:bg-elevated/50" onClick={() => void openContact(c.id, c.name || c.email)}>
                  <td className="px-3 py-1.5"><span className="font-semibold">{c.name || c.email}</span>{c.company && <span className="text-muted"> · {c.company}</span>}{c.optedOut && <span className="ml-1 text-[10px] text-neg">opted out</span>}</td>
                  <td className="px-2 py-1.5"><Bar value={c.strength / 100} tone={c.band === "good" ? "bg-pos" : c.band === "fair" ? "bg-chart-emphasis" : "bg-neg"} /> <span className={`num ${BAND[c.band]}`}>{c.strength}</span></td>
                  <td className="num px-2 py-1.5 text-right text-muted">{pct(c.reciprocity)}</td>
                  <td className="num px-2 py-1.5 text-right">{pct(c.replyOdds)}</td>
                  <td className="px-2 py-1.5 text-right text-muted">{ago(c.lastInbound)}</td>
                  <td className="px-2 py-1.5 text-right text-muted">{ago(c.lastOutbound)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
          <span>{data.knowledge.tagged} emails tagged with topics, {data.knowledge.untagged} not yet.</span>
          {data.knowledge.untagged > 0 && <button type="button" disabled={ctx.busy !== null} onClick={() => void tag()} className={btn.ghost}>{ctx.busy === "tag-topics" ? "Tagging…" : "Tag the next 30"}</button>}
          {data.knowledge.topics.length > 0 && <span>Most discussed: {data.knowledge.topics.slice(0, 8).map((x) => x.topic).join(", ")}</span>}
        </div>
      </Section>

      <Section title="Pipeline forecast" note={pl.closed ? `Stage odds calibrated on ${pl.closed} closed deals (${pct(pl.winRate)} won)` : "Stage odds are defaults until deals close"}>
        {pl.deals.length ? (
          <div className="grid gap-4 xl:grid-cols-[320px_1fr]">
            <div className="flex flex-col gap-2 rounded-md border border-line p-3 text-[12px]">
              <div className="flex justify-between"><span className="text-muted">Expected wins</span><span className="num font-semibold">{pl.simulation.wins.expected.toFixed(1)} of {pl.deals.length}</span></div>
              <div className="flex justify-between"><span className="text-muted">80% range of wins</span><span className="num">{pl.simulation.wins.p10}–{pl.simulation.wins.p90}</span></div>
              <div className="flex justify-between"><span className="text-muted">Chance of no wins</span><span className="num">{pct(pl.simulation.wins.none)}</span></div>
              {pl.simulation.value && <>
                <div className="flex justify-between"><span className="text-muted">Value, P10 / P50 / P90</span><span className="num">{money(pl.simulation.value.p10)} / {money(pl.simulation.value.p50)} / {money(pl.simulation.value.p90)}</span></div>
                <div className="flex justify-between"><span className="text-muted">Probability-weighted</span><span className="num">{money(pl.simulation.value.weighted)}</span></div>
              </>}
              <div className="mt-1 flex h-16 items-end gap-0.5" title="Distribution of the number of wins">
                {pl.simulation.wins.distribution.map((p, k) => <div key={k} className="flex-1 rounded-t-sm bg-chart-1/70" style={{ height: `${Math.max(2, (p / Math.max(...pl.simulation.wins.distribution)) * 100)}%` }} title={`${k} wins: ${pct(p, 1)}`} />)}
              </div>
              <div className="text-[10.5px] text-muted">Wins are exact (Poisson-binomial); value is 10,000 simulated outcomes with amounts varying around what was entered.</div>
            </div>
            <div className="overflow-x-auto rounded-md border border-line">
              <table className="w-full text-[12px]">
                <thead className="text-[10.5px] uppercase tracking-wider text-muted"><tr className="border-b border-line"><th className="px-3 py-1.5 text-left font-normal">Deal</th><th className="px-2 py-1.5 text-left font-normal">Stage</th><th className="px-2 py-1.5 text-right font-normal">Amount</th><th className="px-2 py-1.5 text-right font-normal">Stage odds</th><th className="px-2 py-1.5 text-right font-normal">Win odds</th><th className="px-2 py-1.5 text-left font-normal">Why</th></tr></thead>
                <tbody>
                  {pl.deals.slice(0, 25).map((d) => (
                    <tr key={d.id} className="border-b border-line/50 last:border-0">
                      <td className="px-3 py-1.5 font-semibold">{d.name}</td>
                      <td className="px-2 py-1.5 text-muted">{isStage(d.stage) ? STAGE_LABEL[d.stage] : d.stage}</td>
                      <td className="num px-2 py-1.5 text-right">{money(d.amount)}</td>
                      <td className="num px-2 py-1.5 text-right text-muted">{pct(d.prior)}</td>
                      <td className="num px-2 py-1.5 text-right font-semibold">{pct(d.p)}</td>
                      <td className="px-2 py-1.5 text-[11px] text-muted">{d.drivers.map((x) => `${x.factor} (${x.effect >= 0 ? "+" : ""}${x.effect.toFixed(1)})`).join(", ") || "stage only"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : <Empty>No open deals to forecast.</Empty>}
      </Section>

      <Section title="How good are the reply odds?" note="Checked on your most recent quarter of emails, held out from training">
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-md border border-line p-3 text-[12px]">
            <div className="font-semibold">{m.model === "logistic" ? "A logistic model trained on your mail" : m.model === "beta-binomial" ? "Each contact's own reply rate, shrunk toward yours" : "Not enough history yet"}</div>
            <p className="mt-1 text-[11px] text-muted">{m.model === "logistic" ? "It beat the per-contact rates on held-out emails, so it is in use." : "A learned model takes over once it predicts better on held-out emails (it needs about 30 settled emails with some replies and some silences)."} A Brier score of 0 is perfect; guessing your average scores {m.replyRate !== null ? (m.replyRate * (1 - m.replyRate)).toFixed(3) : "—"}.</p>
          </div>
          <div className="rounded-md border border-line p-3 text-[12px]">
            <div className="mb-1 text-[10.5px] uppercase tracking-wider text-muted">Predicted vs actual</div>
            {m.reliability.length ? m.reliability.map((r) => <div key={r.bin} className="num flex justify-between text-[11.5px]"><span className="text-muted">{r.bin} ({r.n})</span><span>{pct(r.observed)} replied</span></div>) : <div className="text-[11px] text-muted">Needs more settled emails.</div>}
          </div>
          <div className="rounded-md border border-line p-3 text-[12px]">
            <div className="mb-1 text-[10.5px] uppercase tracking-wider text-muted">{m.weights.length ? "What moves the odds" : "Still waiting after"}</div>
            {m.weights.length ? m.weights.slice(0, 6).map((w) => <div key={w.feature} className="flex justify-between text-[11.5px]"><span>{w.feature}</span><span className={`num ${w.weight >= 0 ? "text-pos" : "text-neg"}`}>{w.weight >= 0 ? "+" : ""}{w.weight.toFixed(2)}</span></div>)
              : t.curve.filter((c) => [1, 3, 7, 14, 30].includes(c.t)).map((c) => <div key={c.t} className="num flex justify-between text-[11.5px]"><span className="text-muted">{c.t} days</span><span>{pct(c.s)} of emails</span></div>)}
          </div>
        </div>
      </Section>
    </div>
  );
}
