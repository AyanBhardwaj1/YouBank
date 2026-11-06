/**
 * The research ledger's chain: each entry's hash covers its content and the hash of the entry before it,
 * so changing, removing or reordering any past entry breaks every hash after it. That is what makes the
 * record tamper-evident: anyone holding an export can recompute the chain (`verifyChain`, or the
 * five-line recipe in the export header) without trusting YouBank.
 *
 * The hash is SHA-256 over a canonical JSON form (keys sorted, no whitespace) of: seq, at (ISO), kind,
 * subject, model, prompt, output, sources, meta and prev (the previous entry's hash, "" for the first).
 * Pure; tested in scripts/test-ledger.ts.
 */
import { createHash } from "node:crypto";

export const KINDS = ["chat", "workflow", "red_team", "mcp", "signoff", "note"] as const;
export type LedgerKind = (typeof KINDS)[number];
export type LedgerSource = { id: string; label: string; url: string };

export type LedgerContent = {
  kind: LedgerKind; subject: string; model: string; prompt: string; output: string;
  sources: LedgerSource[]; meta: Record<string, unknown>;
};
export type LedgerEntry = LedgerContent & { seq: number; at: string; prev: string; hash: string };

/** Limits on what one entry keeps: enough for a long answer and its sources, not a whole filing. */
export const LIMITS = { subject: 200, model: 120, prompt: 20_000, output: 60_000, sources: 60 } as const;

/** JSON with keys sorted at every level: the same value always gives the same text. */
export function canonical(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
}

export function entryHash(e: Omit<LedgerEntry, "hash">): string {
  const body = { seq: e.seq, at: e.at, kind: e.kind, subject: e.subject, model: e.model, prompt: e.prompt, output: e.output, sources: e.sources, meta: e.meta, prev: e.prev };
  return createHash("sha256").update(canonical(body)).digest("hex");
}

const clip = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : "");

/** What an entry stores, cleaned and cut to the limits. */
export function cleanContent(c: Partial<LedgerContent> & { kind: LedgerKind }): LedgerContent {
  return {
    kind: c.kind, subject: clip(c.subject, LIMITS.subject), model: clip(c.model, LIMITS.model), prompt: clip(c.prompt, LIMITS.prompt), output: clip(c.output, LIMITS.output),
    sources: (c.sources ?? []).filter((s) => s && typeof s.url === "string").slice(0, LIMITS.sources).map((s) => ({ id: clip(s.id, 8), label: clip(s.label, 300), url: clip(s.url, 600) })),
    meta: c.meta && typeof c.meta === "object" ? JSON.parse(JSON.stringify(c.meta)) as Record<string, unknown> : {},
  };
}

/** The next entry after `last` (null for the first). */
export function nextEntry(last: Pick<LedgerEntry, "seq" | "hash"> | null, content: LedgerContent, at: Date): LedgerEntry {
  const base = { ...content, seq: (last?.seq ?? 0) + 1, at: at.toISOString(), prev: last?.hash ?? "" };
  return { ...base, hash: entryHash(base) };
}

export type Verification = { ok: boolean; checked: number; firstBad: number | null; problem: string };

/**
 * Recompute the chain over entries in order. `from` is the entry just before the first one given (when
 * checking a slice), so a page can be verified on its own.
 */
export function verifyChain(entries: LedgerEntry[], from: Pick<LedgerEntry, "seq" | "hash"> | null = null): Verification {
  let prev = from;
  for (const e of entries) {
    const want = (prev?.seq ?? 0) + 1;
    if (e.seq !== want) return { ok: false, checked: entries.indexOf(e), firstBad: e.seq, problem: `Entry ${want} is missing: the next one is ${e.seq}.` };
    if (e.prev !== (prev?.hash ?? "")) return { ok: false, checked: entries.indexOf(e), firstBad: e.seq, problem: `Entry ${e.seq} does not follow from entry ${prev?.seq ?? 0}: the chain was changed before it.` };
    if (entryHash(e) !== e.hash) return { ok: false, checked: entries.indexOf(e), firstBad: e.seq, problem: `Entry ${e.seq} was changed after it was written.` };
    prev = e;
  }
  return { ok: true, checked: entries.length, firstBad: null, problem: "" };
}

/** A sign-off: a person's review of an earlier entry, written as its own entry so the chain stays append-only. */
export function signoffContent(ref: Pick<LedgerEntry, "seq" | "hash" | "subject">, reviewer: string, decision: "approved" | "rejected" | "noted", note: string): LedgerContent {
  return cleanContent({ kind: "signoff", subject: `Review of entry ${ref.seq}${ref.subject ? `: ${ref.subject}` : ""}`, model: "", prompt: "", output: clip(note, 2000), sources: [], meta: { ref: ref.seq, refHash: ref.hash, reviewer: clip(reviewer, 200), decision } });
}

/** The export's first line: whose ledger, when, and how to check it. */
export function exportHeader(owner: string, at: Date) {
  return {
    youbank_research_ledger: 1, owner, exported_at: at.toISOString(),
    verify: "For each entry in order: hash = sha256(canonical JSON of {seq, at, kind, subject, model, prompt, output, sources, meta, prev}) with keys sorted at every level and no whitespace; prev is the previous entry's hash (\"\" for the first) and seq counts up from 1.",
  };
}

/** One JSON line per entry, after the header (the route streams the same lines page by page). */
export function exportJsonl(entries: LedgerEntry[], owner: string, at: Date): string {
  return [JSON.stringify(exportHeader(owner, at)), ...entries.map((e) => JSON.stringify(e))].join("\n") + "\n";
}

/* ---------------- Anchoring the chain outside YouBank ---------------- */

/**
 * The chain's head as one line to keep somewhere YouBank cannot change (a compliance file, an email to
 * oneself, a notarization on chain). Later, pasting the line back proves that every entry up to that one
 * is exactly as it was then: rewriting any of them would change the head's hash.
 */
export function headLine(owner: string, head: Pick<LedgerEntry, "seq" | "hash" | "at">): string {
  return `YouBank research ledger · ${owner} · entry ${head.seq} · sha256 ${head.hash} · ${head.at}`;
}

/** Every (entry, hash) pair in pasted text: head lines, or "entry 12 … <64 hex>" written any way. */
export function parseAnchors(text: string): { seq: number; hash: string }[] {
  const out: { seq: number; hash: string }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const hash = /\b([0-9a-f]{64})\b/i.exec(line)?.[1]?.toLowerCase();
    const seq = Number(/\b(?:entry|#|seq)\s*#?\s*(\d{1,9})\b/i.exec(line)?.[1]);
    if (hash && Number.isInteger(seq) && seq > 0 && !out.some((a) => a.seq === seq && a.hash === hash)) out.push({ seq, hash });
  }
  return out.slice(0, 50);
}
