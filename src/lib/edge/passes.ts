/**
 * Edge's frequent passes and how fresh they are. Flaring is read every hour (the job runner's hourly
 * tick), again when someone opens Edge and the last pass is more than an hour old, and in full by the
 * daily cron; public records (reactor status, recalls) ride the same hourly tick. Each pass runs under a
 * lease so two instances never run it at once, and records when it ran in `edge_job_state`, which the
 * feed shows ("Flaring checked 12 minutes ago"). Vercel Hobby allows only daily crons, so nothing here
 * depends on a sub-daily cron: without the job runner, the page-open refresh keeps flaring within the hour
 * while anyone uses Edge.
 */
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";
import { lease } from "@/lib/locks";
import { forgetMemo, memo } from "@/lib/memo";
import { scanDealImpacts } from "./dealimpact";
import { scanFlares, type FlareScan } from "./flares";
import { notifyWatchers } from "./notify";
import { scanRecords, type RecordsScan } from "./records/scan";

const MINUTE = 60_000;
/** A quick pass is due when the last one is older than this (the hourly tick lands just after it). */
export const FLARE_EVERY_MS = 55 * MINUTE;
/** The page-open refresh waits until the last pass is an hour old. */
export const OPEN_REFRESH_MS = 60 * MINUTE;
export const RECORDS_EVERY_MS = 55 * MINUTE;

export type PassBy = "hourly" | "open" | "daily";
export type PassState = { at: string; by: PassBy; ok: boolean; /** When it last succeeded (the feed shows this, never a failed try). */ okAt?: string | null; mode?: string; newestSpot?: string | null; flaring?: number; created?: number; updated?: number; note?: string };

/** Whether a pass is due: never run, last run failed more than ten minutes ago, or older than `everyMs`. Pure. */
export function passDue(state: Pick<PassState, "at" | "ok"> | null | undefined, now: number, everyMs: number): boolean {
  if (!state?.at) return true;
  const age = now - Date.parse(state.at);
  if (!Number.isFinite(age)) return true;
  if (!state.ok) return age > 10 * MINUTE;
  return age >= everyMs;
}

export async function readPass(name: string): Promise<PassState | null> {
  const [r] = await requireDb().select().from(schema.edgeJobState).where(eq(schema.edgeJobState.name, name));
  return (r?.state as PassState | undefined) ?? null;
}

async function writePass(name: string, state: PassState) {
  await requireDb().insert(schema.edgeJobState).values({ name, state }).onConflictDoUpdate({ target: schema.edgeJobState.name, set: { state, updatedAt: new Date() } });
  forgetMemo(`edge:pass:${name}`);
}

/** A pass's state, shared for a minute (the feed asks on every poll). Null when the database does not answer. */
export const passState = (name: string) => memo(`edge:pass:${name}`, MINUTE, () => readPass(name)).catch(() => null);

export const FLARE_PASS = "edge.flares.pass";
export const RECORDS_PASS = "edge.records.pass";

type Skipped = { skipped: "fresh" | "running" };

/**
 * One flare pass. `daily` reads the seven-day files and always runs; `hourly` and `open` read the 24-hour
 * files and run only when the last pass is old enough. New cards alert their watchers and are checked
 * against pending deals.
 */
