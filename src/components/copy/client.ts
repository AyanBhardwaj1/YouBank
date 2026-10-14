"use client";

/** Shared helpers for the copy-trading screens: formatting, API calls and the consent step. */
import { ApiError, fetchJson } from "@/lib/client/errors";

export const usd = (v: number | null | undefined, compact = true) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  if (!compact) return v.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: v >= 100 ? 0 : 2 });
  const a = Math.abs(v);
  const s = a >= 1e12 ? `${(a / 1e12).toFixed(2)}T` : a >= 1e9 ? `${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(1)}K` : a.toFixed(0);
  return `${v < 0 ? "−" : ""}$${s}`;
};
export const pct = (v: number | null | undefined, dp = 1, sign = false) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : `${sign && v > 0 ? "+" : ""}${(v * 100).toFixed(dp)}%`);
export const num = (v: number | null | undefined, dp = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v.toLocaleString("en-US", { maximumFractionDigits: dp }));
export const shortCik = (cik: string) => String(Number(cik));

export const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

/** An API call; a 428 means a consent is missing, and `onConsent` is asked for it before one retry. */
export async function call<T>(url: string, init: RequestInit | undefined, onConsent: (kind: "terms" | "trading") => Promise<boolean>): Promise<T> {
  try {
    return await fetchJson<T>(url, init);
  } catch (e) {
    if (e instanceof ApiError && e.status === 428) {
      const kind = /real orders/i.test(e.message) ? "trading" : "terms";
      if (await onConsent(kind)) return fetchJson<T>(url, init);
    }
    throw e;
  }
}

/** A fresh key per review screen, so a double tap or a retry of the same approval sends nothing twice. */
export const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `k-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

export type ConsentTexts = Record<"terms" | "trading", { version: string; title: string; points: readonly string[] }>;
