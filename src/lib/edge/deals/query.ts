/**
 * The query side of "deals like this one" (E1): a deal already in the database, a listed company (its SEC
 * description, industry and size today), or a sentence ("a Permian gas gatherer bought by a sponsor").
 * Each becomes a vector (the same embedding as the deals', 512 dimensions) and the structured facts the
 * kernel compares. A sentence or a company costs one embedding call (a fraction of a cent, counted in the
 * person's AI allowance); without embeddings the search falls back to structure alone and says so.
 */
import { getCompanyData } from "@/lib/company";
import { cacheJson } from "@/lib/cache";
import { createHash } from "node:crypto";
import { embeddingsReady, embedTexts } from "../docs/embed";
import { dealQuery, type SimilarQuery } from "./store";

const embedOne = async (text: string): Promise<number[] | null> => {
  if (!embeddingsReady() || text.trim().length < 12) return null;
  const key = `edge:deals:qvec:v1:${createHash("sha256").update(text).digest("hex").slice(0, 24)}`;
  return cacheJson(key, 30 * 86_400_000, async () => (await embedTexts([text.slice(0, 4000)], "edge-deals-query"))[0] ?? null);
};

const BUYER = /^(strategic|sponsor|sponsor_backed)$/;

/** The query for a request: { dealId } | { ticker } | { text }, with an optional buyer type to compare as. */
export async function buildQuery(input: { dealId?: number; ticker?: string; text?: string; buyerType?: string }): Promise<SimilarQuery | null> {
  if (input.dealId) return dealQuery(input.dealId);
  const buyerType = BUYER.test(input.buyerType ?? "") ? input.buyerType! : "";
  if (input.ticker) {
    const co = await getCompanyData(input.ticker.toUpperCase()).catch(() => null);
    if (!co) return null;
    const ev = co.price?.marketCap ? co.price.marketCap + (co.balance?.debt ?? 0) - (co.balance?.cash ?? 0) : null;
    const text = `${co.name}. ${co.sicLabel}. ${co.industry}. ${co.description}`.slice(0, 4000);
    return { deal: { id: -1, name: `${co.name} (${co.ticker})`, sic: co.sic, evUsdMm: ev && ev > 0 ? ev : null, equityUsdMm: co.price?.marketCap ?? null, buyerType, year: new Date().getUTCFullYear(), country: "US", consideration: "" }, vector: await embedOne(text) };
  }
  const text = (input.text ?? "").trim();
  if (!text) return null;
  return { deal: { id: -1, name: text.slice(0, 80), sic: "", evUsdMm: null, equityUsdMm: null, buyerType, year: new Date().getUTCFullYear(), country: "US", consideration: "" }, vector: await embedOne(text) };
}
