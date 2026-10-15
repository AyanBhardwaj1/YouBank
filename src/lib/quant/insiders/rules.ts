/**
 * Q7, Insider and Activist Clusters: the rules, pure.
 *
 * 1. Clean: open-market purchases (code P) and sales (S) only; 10%-only owners left out of the insider signal;
 *    trades under a Rule 10b5-1 plan left out; purchases within five days after the issuer filed an offering
 *    prospectus (424B) left out (they are usually bought in the offering).
 * 2. Routine or opportunistic (Cohen, Malloy and Pomorski 2012): an insider who traded in the same calendar month
 *    in each of the three prior years is routine; one with trades in each of the three prior years who is not is
 *    opportunistic; anyone else is unclassified, shown separately and never in a signal.
 * 3. Events, each timed from the EDGAR acceptance of the filing that completed it:
 *    cluster_buy    three or more officers or directors with opportunistic purchases within 30 days, $100,000+
 *    large_officer_buy  a CEO or CFO opportunistic purchase of $250,000+ or 25%+ of their holding
 *    cluster_sell   the same as a cluster buy for sales (shown with the caution that sales say less)
 *    activist_new   a new Schedule 13D, or a 13G holder switching to a 13D
 *    activist_up    a 13D amendment adding at least one point, or changing Item 4 (purpose)
 */
export type Tx = {
  accession: string; line: number; issuerCik: string; symbol: string; ownerCik: string; ownerName: string;
  isDirector: boolean; isOfficer: boolean; isTenPct: boolean; title: string; code: string; acquired: boolean;
  shares: number; price: number | null; ownedAfter: number | null; tradeDate: string; acceptedAt: string; plan10b51: boolean; url?: string;
  /** The filing's form ("4" or "4/A"), when known. */
  form?: string;
};

const isAmendment = (form?: string) => /\/A\s*$/i.test((form ?? "").trim());

/**
 * Lines of a Form 4/A that repeat a line already reported in another filing (same insider, trade date, code,
 * shares and price) are dropped, so an amendment that restates a whole form does not count its trades twice
 * (doubling a cluster's dollars, or making one of its own). The earlier report stands, so the event keeps the
 * time the trade first became public. Amendment lines that add or correct a trade are kept. Pure.
 */
export function dropAmendmentRepeats<T extends Pick<Tx, "accession" | "ownerCik" | "tradeDate" | "code" | "shares" | "price" | "acceptedAt" | "form">>(txs: T[]): T[] {
  const key = (t: T) => [t.ownerCik, t.tradeDate, t.code, t.shares, t.price ?? ""].join("|");
  const byKey = new Map<string, T[]>();
  for (const t of txs) byKey.set(key(t), [...(byKey.get(key(t)) ?? []), t]);
  return txs.filter((t) => !isAmendment(t.form) || !(byKey.get(key(t)) ?? []).some((o) => o.accession !== t.accession && (!isAmendment(o.form) || o.acceptedAt < t.acceptedAt)));
}

export type Habit = "routine" | "opportunistic" | "unclassified";

const year = (d: string) => Number(d.slice(0, 4));
const month = (d: string) => Number(d.slice(5, 7));
const value = (t: Tx) => t.shares * (t.price ?? 0);

/** Routine or opportunistic, from the insider's own history of open-market trades. */
export function classify(history: Pick<Tx, "tradeDate" | "code">[], t: Pick<Tx, "tradeDate">): Habit {
  const y = year(t.tradeDate), m = month(t.tradeDate);
  const trades = history.filter((h) => (h.code === "P" || h.code === "S") && h.tradeDate < `${y}-01-01`);
  const inYear = (yy: number) => trades.some((h) => year(h.tradeDate) === yy);
  const inMonth = (yy: number) => trades.some((h) => year(h.tradeDate) === yy && month(h.tradeDate) === m);
  if (![1, 2, 3].every((k) => inYear(y - k))) return "unclassified";
  return [1, 2, 3].every((k) => inMonth(y - k)) ? "routine" : "opportunistic";
}

/** Whether a line counts toward insider signals, and why not when it does not. */
export function eligible(t: Tx, offerings: string[] = []): { ok: boolean; reason?: string } {
  if (t.code !== "P" && t.code !== "S") return { ok: false, reason: "not an open-market purchase or sale" };
  if (t.isTenPct && !t.isDirector && !t.isOfficer) return { ok: false, reason: "a 10% owner, not an officer or director" };
  if (t.plan10b51) return { ok: false, reason: "made under a Rule 10b5-1 trading plan" };
  if (t.code === "P" && offerings.some((o) => t.tradeDate >= o && Date.parse(t.tradeDate) - Date.parse(o) <= 5 * 86_400_000)) return { ok: false, reason: "within five days after an offering prospectus" };
  if (!(t.shares > 0) || !(t.price && t.price > 0)) return { ok: false, reason: "no shares or price" };
  return { ok: true };
}

export type InsiderEvent = { id: string; type: "cluster_buy" | "cluster_sell" | "large_officer_buy"; issuerCik: string; symbol: string; occurredAt: string; acceptedAt: string; insiders: { cik: string; name: string; role: string; value: number; date: string; accession: string; url?: string }[]; totalUsd: number; days: number };

const role = (t: Tx) => (t.title || (t.isOfficer ? "Officer" : t.isDirector ? "Director" : "Insider")).trim();
const CEO_CFO = /\b(ceo|cfo|chief executive|chief financial|principal executive|principal financial)\b/i;

