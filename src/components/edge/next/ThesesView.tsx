"use client";

/**
 * Theses (E7): investigations an agent keeps alive for days. The list shows each thesis with an overall dial
 * (agent estimate) and a sparkline. A new thesis becomes a plan to approve: claims with priors (reference
 * class or stated as subjective), resolution rules, evidence plans and kill criteria; nothing runs until it is
 * approved. A thesis page shows the claim tree with probabilities, priors and sparklines; the evidence stream
 * (direction, strength, the quote, kept or held back by the verifier); the red team and pre-mortem; the kill
 * criteria with their live state; the living memo; the agent log with costs (filterable); and the budget,
 * pause, resume, stop, add-evidence and override controls. On a phone the page opens as a stacked sheet;
 * approving and pausing work there too.
 */
import { Download, Loader2, Pause, Play, Plus, Square } from "lucide-react";
import { useState } from "react";
import { PremiumBadge } from "@/components/billing/Premium";
import { PlanNotice } from "@/components/billing/PlanNotice";
import { Markdown } from "@/components/terminal/Markdown";
import { Sheet } from "@/components/ui/Sheet";
import { usePhone } from "@/components/ui/useMedia";
import { errorMessage } from "@/lib/client/errors";
import { validatePlan } from "@/lib/edge/agent/plan";
import type { AgentState, ClaimState, Plan } from "@/lib/edge/agent/types";
import { post, useApi } from "../client";
import { pct, Sparkline } from "./charts";

type ListRow = { id: number; title: string; status: string; overall: number | null; history: number[]; horizonEnd: string | null; spentUsd: number; budgetUsd: number; tier: "free" | "plus"; team: boolean; mine: boolean; nextTickAt: string | null; companies: string[] };
type List = { theses: ListRow[]; limits: { active: number; horizonDays: number; budget: number; maxBudget: number }; plan: { plus: boolean; team: boolean; deep: boolean }; teams: number[] };
type Step = { id: number; day: string; kind: string; tool: string; input: Record<string, unknown>; output: Record<string, unknown>; cost: number; error: string; at: string };
type View = { id: number; title: string; thesis: string; status: string; horizonEnd: string | null; budgetUsd: number; spentUsd: number; cadence: string; team: boolean; owner: boolean; state: AgentState; overall: number | null; ladder: string; steps: Step[]; more: number | null };

const STATUS: Record<string, string> = { planning: "Plan to approve", running: "Running", paused: "Paused", done: "Done", stopped: "Stopped" };

function Dial({ p, size = 44 }: { p: number | null; size?: number }) {
  const r = size / 2 - 4, c = 2 * Math.PI * r, v = p ?? 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Overall agent estimate ${pct(p)}`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={4} />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--accent)" strokeWidth={4} strokeDasharray={`${c * v} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} strokeLinecap="round" />
      <text x="50%" y="54%" textAnchor="middle" style={{ font: "600 11px var(--font-mono, monospace)", fill: "var(--fg)" }}>{p === null ? "—" : Math.round(v * 100)}</text>
    </svg>
  );
}

const ruleText = (c: Plan["claims"][number]) => (c.rule.type === "deal" ? `settles if ${c.rule.ticker} is announced as ${c.rule.role}` : c.rule.type === "xbrl" ? `settles on ${c.rule.ticker}'s reported ${c.rule.concept} for ${c.rule.period}` : "you settle it");
const monitorText = (m: Plan["kills"][number]["monitor"]) => (m.tool === "deal_odds" ? `${m.ticker} sale odds ${m.op} ${pct(m.value)}` : m.tool === "series" ? `${m.ticker} ${m.metric} ${m.op} ${pct(m.value)} over ${m.weeks} weeks` : m.tool === "pulse" ? `a new ${m.kind.replace(/_/g, " ")} at ${m.ticker}` : `${m.ticker} announced as ${m.role}`);

