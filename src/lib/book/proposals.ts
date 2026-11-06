/**
 * Positions proposed by the person's AI apps (the MCP tool propose_position): an agent that has done the
 * research can hand over a position with its thesis and kill criteria, but it cannot change the Book. Each
 * proposal waits on the Book page, with which app sent it and why, until the person reviews it in the editor
 * and adds it, or dismisses it. At most ten are kept, newest first; a new proposal for the same name and
 * side from the same app replaces the older one. Pure (safe on the client); stored in ./store.ts.
 */
import { normalizePosition, type Position } from "./position";

export type Proposal = { id: string; at: string; from: string; rationale: string; position: Position };
export const PROPOSALS_MAX = 10;

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, n) : "");
const idOk = (v: unknown): v is string => typeof v === "string" && /^[a-z0-9-]{4,40}$/.test(v);

export function normalizeProposals(raw: unknown): Proposal[] {
  if (!Array.isArray(raw)) return [];
  const out: Proposal[] = [];
  for (const x of raw) {
    const r = (x && typeof x === "object" ? x : {}) as Record<string, unknown>;
    const position = normalizePosition(r.position);
    if (!idOk(r.id) || typeof r.at !== "string" || !position || out.some((p) => p.id === r.id)) continue;
    out.push({ id: r.id, at: r.at, from: clip(r.from, 80) || "An AI app", rationale: clip(r.rationale, 600), position });
  }
  return out.slice(0, PROPOSALS_MAX);
}

/** A proposal from a tool call's arguments: the position cleaned like any other, or why it cannot be one. */
export function proposalFrom(args: Record<string, unknown>, from: string, now = new Date()): { proposal: Proposal } | { error: string } {
  const iso = now.toISOString();
  const position = normalizePosition({
    ticker: args.ticker, direction: args.direction, thesis: args.thesis, pillars: args.pillars,
    criteria: args.kill_criteria, catalysts: args.catalysts, weight: args.weight_pct_nav, entry: args.entry_price,
  }, iso);
  if (!position) return { error: "A proposal needs a ticker and a one-line thesis." };
  const asked = Array.isArray(args.kill_criteria) ? args.kill_criteria.length : 0;
  if (asked && !position.criteria.length) return { error: "None of the kill criteria could be read: each needs a metric from the list, an op of >= or <=, and a number." };
  const id = `pr-${now.getTime().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return { proposal: { id, at: iso, from: clip(from, 80) || "An AI app", rationale: clip(args.rationale, 600), position } };
}

/** The list with a new proposal first: the same app's older one for the same name and side goes, and the oldest beyond the cap. */
export function withProposal(list: Proposal[], p: Proposal): Proposal[] {
  return [p, ...list.filter((x) => !(x.from === p.from && x.position.ticker === p.position.ticker && x.position.direction === p.position.direction))].slice(0, PROPOSALS_MAX);
}
