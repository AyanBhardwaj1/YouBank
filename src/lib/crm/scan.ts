import { DAY_MS, OPEN_STAGES, REPLY_WORTHY, normalizeCompany, type Category, type Stage } from "./model";

/**
 * What the agent looks for when it scans the CRM: conversations waiting on the other side, deals gone
 * quiet, relationships due a reconnection, and funding news about people you know.
 *
 * Pure functions over plain rows, with no database or model access, so every rule here is testable.
 */

const daysBetween = (a: Date, b: Date) => Math.floor((b.getTime() - a.getTime()) / DAY_MS);

/* ---------------- Follow-ups ---------------- */

export type ThreadActivity = {
  threadId: number; subject: string; category: string; dealId: number | null; contactId: number | null;
  lastDirection: "inbound" | "outbound"; lastMessageId: number; lastAt: Date; inCampaign: boolean; hasPendingDraft: boolean;
};

/**
 * Threads where the reader wrote last and has heard nothing back.
 *
 * Only threads that matter (a reply-worthy category, or tied to a deal), only once the wait passes
 * `afterDays`, and not after 30 days: by then it is a reconnection, which nurture handles. Campaign
 * threads are left to their own sequence.
 */
export function followUpCandidates(threads: ThreadActivity[], now: Date, afterDays: number): (ThreadActivity & { waited: number })[] {
  return threads
    .filter((t) => t.lastDirection === "outbound" && !t.inCampaign && !t.hasPendingDraft)
    .filter((t) => t.dealId != null || REPLY_WORTHY.includes(t.category as Category))
    .map((t) => ({ ...t, waited: daysBetween(t.lastAt, now) }))
    .filter((t) => t.waited >= afterDays && t.waited <= 30)
    .sort((a, b) => b.waited - a.waited);
}

/* ---------------- Stale deals ---------------- */

export type DealActivity = { dealId: number; name: string; stage: string; contactId: number | null; updatedAt: Date; lastEmailAt: Date | null };

/** Live deals past the first look where nothing has moved, by edit or by email, for `afterDays`. */
export function staleDeals(deals: DealActivity[], now: Date, afterDays: number): (DealActivity & { quiet: number })[] {
  return deals
    .filter((d) => OPEN_STAGES.includes(d.stage as Stage) && d.stage !== "inbox")
    .map((d) => {
      const last = d.lastEmailAt && d.lastEmailAt > d.updatedAt ? d.lastEmailAt : d.updatedAt;
      return { ...d, quiet: daysBetween(last, now) };
    })
    .filter((d) => d.quiet >= afterDays)
    .sort((a, b) => b.quiet - a.quiet);
}

/* ---------------- Nurture ---------------- */

export type ContactActivity = {
  contactId: number; kind: string; optedOut: boolean;
  lastSentAt: Date | null; lastContactAt: Date | null; exchanges: number;
  /** Already has a nurture or campaign email waiting, or is in a live campaign. */
  busy: boolean;
  /** The last time this rule looked at them, drafted or skipped. */
  lastEvaluatedAt: Date | null;
};

export type RuleShape = { cadenceDays: number; anchor: string; kinds: string[]; minExchanges: number };

/**
 * Contacts a nurture rule should consider today, most engaged first.
 *
 * The anchor is the reader's last email ("last_sent", the default) or the last email either way. A
 * contact the rule already looked at inside the cadence is left alone, whether it drafted or skipped,
 * so a "no" from the agent is not re-asked every night.
 */
export function nurtureCandidates(contacts: ContactActivity[], rule: RuleShape, now: Date): (ContactActivity & { quiet: number })[] {
  return contacts
    .filter((c) => !c.optedOut && !c.busy)
    .filter((c) => rule.kinds.length === 0 || rule.kinds.includes(c.kind))
    .filter((c) => c.exchanges >= rule.minExchanges)
    .map((c) => {
      const anchor = rule.anchor === "last_contact" ? c.lastContactAt : c.lastSentAt ?? c.lastContactAt;
      return { ...c, quiet: anchor ? daysBetween(anchor, now) : -1 };
    })
    .filter((c) => c.quiet >= rule.cadenceDays)
    .filter((c) => !c.lastEvaluatedAt || daysBetween(c.lastEvaluatedAt, now) >= rule.cadenceDays)
    .sort((a, b) => b.exchanges - a.exchanges || b.quiet - a.quiet);
}

/* ---------------- Funding signals ---------------- */

export type SignalEntity = { contactId: number | null; dealId: number | null; name: string; company: string; since: Date | null };
export type Filing = { sourceId: string; name: string; officers: string[]; raised: string; raisedUsd: number | null; filedOn: string; url: string; industry: string };
export type SignalMatch = { entity: SignalEntity; filing: Filing; strength: "officer" | "name" };

const normPerson = (s: string) => s.toLowerCase().replace(/[^a-z ]+/g, " ").replace(/\s+/g, " ").trim();

/**
 * Form D filings by companies you have a relationship with.
 *
 * A match needs the company name to be the same after dropping legal suffixes; a name that is short
 * or generic is not enough on its own, so it also needs the contact to be named as an officer.
 * Filings from before the relationship's last activity are old news and are skipped.
 */
export function matchFundingSignals(entities: SignalEntity[], filings: Filing[]): SignalMatch[] {
  const byName = new Map<string, Filing[]>();
  for (const f of filings) {
    const key = normalizeCompany(f.name);
    if (!key) continue;
    byName.set(key, [...(byName.get(key) ?? []), f]);
  }
  const out: SignalMatch[] = [];
  for (const e of entities) {
    const key = normalizeCompany(e.company);
    if (!key) continue;
    for (const f of byName.get(key) ?? []) {
      if (e.since && new Date(f.filedOn) < new Date(e.since.toISOString().slice(0, 10))) continue;
      const officer = !!e.name && f.officers.some((o) => normPerson(o) === normPerson(e.name));
      const distinctive = key.length >= 5 && key.split(" ").some((w) => w.length >= 4);
      if (!officer && !distinctive) continue;
      out.push({ entity: e, filing: f, strength: officer ? "officer" : "name" });
    }
  }
  return out;
}

/* ---------------- Batching model calls ---------------- */

/**
 * Run `fn` over items a few at a time, and stop starting new work once `deadline` passes, so a
 * scheduled run always returns inside the host's time limit. Returns what finished.
 */
export async function pool<T, R>(items: T[], size: number, deadline: number, fn: (item: T) => Promise<R>): Promise<{ done: R[]; errors: string[]; unstarted: number }> {
  const done: R[] = [];
  const errors: string[] = [];
  let i = 0;
  const worker = async () => {
    while (i < items.length && Date.now() < deadline) {
      const item = items[i++];
      try { done.push(await fn(item)); } catch (e) { errors.push(e instanceof Error ? e.message : String(e)); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return { done, errors, unstarted: Math.max(0, items.length - i) };
}
