/**
 * What the Pulse remembers about a company's job boards between reads (E3): each posting's title,
 * department, metro, tells and when it was first and last seen, and when each metro was first hired in.
 * From a fresh read it derives the week's points: open postings, new postings, open postings by department
 * and by tell, and the location tells (a new metro; three field or operations postings at a new site).
 * Only counts and titles are kept, never descriptions, and postings closed for 400 days are forgotten.
 * Pure: the state is a plain object stored as JSON (pulse/ingest.ts).
 */
import { weekOf } from "../series/change";
import type { Department, Tell } from "../series/metrics";
import type { Posting } from "./sources/ats";
import { departmentOf, metroOf, tellsOf } from "./titles";

export type Kept = { t: string; d: Department; m: string; f: string; s: string; p: string | null; tells: Tell[]; u: string };
export type PostingState = { v: 1; firstRead: string; lastRead: string; postings: Record<string, Kept>; metros: Record<string, string>; depts: string[]; tells: string[] };

export const emptyState = (now: string): PostingState => ({ v: 1, firstRead: now, lastRead: "", postings: {}, metros: {}, depts: [], tells: [] });

const DAY = 86_400_000;
const days = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / DAY;

export type WeekRead = {
  week: string; open: number; added: number; points: { metric: string; value: number }[];
  /** Tells among postings first seen in the last 30 days, with titles and links (the tells list). */
  recentTells: { tell: Tell; title: string; location: string; firstSeen: string; url: string }[];
  newMetros: string[];
};

/**
 * Fold a read of every open posting into the state and derive the week's points. New postings this week
 * are those first seen this week; on the very first read, those the board says were published this week
 * (everything else was open before Edge looked). Pure.
 */
export function foldRead(prev: PostingState | null, postings: Posting[], nowIso: string, opts: { privateCompany: boolean }): { state: PostingState; read: WeekRead } {
  const now = nowIso.slice(0, 10);
  const state: PostingState = prev ? { ...prev, postings: { ...prev.postings }, metros: { ...prev.metros }, depts: [...prev.depts], tells: [...prev.tells] } : emptyState(now);
  const first = !prev || !prev.lastRead;
  const week = weekOf(now);
  const open = new Set<string>();
  let added = 0;
  for (const p of postings) {
    const id = `${p.board}:${p.id}`;
    open.add(id);
    const had = state.postings[id];
    const m = metroOf(p.location);
    if (m && !state.metros[m]) state.metros[m] = first ? (p.publishedAt?.slice(0, 10) ?? now) : now;
    if (had) { state.postings[id] = { ...had, s: now }; continue; }
    const firstSeen = first ? (p.publishedAt?.slice(0, 10) ?? now) : now;
    state.postings[id] = { t: p.title.slice(0, 160), d: departmentOf(p.title, p.department), m, f: firstSeen, s: now, p: p.publishedAt, tells: tellsOf(p.title, opts), u: p.url.slice(0, 300) };
    if (weekOf(firstSeen) === week) added++;
  }
  // Forget postings closed for 400 days.
  for (const [id, k] of Object.entries(state.postings)) if (!open.has(id) && days(k.s, now) > 400) delete state.postings[id];
  const live = [...open].map((id) => state.postings[id]).filter(Boolean);
  const byDept = new Map<string, number>(), byTell = new Map<string, number>();
  for (const k of live) { byDept.set(k.d, (byDept.get(k.d) ?? 0) + 1); for (const t of k.tells) byTell.set(t, (byTell.get(t) ?? 0) + 1); }
  // Location tells: a metro first hired in during the last 30 days, at a company Edge has known for six months.
  const known = days(state.firstRead, now) >= 180;
  const newMetros = known ? Object.entries(state.metros).filter(([m, f]) => m !== "remote" && days(f, now) <= 30).map(([m]) => m) : [];
  const expansion = live.filter((k) => newMetros.includes(k.m)).length;
  const buildout = newMetros.filter((m) => live.filter((k) => k.m === m && (k.d === "field" || k.d === "operations")).length >= 3).length;
  if (expansion) byTell.set("expansion", expansion);
  if (buildout) byTell.set("buildout", buildout);
  // A department or tell, once seen, keeps a point every week (zero when none are open), so its series has no gaps.
  for (const d of byDept.keys()) if (!state.depts.includes(d)) state.depts.push(d);
  for (const t of byTell.keys()) if (!state.tells.includes(t)) state.tells.push(t);
  const points = [
    { metric: "jobs.open", value: live.length },
    { metric: "jobs.new", value: added },
    ...state.depts.map((d) => ({ metric: `jobs.dept.${d}`, value: byDept.get(d) ?? 0 })),
    ...state.tells.map((t) => ({ metric: `jobs.tell.${t}`, value: byTell.get(t) ?? 0 })),
  ];
  const recentTells = live.filter((k) => k.tells.length && days(k.f, now) <= 30).flatMap((k) => k.tells.map((tell) => ({ tell, title: k.t, location: k.m, firstSeen: k.f, url: k.u }))).slice(0, 40);
  state.lastRead = now;
  return { state, read: { week, open: live.length, added, points, recentTells, newMetros } };
}

/** Open postings by metro, most first: the "where they hire" list. Pure. */
export function byMetro(state: PostingState, limit = 12): { metro: string; open: number }[] {
  const n = new Map<string, number>();
  for (const k of Object.values(state.postings)) if (k.s === state.lastRead && k.m) n.set(k.m, (n.get(k.m) ?? 0) + 1);
  return [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([metro, open]) => ({ metro, open }));
}
