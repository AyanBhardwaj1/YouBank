/**
 * The browser's side of Settings → Data sources (/api/settings/data-sources): the person's sources per
 * dataset and their keys (last four characters only), loaded once and shared by the settings page and
 * every terminal panel's "Source ▾" chip. A change through these helpers refreshes the shared copy.
 */
import { fetchJson } from "@/lib/client/errors";
import type { ChainTest, SettingsView } from "@/lib/market/byo/settings";
import type { KeyProvider, PlanType } from "@/lib/market/sources-meta";

const URL = "/api/settings/data-sources";
/** The view is reused for a minute across panels, then read again. */
const FRESH_MS = 60_000;
let cached: { at: number; p: Promise<SettingsView> } | null = null;
const listeners = new Set<(v: SettingsView) => void>();

const publish = (v: SettingsView) => { cached = { at: Date.now(), p: Promise.resolve(v) }; listeners.forEach((l) => l(v)); return v; };

/** The person's data-source settings (shared, cached a minute). */
export function loadDataSources(force = false): Promise<SettingsView> {
  if (!force && cached && Date.now() - cached.at < FRESH_MS) return cached.p;
  const p = fetchJson<SettingsView>(URL);
  cached = { at: Date.now(), p };
  p.then(publish, () => { cached = null; });
  return p;
}

/** Hear about changes made anywhere on the page (a new key, a new order). */
export function onDataSources(l: (v: SettingsView) => void): () => void {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

const send = (method: string, body: unknown) => fetchJson<unknown>(URL, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export async function saveOrder(order: Record<string, string[]>): Promise<SettingsView> {
  return publish((await send("PUT", { order })) as SettingsView);
}

export async function saveKey(provider: KeyProvider, key: string, plan: PlanType): Promise<{ test: { ok: boolean; ms: number }; settings: SettingsView }> {
  const r = (await send("POST", { action: "save-key", provider, key, plan })) as { test: { ok: boolean; ms: number }; settings: SettingsView };
  publish(r.settings);
  return r;
}

export const testSavedKey = (provider: KeyProvider) => send("POST", { action: "test-key", provider }) as Promise<{ ok: boolean; ms: number; message?: string }>;
export const testChain = (dataset: string) => send("POST", { action: "test-chain", dataset }) as Promise<ChainTest>;

export async function removeKey(provider: KeyProvider): Promise<SettingsView> {
  const r = await fetchJson<{ settings: SettingsView }>(`${URL}?provider=${encodeURIComponent(provider)}`, { method: "DELETE" });
  return publish(r.settings);
}
