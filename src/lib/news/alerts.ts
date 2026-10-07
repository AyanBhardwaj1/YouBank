/**
 * Alerts: the few stories a person should hear about now rather than in tomorrow's brief. A story
 * alerts once per person (the notification key dedupes), at most five per run, for one of:
 * - a watchlist company in a significant filing or story (urgent for a bankruptcy, a restatement, a
 *   change of control or a takeover);
 * - a company where someone in their network works (also raised in Relationships as a reason to
 *   reconnect);
 * - a $1B+ deal in their sectors; a top story for their desk above their threshold.
 * In-app always; push and Slack per their settings (held during quiet hours unless urgent); email
 * only for urgent alerts, so the inbox is not flooded.
 */
import { and, eq, isNotNull } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { cacheGet, cacheSet } from "@/lib/cache";
import { amountIn } from "./classify";
import { noteNewsForNetwork } from "./crm";
import { alertEmail, emailSelf, pushToUser, slackPost } from "./deliver";
import { deskAffinity } from "./desks";
import { inQuietHours } from "./prefs";
import { normCompany, type NetworkPerson } from "./rank";
import { readerFor, type ReaderContext } from "./reader";
import { itemsOf, recentClusters, type ClusterRow } from "./store";
import { failureMessage } from "@/lib/errors";

const URGENT_ITEMS = ["1.03", "2.04", "4.02", "5.01"];

export type AlertDecision = { alert: boolean; urgent: boolean; reasons: string[]; people: NetworkPerson[]; why: "watchlist" | "network" | "deal" | "desk" | "filing" | "" };

/** Whether this story should alert this person, and why. Pure, for tests. */
export function decideAlert(ctx: Pick<ReaderContext, "prefs" | "reader" | "desk">, c: Pick<ClusterRow, "headline" | "tickers" | "entities" | "importance" | "category" | "desks" | "kinds">, filing: { weight: number; items: string[]; form: string } | null): AlertDecision {
  const a = ctx.prefs.alerts;
  const none: AlertDecision = { alert: false, urgent: false, reasons: [], people: [], why: "" };
  if (!a.enabled) return none;
  const watched = c.tickers.filter((t) => ctx.reader.watch.has(t));
  const urgentFiling = !!filing && (filing.items.some((i) => URGENT_ITEMS.includes(i)) || /SC TO-T|SC 13E3/.test(filing.form));
  // Urgent is kept for what cannot wait: a watchlist company's bankruptcy, restatement, change of control or takeover.
  const critical = urgentFiling || (c.category === "legal" && /bankrupt|chapter 11/i.test(c.headline)) || (c.category === "deals" && /acquire|to buy|takeover|merger|tender/i.test(c.headline));
  if (a.watchlist && watched.length && (c.importance >= 0.45 || (filing && filing.weight >= 0.45) || ["deals", "legal", "capital", "earnings", "funding"].includes(c.category))) {
    return { alert: true, urgent: critical, reasons: [`On your watchlist: ${watched.slice(0, 3).join(", ")}`], people: [], why: "watchlist" };
  }
  const people: NetworkPerson[] = [];
  for (const e of c.entities) if (e.kind !== "person") for (const p of ctx.reader.network.get(normCompany(e.name)) ?? []) people.push(p);
  if (a.network && people.length && c.importance >= 0.3) {
    return { alert: true, urgent: false, reasons: [`In your network: ${people[0].name} at ${people[0].company}`], people, why: "network" };
  }
  const fit = deskAffinity(ctx.desk, c.desks);
  const amount = amountIn(c.headline);
  if (a.bigDeals && c.category === "deals" && amount !== null && amount >= 1e9 && fit >= 0.45) {
    return { alert: true, urgent: false, reasons: ["A $1B+ deal for your desk"], people: [], why: "deal" };
  }
  if (a.filings && filing && filing.weight >= 0.75 && fit >= 0.55) {
    return { alert: true, urgent: urgentFiling, reasons: ["A significant filing for your desk"], people: [], why: "filing" };
  }
  if (fit >= 0.55 && c.importance >= a.threshold) return { alert: true, urgent: false, reasons: ["A top story for your desk"], people: [], why: "desk" };
  return none;
}

