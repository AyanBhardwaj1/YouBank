"use client";

import { useEffect, useState } from "react";
import type { PeerGroup, PeerMember } from "@/lib/static-data";

/* ---- current user (no auth yet: a name stored in the browser, sent as x-user) ---- */
export function getUser(): string {
  try { return localStorage.getItem("yb-user") || "analyst"; } catch { return "analyst"; }
}
export function setUser(name: string) {
  try { localStorage.setItem("yb-user", name.trim() || "analyst"); } catch { /* ignore */ }
}
const headers = () => ({ "content-type": "application/json", "x-user": getUser() });

async function json<T>(res: Response): Promise<T> {
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error ?? `HTTP ${res.status}`);
  return j as T;
}

/* ---- peer groups saved in Neon ---- */
export type DbPeerGroup = PeerGroup & { dbId: number; createdBy?: string; createdAt?: string };
let groupsCache: DbPeerGroup[] | null = null;
let groupsError: string | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

export async function refreshPeerGroups() {
  try {
    groupsCache = await json<DbPeerGroup[]>(await fetch("/api/peer-groups"));
    groupsError = null;
  } catch (e) {
    groupsCache = groupsCache ?? [];
    groupsError = e instanceof Error ? e.message : String(e);
  }
  notify();
}

export function useDbPeerGroups(): { groups: DbPeerGroup[]; error: string | null } {
  const [, force] = useState(0);
  useEffect(() => {
    const l = () => force((n) => n + 1);
    listeners.add(l);
    if (!groupsCache) void refreshPeerGroups();
    return () => { listeners.delete(l); };
  }, []);
  return { groups: groupsCache ?? [], error: groupsError };
}

export async function createPeerGroup(input: { name: string; description?: string; members: PeerMember[] }): Promise<DbPeerGroup> {
  const g = await json<DbPeerGroup>(await fetch("/api/peer-groups", { method: "POST", headers: headers(), body: JSON.stringify(input) }));
  await refreshPeerGroups();
  return g;
}

export async function deletePeerGroup(dbId: number) {
  await json(await fetch(`/api/peer-groups/${dbId}`, { method: "DELETE", headers: headers() }));
  await refreshPeerGroups();
}

/* ---- manual inputs (NTM estimates) ---- */
export async function saveManualInput(input: { ticker: string; field: "ntm_revenue" | "ntm_ebitda"; value: number | null; note?: string }) {
  return json(await fetch("/api/manual-inputs", { method: "POST", headers: headers(), body: JSON.stringify(input) }));
}

/* ---- comps sheets ---- */
export type SheetSummary = { id: number; name: string; targetTicker: string; createdBy: string; updatedAt: string };
export type SheetRecord = SheetSummary & { members: PeerMember[]; excluded: string[]; columnSet: string; sort: { key: string; dir: 1 | -1 } | null; snapshot: unknown };

export const listSheets = async () => json<SheetSummary[]>(await fetch("/api/sheets"));
export const loadSheet = async (id: number) => json<SheetRecord>(await fetch(`/api/sheets/${id}`));
export const deleteSheet = async (id: number) => json(await fetch(`/api/sheets/${id}`, { method: "DELETE", headers: headers() }));
export const saveSheet = async (input: { id?: number; name: string; targetTicker: string; members: PeerMember[]; excluded: string[]; columnSet: string; sort: { key: string; dir: 1 | -1 } | null; snapshot?: unknown }) =>
  json<SheetRecord>(await fetch("/api/sheets", { method: "POST", headers: headers(), body: JSON.stringify(input) }));
