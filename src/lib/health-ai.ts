/**
 * The AI and API-key part of /api/health: is AI set up, are the keys the app holds actually accepted by
 * their services, and how fast is AI money being spent against the daily cap.
 *
 * - Spend comes from the running daily totals (ai_spend, src/lib/ai/spend.ts) and the ledger (ai_usage):
 *   today so far, each of the last seven days, the busiest features in the last 24 hours, the average burn
 *   per day and the month it projects to.
 * - Key checks call each service's free, read-only endpoint (a model list, an account balance, one quote)
 *   with the key, and report only whether it was accepted (never the key, never the body). They run only
 *   for an operator who asks (`?probe=keys`), at most once every five minutes per instance.
 *
 * The verdict is pure (aiVerdict) so scripts/test-prod.ts can check it.
 */
import { sql } from "drizzle-orm";
import { requireDb } from "@/db";
import { readSpend } from "@/lib/ai/spend";
import { aiDisabled, globalDailyUsd } from "@/lib/ai/limits";
import { availableProviders } from "@/lib/ai/config";
import { logError } from "@/lib/errors";

export type KeyCheck = { service: string; ok: boolean; status: "accepted" | "rejected" | "unreachable" | "not set" };
export type AiSpend = { todayUsd: number; days: { day: string; usd: number }[]; topFeatures: { feature: string; usd: number; calls: number }[] };

