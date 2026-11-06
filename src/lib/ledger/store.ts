/**
 * The research ledger on the server (the chain itself is src/lib/ledger/chain.ts). Off until the person
 * turns it on (profiles.extra.ledger); then every AI answer written for them (chat, deep research,
 * workflows, red teams, desktop questions, background agents) and every call their AI apps make over MCP
 * is appended, with its prompt, model, sources and a summary of the figure check. Appending never makes
 * the answer fail: a write that cannot land is logged and skipped. Writes for one person are serialised
 * (see append), so concurrent answers never drop out of the chain.
 *
 * Without the table (migration 0033 not applied) the ledger reads as unavailable and nothing is written.
 */
import { and, asc, desc, eq, gt, lt, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { isMissingTable, logError } from "@/lib/errors";
import { updateExtra } from "@/lib/prefs/extra";
import { cleanContent, nextEntry, signoffContent, verifyChain, type LedgerContent, type LedgerEntry, type LedgerKind, type Verification } from "./chain";

export type LedgerSettings = { on: boolean; since: string | null };
const cache = new Map<string, { at: number; on: boolean }>();

export async function ledgerSettings(userId: string): Promise<LedgerSettings> {
  const [row] = await requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
  const l = ((row?.extra as Record<string, unknown> | undefined)?.ledger ?? {}) as Record<string, unknown>;
  return { on: l.on === true, since: typeof l.since === "string" ? l.since : null };
}

async function isOn(userId: string): Promise<boolean> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < 30_000) return hit.on;
  const on = (await ledgerSettings(userId).catch(() => ({ on: false }))).on;
  cache.set(userId, { at: Date.now(), on });
  if (cache.size > 5000) cache.delete(cache.keys().next().value as string);
  return on;
}

export async function setLedger(userId: string, on: boolean): Promise<LedgerSettings> {
  let out: LedgerSettings = { on, since: null };
  await updateExtra(userId, (extra) => {
    const prev = (extra.ledger ?? {}) as Record<string, unknown>;
    out = { on, since: on ? (prev.on === true && typeof prev.since === "string" ? prev.since : new Date().toISOString()) : null };
    return { ...extra, ledger: out };
  });
  cache.set(userId, { at: Date.now(), on });
  return out;
}

const cols = { seq: schema.researchLedger.seq, at: schema.researchLedger.at, kind: schema.researchLedger.kind, subject: schema.researchLedger.subject, model: schema.researchLedger.model, prompt: schema.researchLedger.prompt, output: schema.researchLedger.output, sources: schema.researchLedger.sources, meta: schema.researchLedger.meta, prev: schema.researchLedger.prev, hash: schema.researchLedger.hash };
type Row = { seq: number; at: Date; kind: string; subject: string; model: string; prompt: string; output: string; sources: LedgerEntry["sources"]; meta: Record<string, unknown>; prev: string; hash: string };
const toEntry = (r: Row): LedgerEntry => ({ ...r, kind: r.kind as LedgerKind, at: r.at.toISOString() });

/**
 * Append an entry now, whether or not the ledger is on (sign-offs; the caller checks). One writer per
 * person at a time: a transaction-scoped advisory lock on the person serialises appends, so a burst of
 * answers or MCP calls lands as a gap-free chain instead of racing for the next number. The lock is
 * released with the transaction; other people's ledgers are never held up.
 */
