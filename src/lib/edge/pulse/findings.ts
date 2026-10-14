/**
 * When a Pulse signal becomes a finding (E3). Each finding states its change probability, the detector's
 * placebo false-alarm rate for that kind of series, and the coverage it rests on ("1 of 3 known job
 * boards"). The rules, from the spec:
 *   hiring_shift     open postings (or a department's) with change probability >= 0.9 and a move of -40%
 *                    or +60% over six weeks; a board that went to zero while the careers page now links
 *                    elsewhere is "jobs board moved", never "hiring stopped"
 *   hiring_tell      three or more postings of a tell in the last 30 days where there were none in the
 *                    six months before (with at least five weeks of history)
 *   attention_spike  Wikipedia views with change probability >= 0.9 and at least double six weeks before
 *   contract_award   a new federal award over $10 million
 *   layoff_notice    a WARN notice matched to the company
 *   patent_shift     monthly grants with change probability >= 0.9 and a move of -40% or +60%
 * Pure: the job that stores them is pulse/ingest.ts.
 */
import { bocpd, changeVerdict, falseAlarmSentence } from "../series/change";
import { metricDef, TELL_LABEL, TELLS, type Tell } from "../series/metrics";
import type { SeriesPoint } from "../series/store";
import type { Award } from "./sources/usaspending";
import type { WarnNotice } from "./sources/warn";

export const PULSE_KINDS = ["hiring_shift", "hiring_tell", "attention_spike", "contract_award", "layoff_notice", "patent_shift"] as const;
export type PulseKind = (typeof PULSE_KINDS)[number];

export type Candidate = { kind: PulseKind; key: string; title: string; summary: string; why: string; confidence: number; magnitude: number; observedAt: string; visual: Record<string, unknown> };
export type Coverage = { boards: number; boardsKnown: number; excluded: string[]; wikipedia: boolean; awards: boolean; patents: boolean; warnStates: string[] };
export type Company = { nodeId: number; name: string; ticker: string };

const pct = (v: number) => `${v >= 0 ? "+" : ""}${Math.round(v * 100)}%`;
const DAY = 86_400_000;

/** "1 of 3 known job boards answered; Workday not read (no public API)". Pure. */
export function coverageText(c: Coverage): string {
  const parts = [`${c.boards} of ${c.boardsKnown} known job board${c.boardsKnown === 1 ? "" : "s"} answered`];
  if (c.excluded.length) parts.push(`${c.excluded.map((e) => (e === "workday" ? "Workday" : "SuccessFactors")).join(" and ")} not read (no public API; their terms forbid scraping)`);
  return parts.join("; ");
}

const familyLabel: Record<string, string> = { jobs: "job-posting counts", "jobs.dept": "department posting counts", attention: "weekly page views", patents: "monthly patent counts" };