export async function runFlarePass(by: PassBy, deadline: number): Promise<(FlareScan & { alerts: unknown; deals: number }) | Skipped> {
  const every = by === "open" ? OPEN_REFRESH_MS : FLARE_EVERY_MS;
  if (by !== "daily" && !passDue(await readPass(FLARE_PASS).catch(() => null), Date.now(), every)) return { skipped: "fresh" };
  const release = await lease("edge:flares:pass", 5 * MINUTE);
  if (!release) return { skipped: "running" };
  try {
    const prev = await readPass(FLARE_PASS).catch(() => null);
    const r = await scanFlares(deadline, { mode: by === "daily" ? "full" : "quick" });
    const at = new Date().toISOString();
    // No mapped plants (the EIA maps not read yet, or unreachable) means nothing was checked: never say it was.
    if (!r.plants) {
      await writePass(FLARE_PASS, { at, by, ok: false, okAt: lastOk(prev), note: "No plants are mapped yet" });
      return { ...r, alerts: null, deals: 0 };
    }
    await writePass(FLARE_PASS, { at, by, ok: true, okAt: at, mode: r.mode, newestSpot: r.newestSpot, flaring: r.flaring, created: r.created.length, updated: r.updated });
    const alerts = r.created.length ? await notifyWatchers(r.created).catch((e) => { logError(e, { where: "edge-flare-pass-notify" }); return null; }) : null;
    const deals = r.created.length || r.updated ? await scanDealImpacts(Math.min(deadline, Date.now() + 20_000), { ids: r.created }).then((x) => x.created.length).catch((e) => { logError(e, { where: "edge-flare-pass-deals" }); return 0; }) : 0;
    return { ...r, alerts, deals };
  } catch (e) {
    const prev = await readPass(FLARE_PASS).catch(() => null);
    await writePass(FLARE_PASS, { at: new Date().toISOString(), by, ok: false, okAt: lastOk(prev), newestSpot: prev?.newestSpot ?? null, note: "NASA FIRMS did not answer" }).catch(() => undefined);
    throw e;
  } finally {
    await release();
  }
}

/** When a pass last succeeded, carried through failed tries. Pure. */
export const lastOk = (prev: PassState | null | undefined): string | null => prev?.okAt ?? (prev?.ok ? prev.at : null);

/** One pass over the public records (reactor status, recalls), when due; new cards alert and are checked against deals. */
export async function runRecordsPass(by: PassBy, deadline: number): Promise<(RecordsScan & { alerts: unknown; deals: number }) | Skipped> {
  if (by !== "daily" && !passDue(await readPass(RECORDS_PASS).catch(() => null), Date.now(), RECORDS_EVERY_MS)) return { skipped: "fresh" };
  const release = await lease("edge:records:pass", 5 * MINUTE);
  if (!release) return { skipped: "running" };
  try {
    const r = await scanRecords(deadline);
    await writePass(RECORDS_PASS, { at: new Date().toISOString(), by, ok: true, created: r.created.length, updated: r.updated, note: r.notes.join("; ").slice(0, 300) });
    const alerts = r.created.length ? await notifyWatchers(r.created).catch((e) => { logError(e, { where: "edge-records-pass-notify" }); return null; }) : null;
    const deals = r.created.length ? await scanDealImpacts(Math.min(deadline, Date.now() + 20_000), { ids: r.created }).then((x) => x.created.length).catch((e) => { logError(e, { where: "edge-records-pass-deals" }); return 0; }) : 0;
    return { ...r, alerts, deals };
  } finally {
    await release();
  }
}

/**
 * When someone opens Edge (the page, a feed poll): if flaring was last read more than an hour ago, read it
 * again after the response. Never blocks the page and never throws; the lease keeps it to one at a time.
 */
export async function refreshIfStale(budgetMs = 45_000): Promise<void> {
  try {
    const s = await passState(FLARE_PASS);
    if (!passDue(s, Date.now(), OPEN_REFRESH_MS)) return;
    await runFlarePass("open", Date.now() + budgetMs);
  } catch (e) {
    logError(e, { where: "edge-flares-open-refresh" });
  }
}

/** How fresh flaring is, for the feed: when it was last read and the newest detection in it. */
export async function flareFreshness(): Promise<{ checkedAt: string | null; newestSpot: string | null; ok: boolean }> {
  const s = await passState(FLARE_PASS);
  // "Checked" is the last read that worked; a failed try since then is reported as such, not as a check.
  return { checkedAt: lastOk(s), newestSpot: s?.newestSpot ?? null, ok: s?.ok ?? true };
}
