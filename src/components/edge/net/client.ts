"use client";

/** Networks' client shapes and colours (one colour per kind of node and link, shared by every view). */
import type { Flag } from "@/lib/edge/graph/algo";
import type { GEdge, GNode, Intro, Owner, Owners, Prediction, Step, TreeNode } from "@/lib/edge/graph/findings";
import type { ModelMetrics } from "@/lib/edge/graph/train";

export type { Flag, GEdge, GNode, Intro, Owner, Owners, Prediction, Step, TreeNode };

export type Missing = { missing: true; ticker: string; name: string; listed: boolean };
export type CompanyView = {
  node: GNode; industry: string; place: string; revenue: number | null; assets: number | null;
  counts: { directors: number; officers: number; holders: number; stakes: number; subsidiaries: number; customers: number; suppliers: number; deals: number };
  deals: GEdge[]; refreshed: Record<string, string>; flags: Flag[];
  metrics?: {
    pct: number | null;
    community: { id: number; size: number; label: string; top: { id: number; name: string; ticker: string }[] } | null;
    brokers: { id: number; name: string; communities: number; companies: number; at: { id: number; name: string; ticker: string }[] }[];
  } | null;
};
export type Picks = { items: Prediction[]; scorecard: string; version: string | null; trainedAt: string | null; metrics: ModelMetrics | null; graph: { nodes: GNode[]; links: GEdge[] } };
export type Sub = { nodes: GNode[]; links: GEdge[] };
export type MapData = Sub & { plants: { ticker: string; name: string; lon: number; lat: number }[] };
export type Tree = { root: GNode; up: TreeNode[]; down: TreeNode[] };
export type Exposure = { items: { node: GNode; score: number; via: Step[] }[] };
export type Intros = { items: Intro[]; pooled: boolean };
export type Status = { size: { nodes: number; links: number; companies: number }; latest: { status: string; version: string; trainedAt: string; error: string | null } | null; model: { version: string; trainedAt: string; acquirers: string; targets: string } | null };

export const NODE_COLOR: Record<string, string> = { company: "#5B8DEF", person: "#46B3C9", fund: "#C77DDB", subsidiary: "#8b93a1", firm: "#E3B341" };
export const LINK_COLOR: Record<string, string> = { director: "#46B3C9", officer: "#46B3C9", insider: "#46B3C9", holder: "#C77DDB", subsidiary: "#8b93a1", acquired: "#E0795A", bought_assets: "#D98E4A", supplies: "#4FB286", advised: "#E3B341" };
export const KIND_LABEL: Record<string, string> = { company: "Company", person: "Person", fund: "Fund or firm holding stakes", subsidiary: "Subsidiary or joint venture", firm: "Adviser" };
export const LINK_LABEL: Record<string, string> = { director: "Director", officer: "Officer", insider: "Insider", holder: "Owns a stake", subsidiary: "Subsidiary", acquired: "Acquired", bought_assets: "Bought assets", supplies: "Supplies", advised: "Advised" };

export const fmtUsd = (v: number | null) => (v === null ? "" : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round(v).toLocaleString("en-US")}`);