/** Every finding a company's series and events support now. Pure. */
export function evaluate(co: Company, series: Record<string, SeriesPoint[]>, extra: { awards?: Award[]; notices?: WarnNotice[]; recentTells?: { tell: Tell; title: string; location: string; firstSeen: string; url: string }[]; coverage: Coverage; falseAlarms: Record<string, number>; boardMoved?: { scheme: string; value: string; evidence: string } | null; news?: { headline: string; url: string } | null }, now = new Date()): Candidate[] {
  const out: Candidate[] = [];
  const today = now.toISOString().slice(0, 10);
  const cov = coverageText(extra.coverage);
  const fa = (family: string) => falseAlarmSentence(extra.falseAlarms[family] ?? NaN, familyLabel[family] ?? "this kind of series");
  const name = co.name;

  // Hiring shifts: open postings first, then the department that moved most.
  const shift = (metric: string) => {
    const pts = series[metric] ?? [];
    if (pts.length < 12) return null;
    const v = changeVerdict(pts.map((p) => p.value));
    return v.alarm ? { metric, v, last: pts[pts.length - 1], before: pts[Math.max(0, pts.length - 7)] } : null;
  };
  const jobs = shift("jobs.open");
  if (extra.boardMoved && (series["jobs.open"]?.at(-1)?.value ?? 1) === 0) {
    out.push({
      kind: "hiring_shift", key: `pulse:${co.nodeId}:board-moved:${extra.boardMoved.scheme}:${extra.boardMoved.value}`, title: `${name}'s jobs board moved`,
      summary: `${name}'s ${extra.boardMoved.scheme} board answers with no postings, and its careers page now links to another board. Edge reads the new one from the next refresh; this is not a sign that hiring stopped.`,
      why: `The careers page (${extra.boardMoved.evidence}) links to a different board. ${cov}.`, confidence: 0.9, magnitude: 0.1, observedAt: today, visual: { type: "pulse", ticker: co.ticker, name, metric: "jobs.open", moved: extra.boardMoved },
    });
  } else {
    const depts = Object.keys(series).filter((m) => m.startsWith("jobs.dept.") && (series[m]?.at(-7)?.value ?? 0) >= 10).map(shift).filter((x): x is NonNullable<typeof x> => !!x);
    const best = jobs ?? depts.sort((a, b) => Math.abs(b.v.move) - Math.abs(a.v.move))[0] ?? null;
    if (best) {
      const label = metricDef(best.metric)?.label ?? best.metric;
      const up = best.v.move > 0;
      out.push({
        kind: "hiring_shift", key: `pulse:${co.nodeId}:${best.metric}:${best.last.period}`, title: `${name}: ${label.toLowerCase()} ${up ? "up" : "down"} ${pct(best.v.move).replace(/^[+-]/, "")} in six weeks`,
        summary: `${label} went from ${best.before.value} to ${best.last.value} over six weeks (${pct(best.v.move)}). Change probability ${best.v.prob.toFixed(2)}.`,
        why: `Bayesian online change-point detection on the weekly series, with a robust z of ${Number.isFinite(best.v.z) ? best.v.z.toFixed(1) : "n/a"}${best.v.seasonal ? " against the same week a year earlier" : ""}. ${fa(best.metric.startsWith("jobs.dept") ? "jobs.dept" : "jobs")} Coverage: ${cov}.`,
        confidence: best.v.prob, magnitude: Math.min(1, Math.abs(best.v.move)), observedAt: best.last.period,
        visual: { type: "pulse", ticker: co.ticker, name, metric: best.metric, points: (series[best.metric] ?? []).slice(-26), prob: best.v.prob, move: best.v.move, coverage: cov },
      });
    }
  }

  // Tells: three or more in 30 days where there were none in the six months before.
  for (const t of TELLS) {
    const pts = series[`jobs.tell.${t}`] ?? [];
    if (pts.length < 5) continue;
    const last = pts[pts.length - 1];
    const recent = (extra.recentTells ?? []).filter((r) => r.tell === t);
    const before = pts.filter((p) => Date.parse(p.period) <= Date.parse(last.period) - 30 * DAY && Date.parse(p.period) >= Date.parse(last.period) - 182 * DAY);
    if (recent.length >= 3 && before.length >= 1 && before.every((p) => p.value === 0)) {
      const label = TELL_LABEL[t];
      out.push({
        kind: "hiring_tell", key: `pulse:${co.nodeId}:tell:${t}:${last.period}`, title: t === "integration" || t === "corpdev" ? `${name} is hiring for ${label.toLowerCase()}: a reason to reconnect` : `${name} is hiring for ${label.toLowerCase()} (${recent.length} postings in 30 days)`,
        summary: `${recent.length} ${label.toLowerCase()} postings first seen in the last 30 days, after none in the six months before: ${recent.slice(0, 4).map((r) => `${r.title}${r.location ? ` (${r.location})` : ""}`).join("; ")}.`,
        why: `Titles sorted by rules (pulse/titles.ts)${t === "ipo" ? "; IPO-readiness roles count only at private companies" : ""}. Coverage: ${cov}.`, confidence: 0.85, magnitude: Math.min(1, recent.length / 8), observedAt: last.period,
        visual: { type: "pulse_tell", ticker: co.ticker, name, tell: t, label, postings: recent.slice(0, 8), coverage: cov },
      });
    }
  }

  // Attention spikes, with the story behind them when the Newsroom has one.
  const views = series["wiki.views"] ?? [];
  if (views.length >= 12) {
    const v = changeVerdict(views.map((p) => p.value), { up: 1, down: 10 });
    if (v.alarm && v.move >= 1) {
      const last = views[views.length - 1];
      out.push({
        kind: "attention_spike", key: `pulse:${co.nodeId}:wiki:${last.period}`, title: `${name}: Wikipedia attention ${Number.isFinite(v.move) ? `${(v.move + 1).toFixed(1)}x` : "up sharply"} in six weeks`,
        summary: `${last.value.toLocaleString("en-US")} page views in the week of ${last.period}. ${extra.news ? `The Newsroom has a matching story: "${extra.news.headline}".` : "No matching Newsroom story; attention is not a fundamental by itself."}`,
        why: `Weekly English Wikipedia views (Wikimedia, CC0), change probability ${v.prob.toFixed(2)}. ${fa("attention")}`, confidence: v.prob, magnitude: Math.min(1, v.move / 4), observedAt: last.period,
        visual: { type: "pulse", ticker: co.ticker, name, metric: "wiki.views", points: views.slice(-26), prob: v.prob, move: v.move, news: extra.news ?? null },
      });
    }
  }

  // New federal awards over $10 million.
  for (const a of (extra.awards ?? []).filter((x) => x.amount >= 10e6 && Date.parse(x.start) >= now.getTime() - 45 * DAY).slice(0, 3)) {
    out.push({
      kind: "contract_award", key: `pulse:award:${a.id}`, title: `${name} won a $${(a.amount / 1e6).toFixed(a.amount >= 1e9 ? 0 : 1)}m federal award${a.agency ? ` from ${a.agency}` : ""}`,
      summary: `${a.description || "A federal contract award"} (award ${a.id}, starting ${a.start}).`, why: "USAspending.gov award records for the company's UEI (public domain), matched through the crosswalk.", confidence: 0.95,
      magnitude: Math.min(1, Math.log10(a.amount / 1e7) / 2 + 0.3), observedAt: a.start, visual: { type: "pulse_award", ticker: co.ticker, name, award: a, amountUsd: a.amount },
    });
  }

  // WARN layoff notices.
  for (const n of (extra.notices ?? []).filter((x) => Date.parse(x.date) >= now.getTime() - 60 * DAY).slice(0, 3)) {
    out.push({
      kind: "layoff_notice", key: `pulse:warn:${n.key}`, title: `${name}: WARN notice for ${n.employees.toLocaleString("en-US")} employees in ${n.city ? `${n.city}, ` : ""}${n.state}`,
      summary: `A ${n.kind ? `${n.kind.toLowerCase()} ` : ""}notice dated ${n.date} under the WARN Act, filed as "${n.company}".`, why: `State WARN records (${n.state}), matched to the company by name at the crosswalk's 0.9 line.`, confidence: 0.9,
      magnitude: Math.min(1, n.employees / 1000), observedAt: n.date, visual: { type: "pulse_warn", ticker: co.ticker, name, notice: n, employees: n.employees },
    });
  }

  // Patent shifts (monthly).
  const grants = series["patents.grants"] ?? [];
  if (grants.length >= 12) {
    const v = changeVerdict(grants.map((p) => p.value));
    if (v.alarm) {
      const last = grants[grants.length - 1];
      out.push({
        kind: "patent_shift", key: `pulse:${co.nodeId}:patents:${last.period}`, title: `${name}: patents granted ${v.move > 0 ? "up" : "down"} ${pct(v.move).replace(/^[+-]/, "")} over six months`,
        summary: `${last.value} patents granted in ${last.period.slice(0, 7)}; change probability ${v.prob.toFixed(2)}.`, why: `USPTO PatentsView grants by the company's disambiguated assignee (CC BY 4.0). ${fa("patents")}`, confidence: v.prob,
        magnitude: Math.min(1, Math.abs(v.move)), observedAt: last.period, visual: { type: "pulse", ticker: co.ticker, name, metric: "patents.grants", points: grants.slice(-24), prob: v.prob, move: v.move },
      });
    }
  }
  return out;
}

