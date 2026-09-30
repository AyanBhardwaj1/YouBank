"use client";

/**
 * Edge's client plumbing: the person's Edge state (beta, watches, limits, what can be watched), the
 * ranked feed, and small formatters. Fetching and polling reuse the Newsroom's helpers, which pause in
 * hidden tabs and back off on errors.
 */
import { useApi } from "@/components/news/client";
import type { Blend } from "@/lib/edge/access";
import type { EdgeCard, Scope } from "@/lib/edge/feed";
import type { Proforma } from "@/lib/edge/proforma";
import type { Bbox } from "@/lib/edge/sources/eia";
import type { Watch } from "@/lib/edge/watches";

export { api, ago, post, useApi, useNow } from "@/components/news/client";
export type { Blend, EdgeCard, Proforma, Scope, Watch, Bbox };

export type EdgeState = {
  beta: boolean; since: string | null; blend: Blend;
  limits: { watches: number; monitors: number };
  watches: Watch[];
  companies: { ticker: string; company: string; assets: number }[];
  places: { key: string; name: string; bbox: Bbox }[];
  covered: { key: string; name: string; bbox: Bbox }[];
};

export type FeedData = { cards: EdgeCard[]; counts: Record<Scope, number>; total: number; generatedAt: string };

export type GroundVisual = {
  type: "before_after";
  site: { name: string; kind: string; company: string; ticker: string; lon: number; lat: number };
  bbox: Bbox;
  before: { url: string; date: string; scene: string };
  after: { url: string; date: string; scene: string };
  overlay: string;
  stats: { clearedHa: number; darkenedHa: number; clearPct: number };
};

export type ProformaVisual = {
  type: "proforma";
  deal: { id: number; kind: string; headline: string; valueUsd: number | null; announcedAt: string; sourceUrl: string; status: string };
  parties: { label: string; tickers: string[]; companies: string[] }[];
  place: string;
  proforma: Pick<Proforma, "place" | "parties" | "combined" | "overlap" | "counties" | "divestitures">;
};

export type AssetFeature = {
  type: "Feature"; id: number;
  geometry: { type: string; coordinates: unknown };
  properties: { id: number; kind: string; name: string; operator: string; company: string; ticker: string; status: string; source: string; attrs: Record<string, unknown> };
};
export type AssetCollection = { type: "FeatureCollection"; features: AssetFeature[] };
export type Imagery = { tiles: string; minzoom: number; maxzoom: number; from: string; to: string; attribution: string };

export const useEdgeState = () => useApi<EdgeState>("/api/edge");

export const fmtNum = (v: number, dp = 0) => v.toLocaleString("en-US", { maximumFractionDigits: dp, minimumFractionDigits: dp });

export function confidenceLabel(c: number): { label: string; tone: "pos" | "accent" | "muted" } {
  if (c >= 0.7) return { label: "High confidence", tone: "pos" };
  if (c >= 0.4) return { label: "Medium confidence", tone: "accent" };
  return { label: "Low confidence", tone: "muted" };
}

export const MODULES = [
  { id: "earth", label: "Earth", tech: "GeoAI", icon: "Globe", live: true, blurb: "Satellite change at plants and pipelines, and deal maps" },
  { id: "documents", label: "Documents", tech: "RAG", icon: "FileSearch", live: false, blurb: "Cited answers across filings, calls and data rooms" },
  { id: "networks", label: "Networks", tech: "GNN", icon: "Network", live: false, blurb: "Ownership, boards, supply chains and deals as a graph" },
  { id: "scenarios", label: "Scenarios", tech: "Synthetic data", icon: "FlaskConical", live: false, blurb: "Simulated markets and company what-ifs, always labeled" },
] as const;

/** A party's colour for a map feature: by ticker, else by a company name inside its operator or parent. */
export function partyOf(f: Pick<AssetFeature["properties"], "ticker" | "company" | "operator">, parties: { key: string; color: string; tickers: string[]; companies: string[] }[]) {
  const name = `${f.company} ${f.operator}`.toLowerCase();
  return parties.find((p) => (f.ticker && p.tickers.includes(f.ticker)) || p.companies.some((c) => c && name.includes(c.toLowerCase())));
}