function PlanReview({ plan, problems, id, onDone }: { plan: Plan; problems: string[]; id: number; onDone: () => void }) {
  const [busy, setBusy] = useState(""), [err, setErr] = useState<unknown>(null);
  const act = async (what: "approve" | "stop") => { setBusy(what); setErr(null); try { await post(`/api/edge/agents/${id}/${what}`, {}); onDone(); } catch (e) { setErr(e instanceof Error ? e : new Error(errorMessage(e))); } finally { setBusy(""); } };
  return (
    <div className="space-y-2 text-[12px]">
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">The plan, to approve</h4>
      <ol className="space-y-1.5">{plan.claims.map((c) => (
        <li key={c.n} className={`rounded-md border border-line p-2 ${c.parent !== null ? "ml-4" : ""}`}>
          <div className="flex items-baseline justify-between gap-2"><span className="font-semibold">{c.n}. {c.text}</span><span className="num shrink-0">{pct(c.prior)}</span></div>
          <div className="text-[10.5px] text-muted">prior: {c.priorBasis === "reference" ? c.priorNote : `subjective (${c.priorNote})`} · {ruleText(c)} · closes {c.closes}{c.parent !== null ? ` · supports claim ${c.parent} (${c.logic ?? "all"})` : ""}</div>
          <div className="text-[10.5px] text-faint">evidence: {c.evidence.map((e) => `${e.tool} ${Object.values(e.args).join(" ")}`).join("; ")}</div>
        </li>
      ))}</ol>
      <h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Kill criteria</h4>
      <ul className="list-disc space-y-0.5 pl-4">{plan.kills.map((k) => <li key={k.n}>{k.text} <span className="text-[10.5px] text-muted">({monitorText(k.monitor)})</span></li>)}</ul>
      {problems.length > 0 && <div className="rounded-md border border-neg/40 bg-neg/5 p-2 text-[11.5px] text-neg">{problems.map((p) => <div key={p}>{p}</div>)}<div className="mt-1 text-muted">Discard it and restate the thesis more specifically.</div></div>}
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => act("approve")} disabled={!!busy || problems.length > 0} className="ctl inline-flex items-center gap-1 bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-50">{busy === "approve" && <Loader2 className="h-3 w-3 animate-spin" />}Approve and start</button>
        <button type="button" onClick={() => act("stop")} disabled={!!busy} className="ctl border border-line px-3 py-1.5 text-muted hover:text-fg">Discard</button>
      </div>
      {err ? <PlanNotice error={err} /> : null}
    </div>
  );
}

function ClaimTree({ claims, parent, owner, id, onDone }: { claims: ClaimState[]; parent: number | null; owner: boolean; id: number; onDone: () => void }) {
  return <ul className={parent === null ? "space-y-1.5" : "ml-4 mt-1.5 space-y-1.5 border-l border-line pl-2"}>{claims.filter((c) => c.parent === parent).map((c) => (
    <li key={c.n}>
      <div className="rounded-md border border-line p-2">
        <div className="flex items-start justify-between gap-2"><span className="text-[12.5px]"><span className="font-semibold">{c.n}.</span> {c.text}</span><span className="shrink-0 text-right"><span className="num block text-[15px] font-semibold">{pct(c.override?.p ?? c.p)}</span><Sparkline values={c.history.length > 1 ? c.history.map((h) => h.p) : [c.prior, c.p]} width={70} height={18} label={`Claim ${c.n} over time`} /></span></div>
        <div className="mt-0.5 flex flex-wrap gap-x-2 text-[10.5px] text-muted">
          <span>agent estimate {pct(c.p)} · prior {pct(c.prior)} ({c.priorBasis === "reference" ? "reference class" : "subjective"})</span><span>{ruleText(c)}</span><span>closes {c.closes}</span>
          {c.resolved && <span className={c.resolved.outcome >= 0.5 ? "text-pos" : "text-neg"}>resolved {c.resolved.outcome >= 0.5 ? "true" : "false"}</span>}
          {c.override && <span className="text-info">person override {pct(c.override.p)}: {c.override.note}</span>}
        </div>
        {owner && <Override id={id} claim={c} onDone={onDone} />}
      </div>
      <ClaimTree claims={claims} parent={c.n} owner={owner} id={id} onDone={onDone} />
    </li>
  ))}</ul>;
}

