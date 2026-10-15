"use client";

/** Shared helpers for the Algo trading screens: formatting (copy trading's), API calls with the consent step, and types. */
import { ApiError, fetchJson } from "@/lib/client/errors";

export { json, newKey, num, pct, usd } from "@/components/copy/client";

/** An API call; a 428 means a consent is missing, and `onConsent` is asked for it before one retry. */
export async function call<T>(url: string, init: RequestInit | undefined, onConsent: (kind: "terms" | "live") => Promise<boolean>): Promise<T> {
  try {
    return await fetchJson<T>(url, init);
  } catch (e) {
    if (e instanceof ApiError && e.status === 428) {
      const kind = /real orders/i.test(e.message) ? "live" : "terms";
      if (await onConsent(kind)) return fetchJson<T>(url, init);
    }
    throw e;
  }
}

export type Unmet = { key: string; message: string };
export type Template = { id: string; name: string; blurb: string; how: string; risks: string; spec: Record<string, unknown> };
export type StrategyCard = { id: number; name: string; mode: string; status: string; kill: boolean; signal: string; universe: string[]; capitalUsd: number; assetClass: string; paperCash: number | null; peak: number | null; lastTickAt: string | null; nextTickAt: string | null; lastDecision: { at?: string; rationale?: string; trade?: boolean } | null };
export type Hub = {
  strategies: StrategyCard[];
  kill: { global: boolean; user: boolean; globalReason: string | null };
  consents: { terms: boolean; live: boolean; autonomous: boolean };
  consentTexts: Record<"terms" | "live" | "autonomous", { version: string; title: string; points: readonly string[] }>;
  notAdvice: string;
  plan: { live: boolean; agent: boolean; autonomous: boolean; more: boolean; cap: number };
  server: { liveEnabled: boolean; maxOrderUsd: number; maxDayUsd: number; minPaperDays: number; brokers: { encryption: boolean; alpacaOAuth: boolean; alpacaLiveKeys: boolean; webull: boolean; robinhoodCrypto: boolean; snaptrade: boolean } };
  templates: Template[];
};

export const MODE_LABEL: Record<string, string> = { backtest: "Backtest only", paper: "Paper", live_approval: "Live, with approval", live_auto: "Live, autonomous" };
export const MODE_TONE: Record<string, string> = { backtest: "text-muted border-line", paper: "text-accent border-accent/40", live_approval: "text-info border-info/40", live_auto: "text-neg border-neg/40" };
export const SIGNAL_LABEL: Record<string, string> = { trend: "Trend", momentum: "Momentum", meanReversion: "Mean reversion", pairs: "Pairs", rebalance: "Fixed mix / DCA", copy13f: "13F copy", income: "Options income", external: "Quant signals", target: "Quant target" };
export const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "–");