/**
 * Events for one issuer from its transactions (any order) and each insider's full history. Events closer than
 * 30 days to an earlier one of the same type are not repeated.
 */
export function detectEvents(txs: Tx[], historyOf: (ownerCik: string) => Pick<Tx, "tradeDate" | "code">[], offerings: string[] = []): InsiderEvent[] {
  const ok = txs.filter((t) => eligible(t, offerings).ok && (t.isDirector || t.isOfficer) && classify(historyOf(t.ownerCik), t) === "opportunistic");
  const out: InsiderEvent[] = [];
  const byAccepted = [...ok].sort((a, b) => a.acceptedAt.localeCompare(b.acceptedAt) || a.line - b.line);
  const last: Record<string, string> = {};
  const fire = (type: InsiderEvent["type"], completing: Tx, members: Tx[]) => {
    if (last[type] && Date.parse(completing.tradeDate) - Date.parse(last[type]) < 30 * 86_400_000) return;
    last[type] = completing.tradeDate;
    const byOwner = new Map<string, Tx[]>();
    for (const m of members) byOwner.set(m.ownerCik, [...(byOwner.get(m.ownerCik) ?? []), m]);
    const dates = members.map((m) => m.tradeDate).sort();
    out.push({
      id: `${type}:${completing.issuerCik}:${completing.accession}`, type, issuerCik: completing.issuerCik, symbol: completing.symbol, occurredAt: completing.tradeDate, acceptedAt: completing.acceptedAt,
      insiders: [...byOwner.values()].map((ts) => ({ cik: ts[0].ownerCik, name: ts[0].ownerName, role: role(ts[0]), value: ts.reduce((s, x) => s + value(x), 0), date: ts.map((x) => x.tradeDate).sort()[0], accession: ts[0].accession, url: ts[0].url })),
      totalUsd: members.reduce((s, m) => s + value(m), 0), days: Math.round((Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86_400_000),
    });
  };
  for (let i = 0; i < byAccepted.length; i++) {
    const t = byAccepted[i];
    const known = byAccepted.slice(0, i + 1);
    for (const [code, type] of [["P", "cluster_buy"], ["S", "cluster_sell"]] as const) {
      if (t.code !== code) continue;
      const win = known.filter((x) => x.code === code && Math.abs(Date.parse(x.tradeDate) - Date.parse(t.tradeDate)) <= 30 * 86_400_000 && x.tradeDate <= t.tradeDate);
      const owners = new Set(win.map((x) => x.ownerCik));
      if (owners.size >= 3 && win.reduce((s, x) => s + value(x), 0) >= 100_000) fire(type, t, win);
    }
    if (t.code === "P" && CEO_CFO.test(t.title)) {
      const before = t.ownedAfter !== null ? t.ownedAfter - t.shares : null;
      if (value(t) >= 250_000 || (before !== null && before > 0 && t.shares / before >= 0.25)) fire("large_officer_buy", t, [t]);
    }
  }
  return out;
}

/* ---------------- Activists ---------------- */

export type Stake = { form: string; holder: string; holderCik: string; percent: number | null; item4: string; acceptedAt: string; accession: string };
export type ActivistEvent = { id: string; type: "activist_new" | "activist_up"; holder: string; from: number | null; to: number | null; acceptedAt: string; accession: string; item4Changed: boolean };

/** Item 4 (Purpose of Transaction) of a Schedule 13D, as plain text (old text and new XML forms). */
export function item4Text(doc: string): string {
  const xml = /<purposeOfTransaction>([\s\S]*?)<\/purposeOfTransaction>/i.exec(doc)?.[1];
  if (xml) return xml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 6_000);
  const text = doc.replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/g, " ").replace(/\s+/g, " ");
  const m = /item\s*4\.?\s*(?:purpose\s+of\s+(?:the\s+)?transaction)?\.?([\s\S]*?)item\s*5\.?/i.exec(text);
  return (m?.[1] ?? "").trim().slice(0, 6_000);
}

const isD = (form: string) => /13D/i.test(form);
const normalise = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();

/** The activist event a new 13D or 13G filing makes, given the same holder's previous stake in the issuer. */
export function activistEvent(prev: Stake | null, cur: Stake, issuerCik: string): ActivistEvent | null {
  if (!isD(cur.form)) return null;
  const id = (t: string) => `${t}:${issuerCik}:${cur.accession}`;
  // An amendment is never a new stake: the first 13D/A YouBank sees from a long-time holder (its original 13D filed
  // before the store began) has no earlier stake to compare with, so it makes no event; the next one compares.
  if (!prev || !isD(prev.form)) return isAmendment(cur.form) ? null : { id: id("activist_new"), type: "activist_new", holder: cur.holder, from: prev?.percent ?? null, to: cur.percent, acceptedAt: cur.acceptedAt, accession: cur.accession, item4Changed: false };
  const added = cur.percent !== null && prev.percent !== null && cur.percent - prev.percent >= 1;
  const item4Changed = !!cur.item4 && !!prev.item4 && normalise(cur.item4) !== normalise(prev.item4);
  return added || item4Changed ? { id: id("activist_up"), type: "activist_up", holder: cur.holder, from: prev.percent, to: cur.percent, acceptedAt: cur.acceptedAt, accession: cur.accession, item4Changed } : null;
}