export async function append(userId: string, content: LedgerContent): Promise<LedgerEntry> {
  const t = schema.researchLedger;
  return requireDb().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`ledger:${userId}`}, 0))`);
    const [prev] = await tx.select({ seq: t.seq, hash: t.hash }).from(t).where(eq(t.userId, userId)).orderBy(desc(t.seq)).limit(1);
    // Postgres keeps microseconds; the hash is over the millisecond ISO time, so store exactly that.
    const e = nextEntry(prev ?? null, content, new Date());
    await tx.insert(t).values({ userId, ...e, at: new Date(e.at) });
    return e;
  });
}

/** Record an AI answer or call when the person's ledger is on. Never throws. */
export async function record(userId: string | null | undefined, content: Partial<LedgerContent> & { kind: LedgerKind }): Promise<void> {
  if (!userId) return;
  try {
    if (!(await isOn(userId))) return;
    await append(userId, cleanContent(content));
  } catch (e) {
    if (!isMissingTable(e)) logError(e, { where: "ledger.record" });
  }
}

/** The kind of entry for an AI feature name (src/lib/ai/usage). */
export const kindOf = (feature: string): LedgerKind => (feature.startsWith("tool:") || feature.startsWith("studio") ? "workflow" : feature === "book.red-team" ? "red_team" : "chat");

export type LedgerPage = { entries: LedgerEntry[]; total: number; reviewed: Record<number, { decision: string; reviewer: string; at: string }> };

/** Newest first, `limit` at a time, before a sequence number; with the sign-offs that refer to them. */
export async function listEntries(userId: string, opts: { before?: number; limit?: number; kind?: LedgerKind } = {}): Promise<LedgerPage> {
  const t = schema.researchLedger;
  const where = and(eq(t.userId, userId), opts.before ? lt(t.seq, opts.before) : undefined, opts.kind ? eq(t.kind, opts.kind) : undefined);
  const [rows, [{ n }], signs] = await Promise.all([
    requireDb().select(cols).from(t).where(where).orderBy(desc(t.seq)).limit(Math.min(Math.max(opts.limit ?? 50, 1), 200)),
    requireDb().select({ n: sql<number>`count(*)::int` }).from(t).where(eq(t.userId, userId)),
    requireDb().select({ meta: t.meta, at: t.at }).from(t).where(and(eq(t.userId, userId), eq(t.kind, "signoff"))).orderBy(asc(t.seq)).limit(5000),
  ]);
  const reviewed: LedgerPage["reviewed"] = {};
  for (const s of signs) {
    const ref = Number(s.meta.ref);
    if (Number.isInteger(ref)) reviewed[ref] = { decision: String(s.meta.decision ?? ""), reviewer: String(s.meta.reviewer ?? ""), at: s.at.toISOString() };
  }
  return { entries: rows.map(toEntry), total: n, reviewed };
}

/** Every entry in order, 200 at a time (for verifying and exporting): an entry can be long, so never all at once. */
export async function* allEntries(userId: string): AsyncGenerator<LedgerEntry[]> {
  const t = schema.researchLedger;
  let after = 0;
  for (;;) {
    const rows = await requireDb().select(cols).from(t).where(and(eq(t.userId, userId), gt(t.seq, after))).orderBy(asc(t.seq)).limit(200);
    if (!rows.length) return;
    yield rows.map(toEntry);
    after = rows[rows.length - 1].seq;
  }
}

/** Recompute the whole chain. */
export async function verifyAll(userId: string): Promise<Verification> {
  let prev: LedgerEntry | null = null, checked = 0;
  for await (const page of allEntries(userId)) {
    const v = verifyChain(page, prev);
    if (!v.ok) return { ...v, checked: checked + v.checked };
    checked += page.length;
    prev = page[page.length - 1];
  }
  return { ok: true, checked, firstBad: null, problem: "" };
}

/** A person's review of an entry, as its own entry. */
export async function signOff(userId: string, seq: number, reviewer: string, decision: "approved" | "rejected" | "noted", note: string): Promise<LedgerEntry | null> {
  const [ref] = await requireDb().select({ seq: schema.researchLedger.seq, hash: schema.researchLedger.hash, subject: schema.researchLedger.subject, kind: schema.researchLedger.kind })
    .from(schema.researchLedger).where(and(eq(schema.researchLedger.userId, userId), eq(schema.researchLedger.seq, seq)));
  if (!ref || ref.kind === "signoff") return null;
  return append(userId, signoffContent(ref, reviewer, decision, note));
}

/** The newest entry: what to anchor. */
export async function ledgerHead(userId: string): Promise<Pick<LedgerEntry, "seq" | "hash" | "at"> | null> {
  const t = schema.researchLedger;
  const [r] = await requireDb().select({ seq: t.seq, hash: t.hash, at: t.at }).from(t).where(eq(t.userId, userId)).orderBy(desc(t.seq)).limit(1);
  return r ? { seq: r.seq, hash: r.hash, at: r.at.toISOString() } : null;
}

export type AnchorCheck = { seq: number | null; hash: string; source: string; state: "matches" | "differs" | "missing"; detail: string };

/** Whether each anchor (a head line kept outside YouBank) still matches the chain. */
export async function checkAnchors(userId: string, anchors: { seq: number; hash: string; source?: string }[]): Promise<AnchorCheck[]> {
  const t = schema.researchLedger;
  return Promise.all(anchors.map(async (a) => {
    const [r] = await requireDb().select({ hash: t.hash }).from(t).where(and(eq(t.userId, userId), eq(t.seq, a.seq)));
    const source = a.source ?? "a saved head line";
    if (!r) return { seq: a.seq, hash: a.hash, source, state: "missing" as const, detail: `Entry ${a.seq} is no longer in the ledger.` };
    return r.hash === a.hash
      ? { seq: a.seq, hash: a.hash, source, state: "matches" as const, detail: `Entries 1 to ${a.seq} are exactly as they were when this was saved.` }
      : { seq: a.seq, hash: a.hash, source, state: "differs" as const, detail: `Entry ${a.seq} has a different hash now: the ledger up to it was changed after this was saved.` };
  }));
}

/** Heads notarized on chain (Crypto → Notarize, kind "ledger"), each checked against the chain as it is now. */
export async function chainAnchors(userId: string): Promise<AnchorCheck[]> {
  const n = schema.cryptoNotarizations, t = schema.researchLedger;
  const rows = await requireDb().select({ sha256: n.sha256, status: n.status, txHash: n.txHash, blockNumber: n.blockNumber, confirmedAt: n.confirmedAt })
    .from(n).where(and(eq(n.userId, userId), eq(n.kind, "ledger"))).orderBy(desc(n.createdAt)).limit(20).catch(() => []);
  return Promise.all(rows.map(async (a) => {
    const [r] = await requireDb().select({ seq: t.seq }).from(t).where(and(eq(t.userId, userId), eq(t.hash, a.sha256))).limit(1);
    const source = `Base transaction ${a.txHash.slice(0, 10)}…${a.status === "confirmed" ? ` (block ${a.blockNumber ?? "?"})` : ` (${a.status})`}`;
    return r
      ? { seq: r.seq, hash: a.sha256, source, state: "matches" as const, detail: `Entries 1 to ${r.seq} are exactly as they were when anchored on Base${a.confirmedAt ? ` (${a.confirmedAt.toISOString().slice(0, 16).replace("T", " ")} UTC)` : ""}.` }
      : { seq: null, hash: a.sha256, source, state: "missing" as const, detail: "No entry has this hash now: the ledger was rewritten after it was anchored." };
  }));
}
