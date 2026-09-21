"use client";

import { useEffect, useState } from "react";
import type { CompanyData } from "../types";

/** Client-side company store: one batch request per set of unseen tickers, shared across every panel. */
type Entry = { data?: CompanyData; error?: string };
const store = new Map<string, Entry>();
const inflight = new Set<string>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export function getCached(ticker: string): CompanyData | undefined {
  return store.get(ticker.toUpperCase())?.data;
}

async function loadBatch(tickers: string[]) {
  const need = tickers.filter((t) => !store.has(t) && !inflight.has(t));
  if (need.length === 0) return;
  need.forEach((t) => inflight.add(t));
  try {
    const res = await fetch(`/api/companies?tickers=${encodeURIComponent(need.join(","))}`);
    const json = (await res.json()) as Record<string, CompanyData | { error: string }>;
    for (const t of need) {
      const v = json[t];
      store.set(t, v && !("error" in v) ? { data: v } : { error: (v as { error?: string })?.error ?? "Unavailable" });
    }
  } catch (e) {
    for (const t of need) store.set(t, { error: e instanceof Error ? e.message : "Network error" });
  } finally {
    need.forEach((t) => inflight.delete(t));
    notify();
  }
}

export function refreshCompany(ticker: string) {
  store.delete(ticker.toUpperCase());
  void loadBatch([ticker.toUpperCase()]);
}

export function useCompanies(tickers: string[]) {
  const key = [...new Set(tickers.map((t) => t.toUpperCase()).filter(Boolean))].join(",");
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  useEffect(() => { if (key) void loadBatch(key.split(",")); }, [key]);

  const data: Record<string, CompanyData> = {};
  const errors: Record<string, string> = {};
  let loading = false;
  for (const t of key ? key.split(",") : []) {
    const e = store.get(t);
    if (!e) loading = true;
    else if (e.data) data[t] = e.data;
    else errors[t] = e.error ?? "Unavailable";
  }
  return { data, errors, loading };
}

export function useCompany(ticker: string | null) {
  const { data, errors, loading } = useCompanies(ticker ? [ticker] : []);
  const t = ticker?.toUpperCase() ?? "";
  return { data: t ? data[t] : undefined, error: t ? errors[t] : undefined, loading: t ? loading : false };
}
