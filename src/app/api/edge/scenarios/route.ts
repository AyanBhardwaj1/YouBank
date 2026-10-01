import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";
import { signedUrl, r2Ready } from "@/lib/edge/infra/r2";
import { requireDb, schema } from "@/db";
import { eq } from "drizzle-orm";
import { runCompany } from "@/lib/edge/scen/company";
import { runMarket, type Driver, type Method } from "@/lib/edge/scen/market";
import { practiceKit, type Sector } from "@/lib/edge/scen/practice";
import { parseCsv, tableFromFile, withShock } from "@/lib/edge/scen/run";
import { listScenarios, saveScenario } from "@/lib/edge/scen/store";
import { cartSynth, copulaSynth, ctganSynth, fillGaps, privacyChecks, splitHoldout, tableRealism, tableTooWide } from "@/lib/edge/scen/tables";
import type { Shock } from "@/lib/edge/scen/drivers";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const TICKER = /^[A-Z][A-Z0-9.\-]{0,9}$/;
const num = (v: unknown, d: number, lo: number, hi: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : d; };
const seedOf = (v: unknown) => Math.floor(num(v, Math.floor(Math.random() * 900_000) + 1, 1, 999_999));

/** The person's saved scenarios. */
export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const rows = await listScenarios(user.id);
    return NextResponse.json({ scenarios: rows.map((r) => ({ id: r.id, title: r.title, kind: r.kind, driver: r.driver, status: r.status, realism: (r.realism as { score?: number }).score ?? null, updatedAt: r.updatedAt.toISOString(), mine: r.ownerId === user.id })) });
  });
}