function Override({ id, claim, onDone }: { id: number; claim: ClaimState; onDone: () => void }) {
  const [open, setOpen] = useState(false), [p, setP] = useState(""), [note, setNote] = useState(""), [err, setErr] = useState("");
  if (!open) return <button type="button" onClick={() => setOpen(true)} className="mt-1 text-[10.5px] text-muted hover:text-fg">Override…</button>;
  const send = async (clear = false) => { setErr(""); try { await post(`/api/edge/agents/${id}/override`, { claim: claim.n, p: clear ? null : Number(p) / 100, note }); setOpen(false); onDone(); } catch (e) { setErr(errorMessage(e)); } };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
      <input value={p} onChange={(e) => setP(e.target.value)} placeholder="%" inputMode="decimal" className="ctl w-12 border border-line bg-transparent px-1 py-0.5" aria-label="Your probability in percent" />
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="why" className="ctl min-w-0 flex-1 border border-line bg-transparent px-1 py-0.5" aria-label="Why" />
      <button type="button" onClick={() => send()} className="ctl border border-line px-1.5 py-0.5">Set</button>
      {claim.override && <button type="button" onClick={() => send(true)} className="ctl border border-line px-1.5 py-0.5">Clear</button>}
      {err && <span className="text-neg">{err}</span>}
    </div>
  );
}

function AddEvidence({ id, claims, onDone }: { id: number; claims: ClaimState[]; onDone: () => void }) {
  const [f, setF] = useState({ claim: String(claims[0]?.n ?? 1), direction: "for", strength: "weak", statement: "", quote: "", source: "", url: "" });
  const [err, setErr] = useState(""), [busy, setBusy] = useState(false);
  const send = async () => { setBusy(true); setErr(""); try { await post(`/api/edge/agents/${id}/evidence`, { ...f, claim: Number(f.claim) }); setF({ ...f, statement: "", quote: "", source: "", url: "" }); onDone(); } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); } };
  return (
    <details className="text-[12px]"><summary className="cursor-pointer text-muted hover:text-fg">Add evidence yourself</summary>
      <div className="mt-1.5 grid gap-1.5 sm:grid-cols-3">
        <select value={f.claim} onChange={(e) => setF({ ...f, claim: e.target.value })} className="ctl border border-line bg-transparent px-1 py-1" aria-label="Claim">{claims.map((c) => <option key={c.n} value={c.n}>Claim {c.n}</option>)}</select>
        <select value={f.direction} onChange={(e) => setF({ ...f, direction: e.target.value })} className="ctl border border-line bg-transparent px-1 py-1" aria-label="Direction"><option value="for">For</option><option value="against">Against</option></select>
        <select value={f.strength} onChange={(e) => setF({ ...f, strength: e.target.value })} className="ctl border border-line bg-transparent px-1 py-1" aria-label="Strength"><option value="weak">Weak (×1.5)</option><option value="moderate">Moderate (×3)</option><option value="strong">Strong (×8)</option></select>
        <input value={f.statement} onChange={(e) => setF({ ...f, statement: e.target.value })} placeholder="What it shows" className="ctl border border-line bg-transparent px-2 py-1 sm:col-span-3" />
        <input value={f.quote} onChange={(e) => setF({ ...f, quote: e.target.value })} placeholder="Quote (optional)" className="ctl border border-line bg-transparent px-2 py-1 sm:col-span-3" />
        <input value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="Source" className="ctl border border-line bg-transparent px-2 py-1 sm:col-span-2" />
        <input value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="Link (optional)" className="ctl border border-line bg-transparent px-2 py-1" />
      </div>
      <button type="button" onClick={send} disabled={busy || !f.statement || !f.source} className="ctl mt-1.5 border border-line px-2.5 py-1 disabled:opacity-50">Add</button>{err && <span className="ml-2 text-neg">{err}</span>}
    </details>
  );
}

