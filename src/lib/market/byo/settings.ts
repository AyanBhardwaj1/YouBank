/**
 * Settings → Data sources, server side (/api/settings/data-sources): the page's view of a person's
 * sources per dataset (in their order, with licence badges and why a source cannot answer), their keys
 * (last four characters and plan only), input validation, and the two tests: a key, and a dataset's
 * chain with one canonical sample. Server only. Every function is for the signed-in person only: the
 * route passes their id, never one from the request.
 */
import { z } from "zod";
import { isPendingMigration, publicMessage } from "@/lib/errors";
import { isNetworkError } from "@/lib/net";
import { myTeamIds } from "@/lib/teams/db";
import { withMode } from "../budgets";
import { withProvenance } from "../provenance";
import { adaptersOf, eligibility, fromChain, REGISTRY, type DatasetId } from "../registry";
import { sourcesBody } from "../source-header";
import {
  DATASETS, isDatasetName, KEY_PROVIDER_INFO, KEY_PROVIDERS, LICENCE_LABEL, planWarning, PLAN_TYPES, SOURCES,
  type DatasetName, type KeyProvider, type Licence, type PlanType, type SourceId,
} from "../sources-meta";
import { needsYourKey, withDataUser } from "../user-context";
import { KEY_TESTS } from "./adapters";
import { dataUserFor, loadSettings, type KeyMeta, type Settings } from "./store";

export type SourceRow = {
  id: SourceId; label: string; licence: Licence; licenceLabel: string; attribution: string; freshness: string; delayedMinutes: number | null;
  fields: string[]; needsKey?: KeyProvider; eligible: boolean; reason?: string; isDefault: boolean;
};
export type DatasetView = { id: DatasetName; label: string; commands: string[]; configurable: boolean; noFreeSource?: string; customized: boolean; sources: SourceRow[] };
export type KeyView = { provider: KeyProvider; label: string; last4: string; plan: PlanType; addedAt: string; lastTest?: KeyMeta["lastTest"]; warning: string | null };
export type SettingsView = {
  datasets: DatasetView[]; keys: KeyView[]; inTeam: boolean;
  /** The settings table (drizzle/0029) is not on this deployment yet: the defaults are shown read-only. */
  setupPending?: boolean;
  providers: { id: KeyProvider; label: string; signup: string; individualIsPersonalOnly: boolean }[];
};

/** Whether a source can answer for this person on a screen they open (their keys; the server's switches). */
function rowEligibility(a: Parameters<typeof eligibility>[0], keyed: ReadonlySet<KeyProvider>): { eligible: boolean; reason?: string } {
  if (a.licence === "user-key") return a.keyProvider && keyed.has(a.keyProvider) ? { eligible: true } : { eligible: false, reason: needsYourKey(a.keyProvider!) };
  const e = eligibility(a);
  return e.ok ? { eligible: true } : { eligible: false, reason: e.reason };
}

/** One dataset's sources in the person's order (their list, then the default chain, then every keyed source). */
export function datasetView(d: DatasetName, s: Settings): DatasetView {
  const all = adaptersOf(d as DatasetId).filter((a) => !a.staged || !DATASETS[d].configurable);
  const defaults = new Set<string>(REGISTRY[d as DatasetId].map((a) => a.id));
  const mine = (s.order[d] ?? []).map((id) => all.find((a) => a.id === id)).filter((a): a is (typeof all)[number] => !!a);
  const ordered = [...new Set([...mine, ...all.filter((a) => defaults.has(a.id)), ...all])];
  const keyed = new Set(Object.keys(s.keyMeta) as KeyProvider[]);
  const sources = ordered.map((a): SourceRow => ({
    id: a.id, label: a.label, licence: a.licence, licenceLabel: LICENCE_LABEL[a.licence], attribution: a.attribution, freshness: SOURCES[a.id].freshness,
    delayedMinutes: a.delayedMinutes, fields: a.fields, ...(a.keyProvider ? { needsKey: a.keyProvider } : {}), ...rowEligibility(a, keyed), isDefault: defaults.has(a.id),
  }));
  const info = DATASETS[d];
  return { id: d, label: info.label, commands: info.commands, configurable: info.configurable, ...(info.noFreeSource ? { noFreeSource: info.noFreeSource } : {}), customized: !!s.order[d]?.length, sources };
}

/** A person's settings, or null when the table is not there yet (a deployment before migration 0029). */
const settingsOrPending = (userId: string): Promise<Settings | null> =>
  loadSettings(userId).catch((e: unknown) => { if (isPendingMigration(e)) return null; throw e; });

const NO_SETTINGS: Settings = { order: {}, keyMeta: {} };

export async function settingsView(userId: string): Promise<SettingsView> {
  const [stored, teams] = await Promise.all([settingsOrPending(userId), myTeamIds(userId).catch(() => [] as number[])]);
  const s = stored ?? NO_SETTINGS;
  const inTeam = teams.length > 0;
  const datasets = (Object.keys(REGISTRY) as DatasetName[]).filter((d) => isDatasetName(d)).map((d) => datasetView(d, s));
  const keys = (Object.entries(s.keyMeta) as [KeyProvider, KeyMeta][]).map(([p, m]) => ({ provider: p, label: KEY_PROVIDER_INFO[p].label, last4: m.last4, plan: m.plan, addedAt: m.addedAt, ...(m.lastTest ? { lastTest: m.lastTest } : {}), warning: planWarning(p, m.plan, inTeam) }));
  const providers = KEY_PROVIDERS.map((p) => ({ id: p, label: KEY_PROVIDER_INFO[p].label, signup: KEY_PROVIDER_INFO[p].signup, individualIsPersonalOnly: KEY_PROVIDER_INFO[p].individualIsPersonalOnly }));
  return { datasets, keys, inTeam, providers, ...(stored ? {} : { setupPending: true }) };
}

