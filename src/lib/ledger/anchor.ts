/**
 * Anchoring the research ledger without anyone remembering to: once a day, when the chain's head has
 * moved since the last anchor, its head line is emailed from the person's own connected mailbox to
 * themselves (and to the compliance address they named, if any). The email then sits with their mail
 * provider, out of reach of YouBank's database: pasting it back in Settings → Research ledger later
 * proves that every entry up to that head is unchanged. Runs from /api/cron/ledger.
 */
import { sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";
import { emailSelf } from "@/lib/news/deliver";
import { siteUrl } from "@/lib/site";
import { anchorMail, headLine } from "./chain";
import { ledgerHead, ledgerSettings, updateLedgerPrefs } from "./store";

/** Anchor one person's ledger by email when its head moved. Returns whether an email went out. */
export async function anchorByEmail(userId: string, email: string, now = new Date()): Promise<boolean> {
  const prefs = await ledgerSettings(userId);
  if (!prefs.anchorEmail) return false;
  const head = await ledgerHead(userId);
  if (!head || prefs.lastAnchor?.hash === head.hash) return false;
  const to = prefs.complianceEmail ? [prefs.complianceEmail] : [];
  const origin = siteUrl();
  const mine = await emailSelf(userId, origin, anchorMail(headLine(email, head), head.seq, origin), to);
  await updateLedgerPrefs(userId, { lastAnchor: { seq: head.seq, hash: head.hash, at: now.toISOString(), to: [mine, ...to] } });
  return true;
}

/** Everyone who asked for daily anchors, within the time given. */
export async function anchorAllLedgers(deadline: number): Promise<{ people: number; sent: number; failed: number }> {
  const rows = await requireDb().select({ userId: schema.profiles.userId, email: schema.profiles.email }).from(schema.profiles)
    .where(sql`(${schema.profiles.extra}->'ledger'->>'anchorEmail') = 'true'`);
  let sent = 0, failed = 0;
  for (const r of rows) {
    if (Date.now() > deadline) break;
    try { if (await anchorByEmail(r.userId, r.email)) sent++; }
    catch (e) { failed++; logError(e, { where: "ledger-anchor-email" }); }
  }
  return { people: rows.length, sent, failed };
}