function ThesisPage({ id }: { id: number }) {
  const [kind, setKind] = useState("");
  const { data, error, reload } = useApi<View>(`/api/edge/agents/${id}${kind ? `?kind=${kind}` : ""}`);
  const [busy, setBusy] = useState(""), [err, setErr] = useState<unknown>(null);
  const act = async (what: string) => { setBusy(what); setErr(null); try { await post(`/api/edge/agents/${id}/${what}`, {}); reload(); } catch (e) { setErr(e instanceof Error ? e : new Error(errorMessage(e))); } finally { setBusy(""); } };
  if (error) return <p className="p-3 text-[12px] text-neg">This thesis did not load: {error}</p>;
  if (!data) return <div className="p-4" aria-busy="true"><div className="shimmer h-4 w-48 rounded" /><div className="shimmer mt-3 h-40 rounded" /></div>;
  const s = data.state;
  return (
    <div className="space-y-3">
      <header className="flex items-start gap-3">
        <Dial p={data.overall} size={56} />
        <div className="min-w-0 flex-1">
          <h3 className="text-[15px] font-semibold tracking-tight">{data.title}</h3>
          <p className="text-[12px] text-muted">{data.thesis}</p>
          <p className="mt-0.5 text-[10.5px] text-faint">{STATUS[data.status] ?? data.status}{s.stopReason ? ` (${s.stopReason})` : ""} · {s.ticks} ticks · {data.cadence} · horizon {data.horizonEnd ?? "—"}{s.nextTickAt && data.status === "running" ? ` · next tick ${s.nextTickAt.slice(0, 16).replace("T", " ")} UTC` : ""}{data.team ? " · team thesis" : ""}{s.deep ? " · weekly deep pass" : ""}</p>
          <div className="mt-1 h-1.5 w-full max-w-[260px] overflow-hidden rounded-full bg-line" title={`$${data.spentUsd.toFixed(3)} of $${data.budgetUsd.toFixed(2)}`}><div className="h-full bg-accent" style={{ width: `${Math.min(100, (data.spentUsd / Math.max(0.01, data.budgetUsd)) * 100)}%` }} /></div>
          <p className="text-[10.5px] text-faint">Spent ${data.spentUsd.toFixed(3)} of ${data.budgetUsd.toFixed(2)} (counted in your AI allowance)</p>
          {s.error && <p className="mt-1 text-[11.5px] text-neg">{s.error}</p>}
        </div>
      </header>
      {data.owner && <div className="flex flex-wrap gap-1.5 text-[11.5px]">
        {data.status === "running" && <button type="button" onClick={() => act("pause")} disabled={!!busy} className="ctl inline-flex items-center gap-1 border border-line px-2 py-1"><Pause className="h-3 w-3" />Pause</button>}
        {data.status === "paused" && <button type="button" onClick={() => act("resume")} disabled={!!busy} className="ctl inline-flex items-center gap-1 border border-line px-2 py-1"><Play className="h-3 w-3" />Resume</button>}
        {["running", "paused"].includes(data.status) && <button type="button" onClick={() => act("stop")} disabled={!!busy} className="ctl inline-flex items-center gap-1 border border-line px-2 py-1 text-neg"><Square className="h-3 w-3" />Stop</button>}
        <a href={`/api/edge/agents/${id}/export?format=csv`} className="ctl inline-flex items-center gap-1 border border-line px-2 py-1 text-muted hover:text-fg"><Download className="h-3 w-3" />Log CSV</a>
        <a href={`/api/edge/agents/${id}/export?format=json`} className="ctl inline-flex items-center gap-1 border border-line px-2 py-1 text-muted hover:text-fg"><Download className="h-3 w-3" />JSON</a>
      </div>}
      {err ? <PlanNotice error={err} /> : null}
      {data.status === "planning" && s.plan ? <PlanReview plan={s.plan} problems={validatePlan(s.plan, { horizonEnd: data.horizonEnd ?? "9999-12-31", today: new Date().toISOString().slice(0, 10) })} id={id} onDone={reload} /> : (
        <>
          <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Claims (agent estimates)</h4><ClaimTree claims={s.claims} parent={null} owner={data.owner} id={id} onDone={reload} /></section>
          <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Kill criteria</h4><ul className="space-y-1 text-[12px]">{s.kills.map((k) => <li key={k.n} className={`rounded-md border p-2 ${k.status === "fired" ? "border-neg/50 bg-neg/5" : "border-line"}`}><span className={`mr-1 rounded-full border px-1.5 text-[10px] ${k.status === "fired" ? "border-neg/60 text-neg" : "border-line text-muted"}`}>{k.status === "fired" ? "Fired" : k.status === "unavailable" ? "No data yet" : "Watching"}</span>{k.text}<div className="text-[10.5px] text-muted">{k.detail}</div></li>)}</ul></section>
          <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Evidence</h4>
            <ul className="space-y-1 text-[12px]">{[...s.evidence].reverse().slice(0, 20).map((e, i) => (
              <li key={i} className={`rounded-md border p-2 ${e.kept ? "border-line" : "border-dashed border-line opacity-70"}`}>
                <div className="flex flex-wrap items-center gap-1.5 text-[10.5px]"><span className={e.direction === "for" ? "text-pos" : "text-neg"}>{e.direction === "for" ? "▲ for" : "▼ against"} claim {e.claim}</span><span className="rounded-full border border-line px-1.5">{e.strength}</span>{e.by !== "agent" && <span className="rounded-full border border-info/50 px-1.5 text-info">{e.by === "redteam" ? "red team" : "added by a person"}</span>}<span className="text-muted">{e.kept ? "verified" : `held back: ${e.why}`}</span></div>
                <div className="mt-0.5">{e.statement}</div>
                {e.quote && <div className="text-[11px] italic text-muted">&ldquo;{e.quote}&rdquo; — {e.url ? <a href={e.url} className="text-info hover:underline">{e.source}</a> : e.source}</div>}
              </li>
            ))}{!s.evidence.length && <li className="text-muted">No evidence yet: the first tick gathers it.</li>}</ul>
            {data.owner || data.team ? <div className="mt-1.5"><AddEvidence id={id} claims={s.claims} onDone={reload} /></div> : null}
          </section>
          {s.redteam && <section className="rounded-md border-l-2 border-neg bg-neg/5 px-3 py-2"><h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Red team ({s.redteam.at.slice(0, 10)})</h4><ul className="mt-0.5 list-disc pl-4 text-[12px]">{s.redteam.points.map((p, i) => <li key={i}>Against claim {p.claim}: {p.text}{p.kept ? "" : " (not supported by the sources; not counted)"}</li>)}{!s.redteam.points.length && <li>No counter-evidence in the sources.</li>}</ul></section>}
          {s.premortem && <section><h4 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Pre-mortem</h4><p className="text-[12px]">{s.premortem.text}</p></section>}
          {s.memo && <details className="rounded-md border border-line p-2"><summary className="cursor-pointer text-[12px] font-semibold">The living memo ({s.memo.updatedAt.slice(0, 10)})</summary><div className="prose-sm mt-2 text-[12.5px]"><Markdown text={s.memo.markdown} sources={[]} /></div></details>}
          <section>
            <div className="mb-1 flex items-center justify-between gap-2"><h4 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Agent log</h4><select value={kind} onChange={(e) => setKind(e.target.value)} className="bg-transparent text-[11px] text-muted" aria-label="Filter the log"><option value="">Every step</option>{["plan", "approval", "tool", "evidence", "update", "redteam", "memo"].map((k) => <option key={k} value={k}>{k}</option>)}</select></div>
            <ul className="max-h-[320px] space-y-0.5 overflow-auto text-[11px]">{data.steps.map((st) => <li key={st.id} className="grid grid-cols-[86px_70px_minmax(0,1fr)_56px] gap-1.5 border-b border-line/50 py-0.5"><span className="num text-muted">{st.at.slice(5, 16).replace("T", " ")}</span><span>{st.kind}</span><span className="truncate text-muted" title={st.error || st.tool}>{st.tool}{st.error ? ` · ${st.error}` : ""}</span><span className="num text-right text-faint">{st.cost ? `$${st.cost.toFixed(4)}` : ""}</span></li>)}</ul>
          </section>
          <p className="text-[10.5px] text-faint">Probabilities are agent estimates on a stated {data.ladder}; evidence counts only when Edge&apos;s claim verifier supports it. Claims are logged in the forecast ledger and scored when they resolve (Track record, &ldquo;thesis claim&rdquo;).</p>
        </>
      )}
    </div>
  );
}

