/**
 * A model reads each important story once: two or three bullets on what happened, the key numbers,
 * why it matters to the desks it touches, the companies and people in it, and, for a deal or a raise,
 * the terms. It works only from the sources given (headlines, publishers' summaries, filing details,
 * and the text of an open article when the site allows it), and every ticker it names is checked
 * against SEC's list. Small model, low effort, inside the essential tier of the news budget.
 */
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import type { NewsEntity } from "@/db/schema";
import { structured } from "@/lib/ai/agent";
import { resolveTicker, tickerByName } from "@/lib/edgar/tickers";
import { cacheGet, cacheSet } from "@/lib/cache";
import { allow } from "./budget";
import { CATEGORIES, type Category } from "./classify";
import { PAYWALLED, SECTOR_KEYS, type Lens } from "./desks";
import { saveDeal } from "./deals";
import { openArticleText } from "./extract";
import type { ClusterRow, ItemRow } from "./store";

const LENSES = ["ma", "ecm", "dcm", "levfin", "rx", "sponsors", "pe", "privcredit", "infra", "vc", "radar", "markets", "event", "credit", "corpfin", "consulting", "accounting", "careers", "macro", "policy"] as const satisfies readonly Lens[];
const DEAL_KINDS = ["acquisition", "merger", "take_private", "ipo", "raise", "fund_close", "debt", "bankruptcy", "spin_off", "tender", "stake"] as const;

// Lenient on purpose: the API does not enforce array sizes or enums outside strict mode, and one extra
// bullet must not throw away a whole reading. Sizes and allowed values are applied after parsing.
export const Reading = z.object({
  bullets: z.array(z.string()).describe("what happened: two or three bullets, one fact each, under 30 words each"),
  numbers: z.array(z.object({ label: z.string(), value: z.string() })).describe("up to four key figures exactly as the sources state them"),
  why: z.string().describe("one or two sentences on why this matters to the professionals in `lenses` and `sectors`"),
  watch: z.string().nullable().describe("what to watch next, if the sources say (a vote, a close date, a ruling); else null"),
  category: z.string().describe(`one of: ${CATEGORIES.join(", ")}`),
  importance: z.number().describe("1 to 5: 5 market-moving or a top-50 company's major event; 3 notable in its sector; 1 routine"),
  sectors: z.array(z.string()).describe(`up to three of: ${SECTOR_KEYS.join(", ")}`),
  lenses: z.array(z.string()).describe(`up to four of: ${LENSES.join(", ")}`),
  entities: z.array(z.object({ name: z.string(), ticker: z.string().nullable(), kind: z.string().describe("company, investor, person, agency or fund"), role: z.string().nullable() })).describe("up to eight"),
  deal: z.object({
    kind: z.string().describe(`one of: ${DEAL_KINDS.join(", ")}`),
    acquirer: z.string().nullable().describe("buyer, investor lead, or issuer"),
    target: z.string().nullable().describe("company being bought, raising, listing or filing"),
    valueUsd: z.number().nullable().describe("headline value in US dollars, as a number (4.1 billion = 4100000000)"),
    perShare: z.number().nullable().describe("price per share in dollars, if stated"),
    consideration: z.string().nullable().describe("cash, stock or mixed"),
    round: z.string().nullable().describe("e.g. Series B, if a raise"),
    investors: z.array(z.string()),
    advisors: z.array(z.object({ firm: z.string(), side: z.string().describe("buyer, seller, target, company or lender"), role: z.string().describe("financial or legal") })),
  }).nullable(),
});
export type Reading = z.infer<typeof Reading>;

const SYSTEM = `You summarize business news for finance professionals. Use only the sources provided: never add facts, figures, names or tickers that are not in them. State numbers exactly as the sources do. If sources disagree, say so in a bullet. Tickers only where a source states them or for a company whose US listing is unambiguous; otherwise null. "deal" only for an announced or reported transaction, financing, IPO, bankruptcy or stake; otherwise null. Plain, neutral wording; no hype.`;

/** The prompt for one story: its sources, newest filing details, and open article text when allowed. */
export function storyPrompt(c: Pick<ClusterRow, "headline" | "category" | "desks">, items: Pick<ItemRow, "title" | "snippet" | "source" | "kind" | "publishedAt" | "meta">[], articleText: string | null): string {
  const lines = items.slice(0, 10).map((i, n) => `[${n + 1}] ${i.source} (${i.kind}, ${i.publishedAt.toISOString().slice(0, 16).replace("T", " ")} UTC): ${i.title}${i.snippet ? `\n    ${i.snippet}` : ""}${i.kind === "filing" && i.meta.form ? `\n    Filing: ${String(i.meta.form)}${Array.isArray(i.meta.items) && i.meta.items.length ? ` items ${(i.meta.items as string[]).join(", ")}` : ""}` : ""}`);
  return `Story: ${c.headline}\nFirst-pass category: ${c.category}. Tags so far: ${c.desks.join(", ") || "none"}.\n\nSources:\n${lines.join("\n")}${articleText ? `\n\nText of source [1]'s article, for reference only:\n${articleText.slice(0, 6000)}` : ""}`;
}

