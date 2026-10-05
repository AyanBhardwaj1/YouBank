/**
 * What a meeting said about a deal, against what the pipeline holds. Pure functions, tested in
 * scripts/test-meetings.ts.
 *
 * A meeting never writes over a deal on its own: every difference becomes a proposed change the person
 * accepts or rejects, with the words that prompted it. Only what was stated produces a change; a field
 * the meeting did not mention, or mentioned with the same value, produces nothing, and a stated blank
 * never clears a field.
 */
import { STAGE_LABEL, isStage, type Stage } from "@/lib/crm/model";
import type { StatedDeal } from "./model";

export type DealLite = {
  id: number; name: string; stage: string; sector: string; round: string;
  amountUsd: number | null; valuationUsd: number | null; nextStep: string; nextStepDue: string | null;
};

export type DealField = "round" | "amountUsd" | "valuationUsd" | "sector" | "nextStep" | "nextStepDue";
export type FieldChange = { field: DealField; label: string; from: string | number | null; to: string | number };
export type ProposedDeal = { dealId: number; changes: FieldChange[]; stage: { from: string; to: Stage } | null; quote: string };

export const FIELD_LABEL: Record<DealField, string> = {
  round: "Round", amountUsd: "Amount", valuationUsd: "Valuation", sector: "Sector", nextStep: "Next step", nextStepDue: "Next step due",
};

const SCALE: Record<string, number> = { k: 1e3, thousand: 1e3, m: 1e6, mm: 1e6, mn: 1e6, million: 1e6, b: 1e9, bn: 1e9, billion: 1e9 };

/** "$12.5M", "12.5 million", "1.2bn", "800k", "$3,000,000", 4500000 as dollars; null when it is not an amount. Pure. */
export function parseMoney(v: string | number | null | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) && v > 0 ? v : null;
  if (!v) return null;
  const m = /^\s*(?:us)?\$?\s*([0-9][0-9,]*(?:\.[0-9]+)?)\s*(k|thousand|mm|mn|m|million|bn|b|billion)?\b/i.exec(v.replace(/usd/i, ""));
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, "")) * (m[2] ? SCALE[m[2].toLowerCase()] ?? 1 : 1);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const text = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const same = (a: string, b: string) => text(a).toLowerCase().replace(/[.!]+$/, "") === text(b).toLowerCase().replace(/[.!]+$/, "");
/** Two amounts within 1% are the same amount said differently. */
const sameMoney = (a: number | null, b: number) => a !== null && Math.abs(a - b) <= Math.max(1, 0.01 * Math.max(a, b));

/** A date the meeting stated, as YYYY-MM-DD, or null. Pure. */
export function isoDay(v: string | null | undefined): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(text(v));
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : `${m[1]}-${m[2]}-${m[3]}`;
}

/**
 * The changes a meeting proposes for one deal. `stages` is the pipeline's stages for the person's mode:
 * a stated stage outside them, or the stage the deal is already in, proposes nothing. Pure.
 */
export function proposeDealChanges(deal: DealLite, stated: Partial<StatedDeal>, stages: readonly Stage[]): ProposedDeal {
  const changes: FieldChange[] = [];
  const add = (field: DealField, from: string | number | null, to: string | number) => changes.push({ field, label: FIELD_LABEL[field], from, to });

  const round = text(stated.round);
  if (round && !same(round, deal.round)) add("round", deal.round || null, round);
  const sector = text(stated.sector);
  if (sector && !same(sector, deal.sector)) add("sector", deal.sector || null, sector);
  const amount = parseMoney(stated.amount);
  if (amount !== null && !sameMoney(deal.amountUsd, amount)) add("amountUsd", deal.amountUsd, amount);
  const valuation = parseMoney(stated.valuation);
  if (valuation !== null && !sameMoney(deal.valuationUsd, valuation)) add("valuationUsd", deal.valuationUsd, valuation);
  const next = text(stated.nextStep).slice(0, 300);
  if (next && !same(next, deal.nextStep)) add("nextStep", deal.nextStep || null, next);
  const due = isoDay(stated.nextStepDue);
  if (due && due !== isoDay(deal.nextStepDue)) add("nextStepDue", isoDay(deal.nextStepDue), due);

  const s = text(stated.stage).toLowerCase().replace(/\s+/g, "_");
  const to = isStage(s) ? s : (Object.entries(STAGE_LABEL).find(([, label]) => label.toLowerCase() === text(stated.stage).toLowerCase())?.[0] as Stage | undefined);
  const stage = to && stages.includes(to) && to !== deal.stage ? { from: deal.stage, to } : null;
  return { dealId: deal.id, changes, stage, quote: text(stated.quote).slice(0, 400) };
}

/** The deal columns to write when a person accepts a proposal, from its changes. Pure. */
export function dealPatch(changes: { field: string; to: unknown }[]): Record<string, string | number | Date> {
  const out: Record<string, string | number | Date> = {};
  for (const c of changes) {
    if (c.field === "amountUsd" || c.field === "valuationUsd") { const n = parseMoney(c.to as string | number); if (n !== null) out[c.field] = n; }
    else if (c.field === "nextStepDue") { const d = isoDay(String(c.to)); if (d) out.nextStepDue = new Date(`${d}T12:00:00Z`); }
    else if (c.field === "round" || c.field === "sector" || c.field === "nextStep") { const t = text(String(c.to ?? "")); if (t) out[c.field] = t.slice(0, 300); }
  }
  return out;
}

/** "Round: Seed → Series A; Amount: $8.0M" for a proposal's title. Pure. */
export function describeChanges(changes: FieldChange[], money: (n: number | null) => string): string {
  return changes.map((c) => {
    const fmt = (v: string | number | null) => (v === null || v === "" ? "blank" : c.field === "amountUsd" || c.field === "valuationUsd" ? money(Number(v)) : String(v));
    return `${c.label}: ${fmt(c.from)} → ${fmt(c.to)}`;
  }).join("; ");
}