/** Profiles that have finished onboarding: everyone who can get alerts and briefs. */
export async function newsUsers(): Promise<string[]> {
  const rows = await requireDb().select({ userId: schema.profiles.userId }).from(schema.profiles).where(isNotNull(schema.profiles.completedAt));
  return rows.map((r) => r.userId);
}

export async function deliverAlert(ctx: ReaderContext, n: { key: string; title: string; body: string; url: string; urgent: boolean; reasons: string[] }, origin: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const quiet = inQuietHours(new Date(), ctx.prefs) && !n.urgent;
  const ch = ctx.prefs.alerts.channels;
  const attempt = async (name: string, f: () => Promise<unknown>) => { try { const r = await f(); out[name] = typeof r === "number" && r === 0 ? "no device" : new Date().toISOString(); } catch (e) { out[name] = `error: ${failureMessage(e, `news-alert-${name}`).slice(0, 160)}`; } };
  if (ch.includes("push") && !quiet) await attempt("push", () => pushToUser(ctx.userId, { title: n.title, body: n.body.slice(0, 180), url: n.url, tag: n.key, urgent: n.urgent }));
  if (ch.includes("slack") && ctx.prefs.slack && !quiet) await attempt("slack", () => slackPost(ctx.prefs.slack!, `${n.urgent ? ":rotating_light: " : ""}*${n.title}*\n${n.reasons.join(" · ")}\n${n.body.slice(0, 300)}\n<${origin}${n.url}|Open in YouBank>`));
  if (ch.includes("email") && n.urgent) await attempt("email", () => emailSelf(ctx.userId, origin, alertEmail(n, origin)));
  return out;
}

/** One pass for one person: new stories since their cursor, decided, stored, delivered. */
export async function alertsFor(userId: string, origin: string, now = new Date()): Promise<number> {
  const ctx = await readerFor(userId);
  if (!ctx?.prefs.alerts.enabled) return 0;
  const key = `news:alert-cursor:${userId}`;
  const cursor = Number(await cacheGet(key)) || now.getTime() - 3 * 3_600_000;
  const fresh = (await recentClusters(Math.max(1, (now.getTime() - cursor) / 3_600_000 + 0.1), 400, 0.25)).filter((c) => c.updatedAt.getTime() > cursor).sort((a, b) => b.importance - a.importance);
  const items = await itemsOf(fresh.filter((c) => c.kinds.includes("filing")).map((c) => c.id));
  let sent = 0;
  const db = requireDb();
  for (const c of fresh) {
    if (sent >= 5) break;
    const f = items.find((i) => i.clusterId === c.id && i.kind === "filing");
    const filing = f ? { weight: Number(f.meta.weight ?? 0), items: (f.meta.items as string[] | undefined) ?? [], form: String(f.meta.form ?? "") } : null;
    const d = decideAlert(ctx, c, filing);
    if (!d.alert) continue;
    const body = c.summary?.bullets?.join(" ") || items.find((i) => i.clusterId === c.id)?.snippet || "";
    const [row] = await db.insert(schema.newsNotifications).values({
      userId, key: `alert:${c.id}`, kind: "alert", title: c.headline.slice(0, 300), body: body.slice(0, 600), url: `/app/news/story/${c.id}`, clusterId: c.id, urgent: d.urgent,
    }).onConflictDoNothing().returning();
    if (!row) continue;
    sent++;
    if (d.why === "network" && d.people.length) await noteNewsForNetwork(userId, c, d.people, f?.url ?? `${origin}/app/news/story/${c.id}`).catch(() => 0);
    const delivered = await deliverAlert(ctx, { key: row.key, title: row.title, body: row.body, url: row.url, urgent: row.urgent, reasons: d.reasons }, origin);
    if (Object.keys(delivered).length) await db.update(schema.newsNotifications).set({ delivered }).where(and(eq(schema.newsNotifications.id, row.id), eq(schema.newsNotifications.userId, userId)));
  }
  const newest = fresh.reduce((m, c) => Math.max(m, c.updatedAt.getTime()), cursor);
  await cacheSet(key, String(newest), 30 * 86_400_000);
  return sent;
}