const ENTITY_KINDS = new Set(["company", "investor", "person", "agency", "fund"]);
const inSet = <T extends string>(xs: string[], allowed: readonly T[], n: number): T[] => [...new Set(xs.map((x) => x.trim().toLowerCase()).filter((x): x is T => (allowed as readonly string[]).includes(x)))].slice(0, n);

/** Apply the sizes and allowed values the schema leaves open. Pure, for tests. */
export function tidy(r: Reading): Reading {
  const cat = r.category.trim().toLowerCase();
  const kind = r.deal?.kind.trim().toLowerCase().replace(/[\s-]+/g, "_") ?? "";
  return {
    ...r,
    bullets: r.bullets.map((b) => b.trim()).filter(Boolean).slice(0, 3),
    numbers: r.numbers.filter((n) => n.label.trim() && n.value.trim()).slice(0, 4),
    category: (CATEGORIES as readonly string[]).includes(cat) ? cat : "general",
    importance: Math.max(1, Math.min(5, Number.isFinite(r.importance) ? r.importance : 2)),
    sectors: inSet(r.sectors, SECTOR_KEYS, 3),
    lenses: inSet(r.lenses, LENSES, 4),
    entities: r.entities.filter((e) => e.name.trim()).map((e) => ({ ...e, kind: ENTITY_KINDS.has(e.kind.trim().toLowerCase()) ? e.kind.trim().toLowerCase() : "company" })).slice(0, 8),
    deal: r.deal && (DEAL_KINDS as readonly string[]).includes(kind) ? { ...r.deal, kind, investors: r.deal.investors.slice(0, 8), advisors: r.deal.advisors.slice(0, 10) } : null,
  };
}

/** Tickers the model named that SEC does not list are dropped; a company named without one gets its listing when the name is unambiguous. */
async function checkTickers(entities: Reading["entities"]): Promise<NewsEntity[]> {
  const out: NewsEntity[] = [];
  for (const e of entities) {
    const t = e.ticker?.trim().toUpperCase().replace(/^\$/, "") ?? "";
    const ok = (t && /^[A-Z][A-Z0-9.\-]{0,6}$/.test(t) ? await resolveTicker(t).catch(() => null) : null)
      ?? (e.kind === "company" ? await tickerByName(e.name).catch(() => null) : null);
    out.push({ name: e.name.trim().slice(0, 120), kind: e.kind as NewsEntity["kind"], ...(ok ? { ticker: ok.ticker } : {}), ...(e.role ? { role: e.role.slice(0, 60) } : {}) });
  }
  return out;
}

/** Read one story and store the result (and its deal). Returns false when the budget or the model says no. */
export async function enrichCluster(c: ClusterRow, items: ItemRow[]): Promise<boolean> {
  if (!(await allow("essential"))) return false;
  // Open article text for important stories, from the best open source the site allows us to read.
  let text: string | null = null;
  if (c.importance >= 0.55) {
    const open = items.find((i) => (i.kind === "article" || i.kind === "release") && !PAYWALLED.test(i.domain));
    if (open) text = await openArticleText(open.url).catch(() => null);
    if (open && text) items = [open, ...items.filter((i) => i !== open)];
  }
  let r: Reading;
  try {
    r = (await structured(Reading, "news-summarize", SYSTEM, storyPrompt(c, items, text), { task: "summarize", maxTokens: 1600, timeoutMs: 60_000 })).data;
  } catch {
    // Try again in half an hour, three times at most; after that the heuristic reading stands for good.
    const key = `news:enrich-attempts:${c.id}`;
    const attempts = Number((await cacheGet(key)) ?? 0) + 1;
    await cacheSet(key, String(attempts), 3 * 86_400_000);
    await requireDb().update(schema.newsClusters).set({ enrichedAt: new Date(), ...(attempts >= 3 ? { summary: { bullets: [], numbers: [], why: "", model: "unread" } } : {}) }).where(eq(schema.newsClusters.id, c.id));
    return false;
  }
  r = tidy(r);
  const entities = await checkTickers(r.entities);
  const tickers = [...new Set([...c.tickers, ...entities.filter((e) => e.ticker).map((e) => e.ticker as string)])].slice(0, 10);
  const importance = Math.max(0, Math.min(1, 0.55 * ((r.importance - 1) / 4) + 0.45 * c.importance));
  await requireDb().update(schema.newsClusters).set({
    summary: { bullets: r.bullets.map((b) => b.trim()).filter(Boolean).slice(0, 3), numbers: r.numbers.slice(0, 4), why: r.why.trim(), ...(r.watch ? { watch: r.watch.trim() } : {}), fromText: !!text },
    category: r.category as Category, importance, entities, tickers,
    desks: [...new Set([...c.desks, ...r.sectors, ...r.lenses])],
    enrichedAt: new Date(),
  }).where(eq(schema.newsClusters.id, c.id));
  if (r.deal && (r.deal.target || r.deal.acquirer)) await saveDeal(c, r.deal, entities, items).catch(() => undefined);
  return true;
}