function NewThesis({ list, tickers, onMade }: { list: List; tickers: string[]; onMade: (id: number, plan: Plan, problems: string[]) => void }) {
  const [thesis, setThesis] = useState(""), [tk, setTk] = useState(tickers.slice(0, 3).join(", "));
  const [days, setDays] = useState(list.limits.horizonDays), [cadence, setCadence] = useState("daily"), [team, setTeam] = useState(""), [deep, setDeep] = useState(false);
  const [busy, setBusy] = useState(false), [err, setErr] = useState<unknown>(null);
  const make = async () => {
    setBusy(true); setErr(null);
    try { const r = await post<{ id: number; plan: Plan; problems: string[] }>("/api/edge/agents", { thesis, tickers: tk.split(/[\s,]+/).filter(Boolean), horizonDays: days, cadence, ...(team ? { teamId: Number(team) } : {}), ...(deep ? { deep: true } : {}) }); onMade(r.id, r.plan, r.problems); setThesis(""); }
    catch (e) { setErr(e instanceof Error ? e : new Error(errorMessage(e))); }
    finally { setBusy(false); }
  };
  return (
    <div className="panel space-y-2 p-3 text-[12px]">
      <textarea value={thesis} onChange={(e) => setThesis(e.target.value)} rows={2} placeholder="State a thesis: “ET buys a Permian gatherer within 12 months”, “Is Permian midstream consolidation over?”" className="ctl w-full border border-line bg-transparent px-2 py-1.5 outline-none" aria-label="Thesis" />
      <div className="flex flex-wrap items-center gap-2">
        <input value={tk} onChange={(e) => setTk(e.target.value.toUpperCase())} placeholder="Tickers" className="ctl w-40 border border-line bg-transparent px-2 py-1 uppercase" aria-label="Companies" />
        <label className="inline-flex items-center gap-1">Days <input type="number" min={3} max={90} value={days} onChange={(e) => setDays(Number(e.target.value) || 14)} className="ctl w-16 border border-line bg-transparent px-1 py-1" />{days > 14 && <PremiumBadge feature="edge.thesis-plus" />}</label>
        <select value={cadence} onChange={(e) => setCadence(e.target.value)} className="ctl border border-line bg-transparent px-1 py-1" aria-label="Cadence"><option value="daily">Daily</option><option value="twice-daily">Twice daily</option></select>{cadence === "twice-daily" && <PremiumBadge feature="edge.thesis-plus" />}
        <label className="inline-flex items-center gap-1"><input type="checkbox" checked={deep} onChange={(e) => setDeep(e.target.checked)} className="accent-[var(--accent)]" />Weekly deep pass <PremiumBadge feature="edge.thesis-deep" /></label>
        {list.teams.length > 0 ? <select value={team} onChange={(e) => setTeam(e.target.value)} className="ctl border border-line bg-transparent px-1 py-1" aria-label="Team"><option value="">Just me</option>{list.teams.map((t) => <option key={t} value={t}>Team {t}</option>)}</select> : <span className="inline-flex items-center gap-1 text-muted">Team theses <PremiumBadge feature="edge.thesis-team" /></span>}
        <button type="button" onClick={make} disabled={busy || thesis.trim().length < 12} className="ctl ml-auto inline-flex items-center gap-1 bg-accent px-3 py-1.5 font-semibold text-accent-fg disabled:opacity-50">{busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}Plan it</button>
      </div>
      <p className="text-[10.5px] text-faint">Free: one active thesis, 14 days, daily checks on Edge&apos;s own tools (precedents, the Pulse, Deal Radar, signal series), spending from your AI allowance within a ${list.limits.budget.toFixed(2)} budget. Nothing runs until you approve the plan.</p>
      {err ? <PlanNotice error={err} /> : null}
    </div>
  );
}

