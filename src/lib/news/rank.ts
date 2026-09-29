/**
 * What a story is worth to one reader: how well it fits their desk, how important it is, whether it
 * names a company on their watchlist, a ticker or topic they follow, or a company where someone in
 * their network works, and how fresh it is. Muted sources and topics drop out. Each score comes with
 * its reasons in words ("On your watchlist: XOM"), which the cards show. Pure, tested.
 */
import type { NewsEntity } from "@/db/schema";
import { deskAffinity, type Desk } from "./desks";

export type NetworkPerson = { contactId: number; name: string; company: string };
export type Reader = {
  desk: Pick<Desk, "lenses" | "sectors">;
  watch: Set<string>;
  follows: { tickers: string[]; topics: string[] };
  mutes: { sources: string[]; topics: string[] };
  /** Normalized company name to the people there. */
  network: Map<string, NetworkPerson[]>;
};
export type Rankable = { id: number; headline: string; desks: string[]; tickers: string[]; entities: NewsEntity[]; importance: number; updatedAt: Date; firstSeenAt: Date; category: string; sources?: string[] };
export type Ranked<T> = T & { score: number; reasons: string[] };

/** "Acme Holdings, Inc." and "ACME HOLDINGS INC" both become "acme holdings". */
export function normCompany(name: string): string {
  return name.toLowerCase().replace(/[.,'’]/g, " ").replace(/\b(inc|incorporated|corp|corporation|co|company|ltd|limited|llc|lp|plc|holdings?|group|the|sa|nv|ag|se)\b/g, " ").replace(/\s+/g, " ").trim();
}

export function score(r: Reader, s: Rankable, now = new Date()): { score: number; reasons: string[] } {
  const text = s.headline.toLowerCase();
  if (s.sources?.some((x) => r.mutes.sources.includes(x)) && (s.sources?.length ?? 0) === 1) return { score: -1, reasons: [] };
  if (r.mutes.topics.some((t) => t && text.includes(t.toLowerCase()))) return { score: -1, reasons: [] };
  const reasons: string[] = [];
  let boost = 0;
  const watched = s.tickers.filter((t) => r.watch.has(t) || r.follows.tickers.includes(t));
  if (watched.length) { boost += 0.55; reasons.push(`On your watchlist: ${watched.slice(0, 3).join(", ")}`); }
  const people: NetworkPerson[] = [];
  for (const e of s.entities) if (e.kind === "company" || e.kind === "fund" || e.kind === "investor") for (const p of r.network.get(normCompany(e.name)) ?? []) people.push(p);
  if (people.length) { boost += 0.5; reasons.push(`In your network: ${people[0].name || "a contact"} at ${people[0].company}${people.length > 1 ? ` and ${people.length - 1} more` : ""}`); }
  const topic = r.follows.topics.find((t) => t && (text.includes(t.toLowerCase()) || s.desks.includes(t.toLowerCase())));
  if (topic) { boost += 0.3; reasons.push(`You follow "${topic}"`); }
  const fit = deskAffinity(r.desk, s.desks);
  if (fit >= 0.55 && !reasons.length) reasons.push("For your desk");
  const ageH = Math.max(0, (now.getTime() - s.updatedAt.getTime()) / 3_600_000);
  const fresh = Math.exp(-ageH / 20);
  return { score: (0.5 * fit + 0.9 * s.importance + boost) * (0.35 + 0.65 * fresh), reasons };
}

/** Stories in the order this reader should see them; muted ones removed. */
export function rank<T extends Rankable>(r: Reader, stories: T[], now = new Date()): Ranked<T>[] {
  return stories.map((s) => ({ ...s, ...score(r, s, now) })).filter((s) => s.score >= 0).sort((a, b) => b.score - a.score);
}
