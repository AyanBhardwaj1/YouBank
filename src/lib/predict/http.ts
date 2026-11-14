/**
 * Small helpers for the /api/predict routes: input checks at the boundary, and the same-site rule for
 * requests that change something (src/lib/copytrade/access.ts sameSiteJson, which this follows).
 */
import { KEY_RE } from "./store";

const refuse = (message: string, status = 400) => Object.assign(new Error(message), { status });

/** A change must come from YouBank's own pages: the browser marks cross-site requests in Sec-Fetch-Site. */
export function sameSite(req: Request): boolean {
  const site = req.headers.get("sec-fetch-site");
  return !site || site === "same-origin" || site === "none";
}

/** A JSON object body, or a 400. */
export async function body(req: Request): Promise<Record<string, unknown>> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) throw refuse("Send a JSON object.");
  const b = await req.json().catch(() => null);
  if (!b || typeof b !== "object" || Array.isArray(b)) throw refuse("Send a JSON object.");
  return b as Record<string, unknown>;
}

/** A market key ("kalshi:KXFED-26DEC-C25"), or a 400. */
export function marketKey(v: unknown): string {
  const k = typeof v === "string" ? v.trim() : "";
  if (!KEY_RE.test(k)) throw refuse("That market was not recognised.");
  return k;
}

/** Up to `max` tickers from "AAPL,MSFT" or a list. */
export function tickerList(v: unknown, max = 50): string[] {
  const raw = Array.isArray(v) ? v : typeof v === "string" ? v.split(/[,\s]+/) : [];
  return [...new Set(raw.map((x) => String(x).trim().toUpperCase()).filter((x) => /^[A-Z]{1,5}([.-][A-Z]{1,2})?$/.test(x)))].slice(0, max);
}

export const CROSS_SITE = { error: "Make this change on YouBank itself." } as const;
export const NO_STORE = { "Cache-Control": "private, no-store" } as const;