export function ThesesView({ tickers, initial }: { tickers: string[]; initial?: number | null }) {
  const phone = usePhone();
  const { data, error, reload } = useApi<List>("/api/edge/agents");
  const [open, setOpen] = useState<number | null>(initial ?? null);
  const [fresh, setFresh] = useState<{ id: number; plan: Plan; problems: string[] } | null>(null);
  return (
    <div className="space-y-3">
      {data && <NewThesis list={data} tickers={tickers} onMade={(id, plan, problems) => { setFresh({ id, plan, problems }); reload(); }} />}
      {fresh && <div className="panel p-3"><PlanReview plan={fresh.plan} problems={fresh.problems} id={fresh.id} onDone={() => { setOpen(fresh.id); setFresh(null); reload(); }} /></div>}
      {error && <p className="panel px-3 py-2 text-[12px] text-neg">Your theses did not load: {error}</p>}
      {data && !data.theses.length && !fresh && <p className="panel px-3 py-3 text-[12.5px] text-muted">State a thesis above. The agent turns it into claims with probabilities, watches its kill criteria, argues the other side, and writes a memo that says what changed.</p>}
      <div className={`grid gap-3 ${open && !phone ? "lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]" : ""}`}>
        <ul className="min-w-0 space-y-1.5">{(data?.theses ?? []).map((t) => (
          <li key={t.id}><button type="button" onClick={() => setOpen(t.id)} className={`panel flex w-full items-center gap-2.5 p-2.5 text-left ${open === t.id ? "border-accent/60" : ""}`}>
            <Dial p={t.overall} />
            <span className="min-w-0 flex-1"><span className="block truncate text-[12.5px] font-semibold">{t.title}</span><span className="block text-[10.5px] text-muted">{STATUS[t.status] ?? t.status} · {t.companies.join(", ") || "—"}{t.team ? " · team" : ""}{t.tier === "plus" ? " · plus" : ""}</span></span>
            {t.history.length > 1 && <Sparkline values={t.history} width={60} height={20} label="Overall over time" />}
          </button></li>
        ))}</ul>
        {open && !phone && <aside className="panel max-h-[88vh] min-w-0 overflow-auto p-3.5"><div className="mb-2 flex justify-end"><button type="button" onClick={() => setOpen(null)} className="text-[11.5px] text-muted hover:text-fg">Close</button></div><ThesisPage key={open} id={open} /></aside>}
      </div>
      {phone && <Sheet open={!!open} onClose={() => setOpen(null)} size="full" label="Thesis">{open && <ThesisPage key={open} id={open} />}</Sheet>}
    </div>
  );
}
