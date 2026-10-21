/**
 * The envelopes of CoinGecko's and DefiLlama's answers that the crypto parsers read. The parsers already
 * drop a stray bad row; these catch drift in the shape itself (a renamed list, a renamed key on every
 * row), which would otherwise read as "no data" or zeros. Drift is SourceError "schema" (market/validate).
 */
import { z } from "zod";
import { parseOrThrow } from "@/lib/market/validate";

const obj = z.looseObject({});
/** A list whose rows carry `key` as text: a stray row may lack it, every row lacking it is drift. */
const rowsWith = (key: string) => z.array(z.unknown()).refine((rows) => rows.length === 0 || rows.some((r) => !!r && typeof (r as Record<string, unknown>)[key] === "string"), `no row has ${key}`);

export const CG = {
  markets: rowsWith("id"),
  global: z.looseObject({ data: obj }),
  coin: z.looseObject({ id: z.string() }),
  chart: z.looseObject({ prices: z.array(z.array(z.union([z.number(), z.null()]))) }),
  simple: z.record(z.string(), obj),
  search: z.looseObject({ coins: z.array(z.unknown()) }),
};

export const LLAMA = {
  protocols: rowsWith("name"),
  list: z.array(z.unknown()),
  stablecoins: z.looseObject({ peggedAssets: z.array(z.unknown()) }),
  pools: z.looseObject({ data: z.array(z.unknown()) }),
};

/** Check an answer's envelope; on drift throw SourceError(source, "schema") after logging the paths once. */
export function envelope(schema: z.ZodType, raw: unknown, source: string, endpoint: string): void {
  parseOrThrow(schema, raw, source, endpoint);
}