/** Whether a Pulse finding interrupts someone: a tell with three or more postings, a WARN notice of 250 or more, an award over $100 million. Pure. */
export function pulseIsBig(kind: string, visual: Record<string, unknown>): boolean {
  if (kind === "hiring_tell") return ((visual.postings as unknown[] | undefined)?.length ?? 0) >= 3;
  if (kind === "layoff_notice") return Number(visual.employees ?? 0) >= 250;
  if (kind === "contract_award") return Number(visual.amountUsd ?? 0) > 100e6;
  return false;
}

/**
 * The periods the detector would have flagged, run online over the history: one BOCPD pass (each step sees
 * only the points before it, so this equals re-running on every prefix), flagged where the change
 * probability over the last six points is at least 0.9 and the move over them is +60% or -40%. Pure.
 */
export function flaggedPeriods(points: { period: string; value: number }[], opts: { k?: number; threshold?: number; up?: number; down?: number; burnIn?: number } = {}): string[] {
  const k = opts.k ?? 6, threshold = opts.threshold ?? 0.9, up = opts.up ?? 0.6, down = opts.down ?? 0.4, burn = opts.burnIn ?? 12;
  if (points.length <= burn) return [];
  const v = points.map((p) => p.value);
  const run = bocpd(v);
  const out: string[] = [];
  for (let i = burn; i < v.length; i++) {
    const before = v[i - k];
    const move = before > 0 ? v[i] / before - 1 : v[i] > 0 ? Infinity : 0;
    if (run.changeProb(k, i) >= threshold && (move >= up || move <= -down)) out.push(points[i].period);
  }
  return out;
}
