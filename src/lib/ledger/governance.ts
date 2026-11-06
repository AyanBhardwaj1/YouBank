/**
 * The research ledger summarised for a period, as a compliance officer or an LP's due-diligence questionnaire
 * asks it: how much AI output was produced and by what (models, AI apps over MCP, tools), how much of it
 * cites sources, how much a person reviewed and what they rejected, when recording was off, and whether the
 * chain and its outside anchors still check. Works from the entries' metadata only (never the prompts or
 * answers). Pure; tested in scripts/test-ledger.ts. The report is src/app/report/ledger.
 */
import type { LedgerKind } from "./chain";

export type GovRow = { seq: number; at: string; kind: LedgerKind; subject: string; model: string; meta: Record<string, unknown>; sources: number; /** A sign-off's note (the start of it). */ note?: string };

export type Governance = {
  from: string; to: string;
  entries: number;
  /** AI output: everything but sign-offs and notes. */
  ai: number;
  byKind: { kind: LedgerKind; n: number }[];
  byModel: { model: string; n: number }[];
  /** Calls from the person's AI apps over MCP, by app (the key's name) and by tool. */
  byApp: { app: string; n: number }[];
  byTool: { tool: string; n: number }[];
  /** AI output with no source cited, and the share with at least one. */
  unsourced: number; sourcedShare: number | null;
  reviews: { approved: number; rejected: number; noted: number };
  /** Share of this period's AI output a person reviewed (any decision). */
  reviewedShare: number | null;
  rejected: { seq: number; ref: number | null; subject: string; reviewer: string; note: string; at: string }[];
  /** Positions an AI app proposed, and tool calls that failed. */
  proposals: number; errors: number;
  /** Recording turned off and on within the period. */
  pauses: { at: string; on: boolean }[];
  activeDays: number;
};

const AI_KINDS: ReadonlySet<LedgerKind> = new Set(["chat", "workflow", "red_team", "mcp"]);
const top = (m: Map<string, number>, n = 8) => [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);

/**
 * The summary of the rows in [from, to). Sign-offs count towards the entries they refer to when those are in
 * the period; a review written later for an entry in it counts too (pass it in `laterSignoffs`).
 */
export function governance(rows: GovRow[], from: string, to: string, laterSignoffs: GovRow[] = []): Governance {
  const inPeriod = rows.filter((r) => r.at >= from && r.at < to);
  const ai = inPeriod.filter((r) => AI_KINDS.has(r.kind));
  const aiSeqs = new Set(ai.map((r) => r.seq));
  const kinds = new Map<string, number>(), models = new Map<string, number>(), apps = new Map<string, number>(), tools = new Map<string, number>(), days = new Set<string>();
  let unsourced = 0, proposals = 0, errors = 0;
  for (const r of inPeriod) { bump(kinds, r.kind); days.add(r.at.slice(0, 10)); }
  for (const r of ai) {
    if (r.model) bump(models, r.model);
    if (!r.sources) unsourced++;
    if (r.kind === "mcp") {
      const tool = typeof r.meta.tool === "string" ? r.meta.tool : r.subject.split(" via ")[0];
      bump(tools, tool || "unknown");
      const via = r.subject.includes(" via ") ? r.subject.slice(r.subject.indexOf(" via ") + 5) : "An AI app";
      bump(apps, via);
      if (tool === "propose_position" && !r.meta.isError) proposals++;
      if (r.meta.isError) errors++;
    }
  }
  const reviews = { approved: 0, rejected: 0, noted: 0 };
  const reviewedSeqs = new Set<number>();
  const rejected: Governance["rejected"] = [];
  for (const s of [...inPeriod, ...laterSignoffs].filter((r) => r.kind === "signoff")) {
    const ref = Number(s.meta.ref);
    const decision = String(s.meta.decision ?? "");
    // A later sign-off counts only for an entry in this period; one in the period counts whatever it reviews.
    const inside = s.at >= from && s.at < to;
    if (!inside && !aiSeqs.has(ref)) continue;
    if (decision === "approved" || decision === "rejected" || decision === "noted") reviews[decision]++;
    if (Number.isInteger(ref) && aiSeqs.has(ref)) reviewedSeqs.add(ref);
    if (decision === "rejected") rejected.push({ seq: s.seq, ref: Number.isInteger(ref) ? ref : null, subject: s.subject.replace(/^Review of entry \d+:?\s*/, ""), reviewer: String(s.meta.reviewer ?? ""), note: (s.note ?? "").slice(0, 300), at: s.at });
  }
  const pauses = inPeriod.filter((r) => r.kind === "note" && typeof r.meta.recording === "boolean").map((r) => ({ at: r.at, on: r.meta.recording as boolean }));
  const share = (a: number, b: number) => (b ? Math.round((a / b) * 1000) / 10 : null);
  return {
    from, to, entries: inPeriod.length, ai: ai.length,
    byKind: top(kinds, 10).map(([kind, n]) => ({ kind: kind as LedgerKind, n })),
    byModel: top(models).map(([model, n]) => ({ model, n })),
    byApp: top(apps).map(([app, n]) => ({ app, n })),
    byTool: top(tools, 12).map(([tool, n]) => ({ tool, n })),
    unsourced, sourcedShare: share(ai.length - unsourced, ai.length),
    reviews, reviewedShare: share(reviewedSeqs.size, ai.length), rejected: rejected.slice(0, 50),
    proposals, errors, pauses, activeDays: days.size,
  };
}

/** The period a report covers: a calendar month ("2026-11"), or the last 30 days. */
export function periodOf(month: string | undefined, now: Date): { from: string; to: string; label: string } {
  const m = /^(\d{4})-(\d{2})$/.exec(month ?? "");
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    const y = Number(m[1]), mo = Number(m[2]) - 1;
    const from = new Date(Date.UTC(y, mo, 1)), to = new Date(Date.UTC(y, mo + 1, 1));
    return { from: from.toISOString(), to: to.toISOString(), label: from.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
  }
  const to = new Date(now.getTime() + 1);
  const from = new Date(now.getTime() - 30 * 86_400_000);
  return { from: from.toISOString(), to: to.toISOString(), label: "The last 30 days" };
}