/* ---------------- Input ---------------- */

const MAX_IDS = 30;
export const PutBody = z.object({ order: z.record(z.string().max(40), z.array(z.string().max(40)).max(MAX_IDS)) }).strict();
const KeyText = z.string().trim().min(8).max(128);
export const PostBody = z.discriminatedUnion("action", [
  z.object({ action: z.literal("test-key"), provider: z.enum(KEY_PROVIDERS), key: KeyText.optional() }).strict(),
  z.object({ action: z.literal("save-key"), provider: z.enum(KEY_PROVIDERS), key: KeyText, plan: z.enum(PLAN_TYPES as [PlanType, ...PlanType[]]) }).strict(),
  z.object({ action: z.literal("test-chain"), dataset: z.string().max(40) }).strict(),
]);

const bad = (message: string) => Object.assign(new Error(message), { status: 400 });

/** A PUT's order, checked against the registry: configurable datasets and their own sources only. Throws a 400 with the reason. */
export function validateOrder(body: unknown): Settings["order"] {
  const parsed = PutBody.safeParse(body);
  if (!parsed.success) throw bad("That settings change was not in the expected shape. Reload the page and try again.");
  const out: Settings["order"] = {};
  for (const [d, ids] of Object.entries(parsed.data.order)) {
    if (!isDatasetName(d) || !DATASETS[d].configurable) throw bad(`"${d}" is not a dataset whose sources can be chosen.`);
    const known = new Set<string>(adaptersOf(d as DatasetId).filter((a) => a.fetch).map((a) => a.id));
    const unknown = ids.find((id) => !known.has(id));
    if (unknown) throw bad(`"${unknown}" is not a source for ${DATASETS[d].label.toLowerCase()}.`);
    out[d] = [...new Set(ids)] as SourceId[];
  }
  return out;
}

/** A key's shape before it is sent anywhere (an allowlist of characters and lengths, not a secret check). */
export function checkKeyShape(provider: KeyProvider, key: string): void {
  if (!KEY_PROVIDER_INFO[provider].shape.test(key)) throw bad(`That does not look like a ${KEY_PROVIDER_INFO[provider].label} key. Paste it exactly as the provider shows it.`);
}

/* ---------------- Tests ---------------- */

/** One cheap call with a key: whether it works, how long it took, and the provider's words if not. Never echoes the key. */
export async function testKey(provider: KeyProvider, key: string): Promise<{ ok: boolean; ms: number; message?: string }> {
  const t0 = performance.now();
  try {
    const ok = await withMode("interactive", () => KEY_TESTS[provider](key));
    return { ok, ms: Math.round(performance.now() - t0), ...(ok ? {} : { message: `${KEY_PROVIDER_INFO[provider].label} answered, but with no data for the test symbol.` }) };
  } catch (e) {
    const status = (e as { status?: number }).status;
    const message = !isNetworkError(e) && status && status < 500 ? publicMessage(e) : `${KEY_PROVIDER_INFO[provider].label} could not be reached. Try again in a moment.`;
    return { ok: false, ms: Math.round(performance.now() - t0), message };
  }
}

const SAMPLE_FROM_DAYS = 30;
/** One canonical sample per testable dataset. */
export function sampleArgs(d: DatasetName, now = Date.now()): unknown {
  const from = new Date(now - SAMPLE_FROM_DAYS * 86_400_000).toISOString().slice(0, 10);
  const samples: Partial<Record<DatasetName, unknown>> = {
    "daily-bars": { symbol: "AAPL", from }, quote: { symbol: "AAPL" }, profile: { symbol: "AAPL" }, earnings: { symbol: "AAPL" }, analysts: { symbol: "AAPL" }, dividends: { symbol: "AAPL" },
    fx: { symbol: "EURUSD", from }, commodity: { symbol: "CLUSD", from }, crypto: { symbol: "BTCUSD", from }, curve: {}, macro: { series: "CPIAUCSL" }, deals: {}, movers: {}, sectors: {}, cot: {},
  };
  return samples[d];
}

export type ChainTest = { ok: boolean; ms: number; answeredBy?: { id: string; label: string; yourKey?: boolean }; message?: string; header: ReturnType<typeof sourcesBody> };

/** The person's chain for a dataset on its sample, as a screen would run it: which source answered, how long it took, what was skipped and why. */
export async function testChain(userId: string, dataset: string): Promise<ChainTest> {
  if (!isDatasetName(dataset) || sampleArgs(dataset) === undefined) throw bad("That dataset cannot be tested.");
  // Before migration 0029 there are no settings: the public chain runs, as every screen does then.
  const u = await dataUserFor(userId).catch((e: unknown) => { if (isPendingMigration(e)) return null; throw e; });
  const t0 = performance.now();
  const chain = () => withMode("interactive", async () => {
    try { return { a: await fromChain(dataset as "quote", sampleArgs(dataset) as { symbol: string }) }; } catch (e) { return { e }; }
  });
  const run = await withProvenance(() => (u ? withDataUser(u, chain) : chain()));
  const ms = Math.round(performance.now() - t0), header = sourcesBody(run);
  if ("a" in run.value && run.value.a) return { ok: true, ms, answeredBy: { id: run.value.a.by.id, label: run.value.a.by.label, ...(run.value.a.by.yourKey ? { yourKey: true } : {}) }, header };
  const e = "e" in run.value ? run.value.e : null;
  return { ok: false, ms, message: e ? publicMessage(e) : "No source answered.", header };
}
