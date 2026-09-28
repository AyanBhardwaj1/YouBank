/**
 * A company snapshot for when the feeds cannot supply it: the price, its range and market cap, beta,
 * and what the company does. Whatever the feeds have (FMP, then Nasdaq, through the company record) is
 * used as is; only the gaps are looked up by AI research, each figure checked against its source.
 * DES asks for it when a company has no price or description; the price screens show it when no feed
 * has the daily history their charts need.
 */
import { getCompanyData } from "@/lib/company";
import { noteSource } from "@/lib/market/provenance";
import { factNum, factStr, research, type Field, type Researched } from "@/lib/market/research";

export type Need = "quote" | "profile" | "risk";

export type Snapshot = {
  ticker: string; name: string;
  price: number | null; changePct: number | null; marketCap: number | null; high52: number | null; low52: number | null;
  beta: number | null; description: string | null; sector: string | null; industry: string | null;
  /** Which fields came from the feeds and which from AI research (with sources in `research`). */
  fromFeeds: string[]; research: Researched | null;
};

export async function companySnapshot(ticker: string, needs: Need[] = ["quote"]): Promise<Snapshot> {
  const c = await getCompanyData(ticker);
  if (!c) throw Object.assign(new Error(`No SEC data for ${ticker.toUpperCase()}`), { status: 404 });
  const fromFeeds: string[] = [];
  const snap: Snapshot = {
    ticker: c.ticker, name: c.name, price: c.price?.last ?? null, changePct: c.price ? c.price.changePct / 100 : null,
    marketCap: c.price?.marketCap ?? null, high52: c.price?.high52 ?? null, low52: c.price?.low52 ?? null,
    beta: null, description: c.description || null, sector: null, industry: c.industry || null, fromFeeds, research: null,
  };
  if (snap.price !== null) fromFeeds.push("price", "changePct", "marketCap", "high52", "low52");
  if (snap.description) fromFeeds.push("description");
  const want: Field[] = [];
  if ((needs.includes("quote") || needs.includes("risk")) && snap.price === null) want.push("price", "changePct", "marketCap", "high52", "low52");
  if (needs.includes("risk")) want.push("beta");
  if (needs.includes("profile") && !snap.description) want.push("description", "sector", "industry");
  if (!want.length) return snap;
  const r = await research(`${c.name} (${c.exchange ? `${c.exchange}: ` : ""}${c.ticker})`, want, { shares: c.balance.sharesOut ? c.balance.sharesOut * 1e6 : null }).catch(() => null);
  if (!r) return snap;
  noteSource("AI research");
  const num = (f: Field) => factNum(r, f);
  if (snap.price === null && num("price") !== null) {
    snap.price = num("price"); snap.changePct = num("changePct");
    snap.marketCap = num("marketCap") !== null ? (num("marketCap") as number) / 1e6 : snap.price !== null && c.balance.sharesOut ? snap.price * c.balance.sharesOut : null;
    snap.high52 = num("high52"); snap.low52 = num("low52");
  }
  snap.beta = num("beta");
  if (!snap.description) { snap.description = factStr(r, "description"); snap.sector = factStr(r, "sector"); snap.industry = snap.industry ?? factStr(r, "industry"); }
  snap.research = r;
  return snap;
}