/**
 * Run a scenario and save it: { kind: "market", tickers, weights?, driver, replay?, shockText?, shock?,
 * horizon, method, seed? } | { kind: "company", ticker, years, volume, price, cost, persistence,
 * uncertainty } | { kind: "synthetic", csv | fileId, method (cart, copula or ctgan), rows, seed? } |
 * { kind: "gap", csv | fileId } | { kind: "practice", count, sector, docs }. Every result is synthetic and
 * says so. A written narrative whose views no simulated paths can carry is refused (422) with the reason.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    await rateLimit(`edge-scen:${user.id}`, 60, 3_600_000, "Many scenarios this hour; try again in a few minutes.");
    const kind = String(b.kind ?? "market");
    if (kind === "market") {
      const tickers = (Array.isArray(b.tickers) ? b.tickers : []).map((t) => String(t).toUpperCase()).filter((t) => TICKER.test(t)).slice(0, 12);
      if (!tickers.length) return NextResponse.json({ error: "Add at least one ticker." }, { status: 400 });
      const driver = (["none", "replay", "shock", "event", "tail"] as const).find((d) => d === b.driver) ?? "none";
      const method = (["auto", "bootstrap", "garch", "gjr-fhs", "gjr-t", "regimes", "diffusion"] as const).find((m) => m === b.method) ?? "auto";
      const spec = await withShock({ tickers, weights: Array.isArray(b.weights) ? b.weights.map(Number) : undefined, driver: driver as Driver, replay: typeof b.replay === "string" ? b.replay : undefined, shock: (b.shock as Shock | undefined) ?? undefined, shockText: typeof b.shockText === "string" ? b.shockText.slice(0, 400) : undefined, horizon: num(b.horizon, 60, 5, 252), method: method as Method, paths: 1000, seed: seedOf(b.seed), title: typeof b.title === "string" ? b.title.slice(0, 160) : undefined });
      const result = await runMarket(spec);
      const row = await saveScenario(user.id, { kind: "market", title: result.title, driver, spec: spec as unknown as Record<string, unknown>, result: result as unknown as Record<string, unknown> });
      return NextResponse.json({ id: row.id, status: row.status, result });
    }
    if (kind === "company") {
      const ticker = String(b.ticker ?? "").toUpperCase();
      if (!TICKER.test(ticker)) return NextResponse.json({ error: "Pick a company." }, { status: 400 });
      const spec = { ticker, years: num(b.years, 3, 1, 5), volume: num(b.volume, 0, -0.9, 2), price: num(b.price, 0, -0.9, 2), cost: num(b.cost, 0, -0.5, 2), persistence: num(b.persistence, 0.5, 0, 1), uncertainty: (["low", "base", "high"] as const).find((x) => x === b.uncertainty) ?? "base", paths: 5000, seed: seedOf(b.seed) };
      const result = await runCompany(spec);
      const row = await saveScenario(user.id, { kind: "company", title: result.title, driver: "shock", spec, result: result as unknown as Record<string, unknown>, status: "ready" });
      return NextResponse.json({ id: row.id, status: row.status, result });
    }
    if (kind === "synthetic" || kind === "gap") {
      const table = typeof b.fileId === "number" ? await tableFromFile(user.id, b.fileId) : parseCsv(String(b.csv ?? "").slice(0, 3_000_000));
      if (!table.columns.length || table.rows.length < 5) return NextResponse.json({ error: "The table needs a header row and at least five rows." }, { status: 400 });
      const wide = tableTooWide(table);
      if (wide) return NextResponse.json({ error: wide }, { status: 400 });
      if (kind === "gap") {
        const { table: out, filled } = fillGaps(table);
        const result = { kind: "gap", synthetic: true, title: `${table.title ?? "Table"}: ${filled.length} gaps filled`, original: { columns: table.columns, rows: table.rows.length }, table: out, filled };
        const row = await saveScenario(user.id, { kind: "gap", title: result.title, driver: "none", spec: { rows: table.rows.length }, result, status: "ready" });
        return NextResponse.json({ id: row.id, status: row.status, result });
      }
      const rows = num(b.rows, Math.min(1000, table.rows.length * 2), 50, 10_000), seed = seedOf(b.seed);
      // Sequential trees by default; the copula is the quick preview; CTGAN (the ML service) stays for comparison.
      const method = b.method === "ctgan" ? "ctgan" : b.method === "copula" || b.method === "statistical" ? "copula" : "cart";
      // A fifth of the rows is held out from the generator to check privacy (tables of fifty rows or more).
      const split = table.rows.length >= 50 ? splitHoldout(table, 0.2, seed) : null, train = split?.train ?? table;
      const synth = method === "ctgan" ? await ctganSynth(train, rows, seed) : method === "copula" ? copulaSynth(train, rows, seed) : cartSynth(train, rows, seed);
      const realism = tableRealism(table, synth), privacy = split ? privacyChecks(split.train, split.holdout, synth, seed) : null;
      const recipe = `${synth.synthetic!.recipe}${split ? ` Learned from ${split.train.rows.length.toLocaleString("en-US")} of the ${table.rows.length.toLocaleString("en-US")} rows; the other ${split.holdout.rows.length.toLocaleString("en-US")} were held out to check privacy.` : ""}`;
      const result = { kind: "synthetic", synthetic: true, title: `${table.title ?? "Table"}: a synthetic copy`, method, seed, realism, privacy, original: { columns: table.columns, sample: table.rows.slice(0, 50), rows: table.rows.length }, table: { ...synth, synthetic: { ...synth.synthetic!, recipe, realism: realism.score } } };
      const row = await saveScenario(user.id, { kind: "synthetic", title: result.title, driver: "none", spec: { rows, method, seed }, result, status: "ready" });
      return NextResponse.json({ id: row.id, status: row.status, result });
    }
    if (kind === "practice") {
      const kit = await practiceKit(user.id, { count: num(b.count, 6, 3, 12), sector: (["midstream", "upstream", "refining", "mixed"] as const).find((s) => s === b.sector) ?? ("midstream" as Sector), seed: seedOf(b.seed), docs: b.docs !== false });
      const row = await saveScenario(user.id, { kind: "practice", title: kit.title, driver: "none", spec: { count: kit.companies.length, seed: kit.seed }, result: kit as unknown as Record<string, unknown>, status: "ready" });
      let download: string | null = null;
      if (kit.fileId && r2Ready()) { const [f] = await requireDb().select().from(schema.edgeFiles).where(eq(schema.edgeFiles.id, kit.fileId)); if (f) download = await signedUrl(f.r2Key, 3600, { filename: f.name }); }
      return NextResponse.json({ id: row.id, status: row.status, result: kit, download });
    }
    return NextResponse.json({ error: "Unknown scenario kind." }, { status: 400 });
  });
}