/** Whether AI is healthy, and what to look at. Pure. */
export function aiVerdict(i: { providers: string[]; disabled: boolean; spend: AiSpend | null; capUsd: number; keys?: KeyCheck[] }) {
  const notes: string[] = [];
  if (i.disabled) notes.push("AI_DISABLED is on: every AI feature says AI is paused.");
  if (!i.providers.length) notes.push("No OpenAI or Anthropic key is set: AI features say AI is not set up.");
  const rejected = (i.keys ?? []).filter((k) => k.status === "rejected");
  for (const k of rejected) notes.push(`${k.service} rejected its key: replace it in Vercel and redeploy.`);
  const days = i.spend?.days ?? [];
  // The average over the full days in the window (today is partial).
  const full = days.filter((d) => d.day !== new Date().toISOString().slice(0, 10));
  const burnPerDay = full.length ? full.reduce((t, d) => t + d.usd, 0) / full.length : 0;
  const capUsedPct = i.spend && i.capUsd > 0 ? Math.round((i.spend.todayUsd / i.capUsd) * 1000) / 10 : null;
  if (capUsedPct !== null && capUsedPct >= 80) notes.push(`Today's AI spend is ${capUsedPct}% of the everyone-wide daily cap (AI_GLOBAL_DAILY_USD); at 100% AI pauses until midnight UTC.`);
  const ok = !i.disabled && i.providers.length > 0 && !rejected.length && (capUsedPct === null || capUsedPct < 100);
  return {
    ok,
    status: !i.providers.length || i.disabled ? ("off" as const) : ok && !notes.length ? ("ok" as const) : ("warn" as const),
    providers: i.providers,
    spend: i.spend ? {
      todayUsd: round2(i.spend.todayUsd), capUsd: i.capUsd, capUsedPct,
      burnPerDayUsd: round2(burnPerDay), projectedMonthUsd: round2(burnPerDay * 30),
      days: i.spend.days.map((d) => ({ day: d.day, usd: round2(d.usd) })), topFeatures: i.spend.topFeatures.map((f) => ({ ...f, usd: round2(f.usd) })),
    } : null,
    ...(i.keys ? { keys: i.keys } : {}),
    notes,
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Today's total, the last seven days and the busiest features over 24 hours. Null when the tables cannot be read. */
export async function aiSpend(now = new Date()): Promise<AiSpend | null> {
  try {
    const db = requireDb();
    const since = new Date(now.getTime() - 7 * 86_400_000);
    const dayRows = await db.execute(sql`select to_char(created_at at time zone 'UTC', 'YYYY-MM-DD') as day, coalesce(sum(cost_usd), 0)::float8 as usd
      from ai_usage where created_at >= ${since.toISOString()}::timestamptz group by 1 order by 1`);
    const featureRows = await db.execute(sql`select feature, coalesce(sum(cost_usd), 0)::float8 as usd, count(*)::int as calls
      from ai_usage where created_at >= ${new Date(now.getTime() - 86_400_000).toISOString()}::timestamptz group by feature order by usd desc limit 8`);
    const today = await readSpend(null, now).then((t) => t.everyone).catch(() => 0);
    const days = (dayRows.rows as { day: string; usd: number }[]).map((r) => ({ day: r.day, usd: Number(r.usd) || 0 }));
    const ledgerToday = days.find((d) => d.day === now.toISOString().slice(0, 10))?.usd ?? 0;
    return {
      // The running total and the ledger can each lag; the larger is the honest figure.
      todayUsd: Math.max(today, ledgerToday),
      days,
      topFeatures: (featureRows.rows as { feature: string; usd: number; calls: number }[]).map((r) => ({ feature: r.feature, usd: Number(r.usd) || 0, calls: Number(r.calls) || 0 })),
    };
  } catch (e) {
    logError(e, { where: "health-ai-spend" });
    return null;
  }
}

type Probe = { service: string; key: string | undefined; url: (k: string) => string; headers: (k: string) => Record<string, string> };

/** The free, read-only endpoint each service answers with its key. */
const probesFor = (env: Record<string, string | undefined>): Probe[] => [
  { service: "OpenAI", key: env.OPENAI_API_KEY, url: () => "https://api.openai.com/v1/models", headers: (k) => ({ authorization: `Bearer ${k}` }) },
  { service: "Anthropic", key: env.ANTHROPIC_API_KEY, url: () => "https://api.anthropic.com/v1/models?limit=1", headers: (k) => ({ "x-api-key": k, "anthropic-version": "2023-06-01" }) },
  { service: "Stripe", key: env.STRIPE_SECRET_KEY, url: () => "https://api.stripe.com/v1/balance", headers: (k) => ({ authorization: `Bearer ${k}` }) },
  { service: "FMP", key: env.FMP_API_KEY, url: (k) => `https://financialmodelingprep.com/stable/quote-short?symbol=AAPL&apikey=${encodeURIComponent(k)}`, headers: () => ({}) },
];

/** How a probe's HTTP status reads: 2xx accepted, 401/403 rejected, anything else (or no answer) unreachable. Pure. */
export const readProbe = (status: number | null): KeyCheck["status"] => (status === null ? "unreachable" : status >= 200 && status < 300 ? "accepted" : status === 401 || status === 403 ? "rejected" : "unreachable");

let lastKeys: { at: number; checks: KeyCheck[] } | null = null;

/** Each key the app holds, tried against its service's free read-only endpoint. Cached five minutes. */
export async function checkKeys(env: Record<string, string | undefined> = process.env): Promise<KeyCheck[]> {
  if (lastKeys && Date.now() - lastKeys.at < 300_000) return lastKeys.checks;
  const checks = await Promise.all(probesFor(env).map(async (p): Promise<KeyCheck> => {
    const key = p.key?.trim();
    if (!key) return { service: p.service, ok: false, status: "not set" };
    const status = await fetch(p.url(key), { headers: p.headers(key), signal: AbortSignal.timeout(6_000), cache: "no-store" }).then((r) => r.status, () => null);
    const s = readProbe(status);
    return { service: p.service, ok: s === "accepted", status: s };
  }));
  lastKeys = { at: Date.now(), checks };
  return checks;
}

/** Everything the health route needs about AI. */
export async function aiHealth(opts: { probeKeys: boolean }) {
  const [spend, keys] = await Promise.all([aiSpend(), opts.probeKeys ? checkKeys() : Promise.resolve(undefined)]);
  return aiVerdict({ providers: availableProviders(), disabled: aiDisabled(), spend, capUsd: globalDailyUsd(), keys });
}
