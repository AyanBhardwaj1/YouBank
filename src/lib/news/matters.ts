/**
 * "Why this matters to you", the free version: the story matched, by rule, against what the person
 * already keeps in YouBank. Nothing is guessed and no model runs; each match says what it is and links
 * to where it lives:
 * - a ticker on their watchlist or one they follow (to the company in the terminal);
 * - a company where one of their Relationships contacts works (to their contacts);
 * - a company in their Relationships pipeline (to the pipeline, with the deal's stage);
 * - an Edge watch on a company, or a watched area that contains a place the story names (to Edge).
 * The AI explanation that builds on these is a premium feature, written on request (why.ts).
 * Pure, tested; the inputs are read in views.ts.
 */
import type { NewsEntity } from "@/db/schema";
import { normCompany, type NetworkPerson } from "./rank";
import { PLACE_BY_ID } from "./radar/places";

export type MatterKind = "watchlist" | "contact" | "pipeline" | "edge";
export type Matter = { kind: MatterKind; label: string; detail: string; href: string };

export type MatterContext = {
  watch: Set<string>;
  network: Map<string, NetworkPerson[]>;
  /** Open Relationships pipeline items. */
  deals: { id: number; name: string; stage: string; status: string }[];
  /** Edge watches (theirs and their team's). */
  edge: { id: number; kind: string; label: string; ticker?: string; company?: string; bbox?: [number, number, number, number] }[];
};

const sameCompany = (a: string, b: string) => {
  const x = normCompany(a), y = normCompany(b);
  if (x.length < 3 || y.length < 3) return false;
  return x === y || (x.length >= 4 && (` ${y} `).includes(` ${x} `)) || (y.length >= 4 && (` ${x} `).includes(` ${y} `));
};
const inBox = (lat: number, lon: number, [x0, y0, x1, y1]: [number, number, number, number]) => lon >= x0 && lon <= x1 && lat >= y0 && lat <= y1;
const stage = (s: string) => s.replace(/_/g, " ");

/** What in this person's own YouBank the story touches, most specific first, at most six. */
export function mattersToYou(story: { headline: string; tickers: string[]; entities: NewsEntity[]; places?: string[] }, ctx: MatterContext): Matter[] {
  const out: Matter[] = [];
  const push = (m: Matter) => { if (!out.some((x) => x.kind === m.kind && x.label === m.label)) out.push(m); };
  const companies = story.entities.filter((e) => e.kind !== "person");
  for (const t of story.tickers) {
    if (!ctx.watch.has(t)) continue;
    const name = companies.find((e) => e.ticker === t)?.name;
    push({ kind: "watchlist", label: `${t} is on your watchlist`, detail: name ? `${name} is named in this story.` : "This story names it.", href: `/app/terminal?ticker=${encodeURIComponent(t)}&fn=DES` });
  }
  for (const e of companies) {
    const people = ctx.network.get(normCompany(e.name)) ?? [];
    if (!people.length) continue;
    const names = people.slice(0, 2).map((p) => p.name).join(" and ");
    push({ kind: "contact", label: `${names}${people.length > 2 ? ` and ${people.length - 2} more` : ""} ${people.length === 1 ? "works" : "work"} at ${people[0].company}`, detail: "A reason to get in touch: the story is a natural opener.", href: "/app/crm?tab=contacts" });
  }
  for (const d of ctx.deals) {
    if (d.status !== "open" || d.name.trim().length < 3) continue;
    const hit = companies.some((e) => sameCompany(e.name, d.name)) || new RegExp(`(^|[^\\p{L}])${d.name.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "iu").test(story.headline);
    if (hit) push({ kind: "pipeline", label: `${d.name} is in your pipeline`, detail: `Stage: ${stage(d.stage)}. Worth a look before your next step.`, href: "/app/crm?tab=pipeline" });
  }
  for (const w of ctx.edge) {
    if (w.ticker && story.tickers.includes(w.ticker)) { push({ kind: "edge", label: `You watch ${w.label} in Edge`, detail: "Edge tracks its sites and assets for change on the ground.", href: "/app/edge?view=feed" }); continue; }
    if (w.company && companies.some((e) => sameCompany(e.name, w.company!))) { push({ kind: "edge", label: `You watch ${w.label} in Edge`, detail: "Edge tracks its sites and assets for change on the ground.", href: "/app/edge?view=feed" }); continue; }
    if (w.bbox) {
      const place = (story.places ?? []).map((id) => PLACE_BY_ID.get(id)).find((p) => p && p.kind !== "country" && inBox(p.lat, p.lon, w.bbox!));
      if (place) push({ kind: "edge", label: `Near your Edge watch: ${w.label}`, detail: `The story names ${place.name}, inside the area you watch.`, href: "/app/edge?view=feed" });
    }
  }
  const order: MatterKind[] = ["watchlist", "pipeline", "contact", "edge"];
  return out.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)).slice(0, 6);
}
