/**
 * How sure the Precedent Engine is of each deal term (E1, step 5). The checks a field passed give a raw
 * score; isotonic regression per field family, fitted on hand-labelled fields (scripts/fixtures/deals/
 * labels.jsonl: candidates the builder produced, each confirmed or corrected by a person), maps the score
 * to the probability that the field is right. The shipped calibration (confidence.json) says how many
 * labelled fields it rests on; until a family has at least MIN_LABELLED, its numbers are the stated prior
 * below and the page says so ("prior estimate, 23 labelled fields so far") instead of claiming a measured
 * rate. Pure apart from the shipped JSON.
 */
import { isotonicAt, isotonicFit, type Isotonic } from "../calib";
import type { CheckResult } from "./checks";
import { FAMILIES, FIELD, type Family } from "./fields";
import shipped from "./confidence.json";

/** A family needs this many labelled fields before its confidence is called calibrated. */
export const MIN_LABELLED = 60;

export type FamilyCalibration = { n: number; correct: number; iso: Isotonic | null };
export type ConfidenceModel = { version: string; fittedAt: string; labelledDeals: number; families: Partial<Record<Family, FamilyCalibration>> };

/**
 * The raw score from the checks, 0 to 1: a field needs its quote (and, if numeric, a re-read value) just
 * to be stored; on top of that, agreeing with the model's own reading, passing cross-field checks and
 * coming from a section found by its heading each raise it, and a failed check lowers it. Pure.
 */
export function rawScore(checks: CheckResult[], via: "heading" | "keywords"): number {
  let s = 0.55;
  for (const c of checks) {
    if (c.name === "quote" || c.name === "reparse" || c.name === "items") s += c.ok ? 0.05 : -0.3;
    else if (c.name === "model") s += c.ok === true ? 0.1 : c.ok === false ? -0.15 : 0;
    else s += c.ok === true ? 0.12 : c.ok === false ? -0.25 : 0;
  }
  if (via === "heading") s += 0.08;
  return Math.max(0, Math.min(1, s));
}

/**
 * The stated prior before a family is calibrated: how often fields with this raw score were right in the
 * spot-checks behind the spec (about 9 in 10 for a checked, quoted value), shrunk toward one half for low
 * scores. Shown as a prior, never as a measured rate. Pure.
 */
export const priorAt = (raw: number) => Math.round((0.5 + 0.42 * raw) * 1000) / 1000;

export const model = (): ConfidenceModel => shipped as ConfidenceModel;

/** A field's confidence and how it is to be read: calibrated (with its record) or a prior. Pure. */
export function confidenceOf(field: string, raw: number, m: ConfidenceModel = model()): { p: number; calibrated: boolean; n: number; note: string } {
  const fam = FIELD[field]?.family;
  const c = fam ? m.families[fam] : undefined;
  if (c?.iso && c.n >= MIN_LABELLED) {
    const p = isotonicAt(c.iso, raw);
    return { p, calibrated: true, n: c.n, note: `fields at this confidence were right ${Math.round(p * 100)}% of the time on ${c.n} labelled ${fam} fields (${m.labelledDeals} deals)` };
  }
  return { p: priorAt(raw), calibrated: false, n: c?.n ?? 0, note: `prior estimate: ${c?.n ?? 0} labelled ${fam ?? "such"} fields so far, calibration from ${MIN_LABELLED}` };
}

export type LabelledField = { deal: string; field: string; raw: number; correct: boolean };

/** Fit the per-family isotonic maps from labelled fields (scripts/eval-precedents.ts writes confidence.json). Pure. */
export function fitConfidence(rows: LabelledField[], version: string): ConfidenceModel {
  const families: Partial<Record<Family, FamilyCalibration>> = {};
  for (const fam of FAMILIES) {
    const mine = rows.filter((r) => FIELD[r.field]?.family === fam);
    if (!mine.length) continue;
    families[fam] = { n: mine.length, correct: mine.filter((r) => r.correct).length, iso: mine.length >= 10 ? isotonicFit(mine.map((r) => r.raw), mine.map((r) => (r.correct ? 1 : 0))) : null };
  }
  return { version, fittedAt: new Date().toISOString(), labelledDeals: new Set(rows.map((r) => r.deal)).size, families };
}
