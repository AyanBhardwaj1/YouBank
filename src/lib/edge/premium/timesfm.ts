/**
 * Forecasts of the scenario drivers: the U.S. market, oil and gas stocks, WTI crude, Henry Hub gas and
 * the 10-year yield, each a median path with a 10-90% band over the coming weeks.
 *
 * - Free: a drift and volatility forecast from the last five years of weekly moves (the median follows
 *   the average weekly move, the band widens with the square root of time). Honest and plain.
 * - Premium (edge.timesfm): Google's TimesFM time-series foundation model through BigQuery's
 *   AI.FORECAST, on the last ten years of the weekly level. TimesFM's open weights are licensed for
 *   non-commercial use only; BigQuery is the licensed way to use it here. A service account's key
 *   (GOOGLE_APPLICATION_CREDENTIALS_JSON) signs a token for the BigQuery API; the weekly series goes in
 *   the query itself, so no table is created and the query bills the 10 MB minimum.
 *
 * Both come back in the same shape, as the change from the last week, so the screen draws them alike.
 */
import { createSign } from "node:crypto";
import { recordUsage } from "@/lib/ai/usage";
import { logError } from "@/lib/errors";
import { FACTOR_LABEL, FACTORS, type Factor, type FactorRow } from "../scen/data";

export type ForecastPoint = { date: string; p10: number; p50: number; p90: number };
export type DriverForecast = {
  factor: Factor; label: string; unit: "pct" | "pp"; method: "drift" | "timesfm"; model: string; horizonWeeks: number;
  asOf: string; history: { date: string; value: number }[]; points: ForecastPoint[]; note: string;
};

export const HORIZONS = [4, 13, 26, 52];
export const isFactor = (v: unknown): v is Factor => typeof v === "string" && (FACTORS as readonly string[]).includes(v);
/** The yield moves in percentage points; everything else as a percentage change. */
export const unitOf = (f: Factor): "pct" | "pp" => (f === "rates" ? "pp" : "pct");
export const timesfmModel = () => { const m = process.env.TIMESFM_MODEL?.trim() ?? ""; return /^TimesFM \d+\.\d+$/.test(m) ? m : "TimesFM 2.5"; };
const Z90 = 1.2816;

/* ---------------- Pure pieces ---------------- */

/**
 * Daily moves as a weekly level series: the running sum of log returns (or of yield changes) taken at
 * each week's last trading day (Fridays, or the last day before). Pure.
 */
export function weeklyLevel(rows: FactorRow[], f: Factor): { date: string; value: number }[] {
  const out: { date: string; value: number }[] = [];
  let level = 0;
  let week = "";
  for (const r of rows) {
    level += Number.isFinite(r[f]) ? r[f] : 0;
    const d = new Date(`${r.date}T00:00:00Z`);
    // The week a day belongs to, by its Monday.
    const monday = new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * 86_400_000).toISOString().slice(0, 10);
    if (monday === week) out[out.length - 1] = { date: r.date, value: level };
    else { out.push({ date: r.date, value: level }); week = monday; }
  }
  return out;
}

/** A level difference as what the screen shows: a percentage change for prices, points for the yield. Pure. */
export const asChange = (f: Factor, diff: number) => (unitOf(f) === "pct" ? Math.exp(diff) - 1 : diff);

/** The free forecast: drift and volatility of the last five years of weekly moves. Pure. */
export function driftForecast(f: Factor, weeks: { date: string; value: number }[], horizon: number): ForecastPoint[] {
  const recent = weeks.slice(-261);
  const moves = recent.slice(1).map((w, i) => w.value - recent[i].value);
  const n = Math.max(1, moves.length);
  const mu = moves.reduce((a, b) => a + b, 0) / n;
  const sd = Math.sqrt(moves.reduce((a, b) => a + (b - mu) ** 2, 0) / Math.max(1, n - 1));
  const last = weeks[weeks.length - 1];
  return Array.from({ length: horizon }, (_, i) => {
    const h = i + 1;
    return { date: addDays(last.date, 7 * h), p50: asChange(f, mu * h), p10: asChange(f, mu * h - Z90 * sd * Math.sqrt(h)), p90: asChange(f, mu * h + Z90 * sd * Math.sqrt(h)) };
  });
}

export const addDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** The AI.FORECAST query over the weekly series, written inline (validated numbers and dates only). Pure. */
export function forecastSql(weeks: { date: string; value: number }[], horizon: number, model = timesfmModel()): string {
  const rows = weeks.filter((w) => /^\d{4}-\d{2}-\d{2}$/.test(w.date) && Number.isFinite(w.value)).map((w) => `STRUCT(TIMESTAMP '${w.date}' AS ts, ${w.value.toFixed(8)} AS value)`);
  if (rows.length < 20) throw new Error("Too little history to forecast");
  const h = Math.max(1, Math.min(104, Math.floor(horizon)));
  return `SELECT forecast_timestamp, forecast_value, prediction_interval_lower_bound, prediction_interval_upper_bound
FROM AI.FORECAST((SELECT ts, value FROM UNNEST([${rows.join(", ")}])), data_col => 'value', timestamp_col => 'ts', model => '${model.replace(/'/g, "")}', horizon => ${h}, confidence_level => 0.8)
ORDER BY forecast_timestamp`;
}

/** BigQuery's rows ({ f: [{ v }] } in the schema's order) as forecast points relative to the last level. Pure. */
export function parseForecastRows(f: Factor, j: { schema?: { fields?: { name: string }[] }; rows?: { f: { v: unknown }[] }[] }, lastLevel: number): ForecastPoint[] {
  const names = (j.schema?.fields ?? []).map((x) => x.name);
  const at = (n: string) => names.indexOf(n);
  const iT = at("forecast_timestamp"), iV = at("forecast_value"), iLo = at("prediction_interval_lower_bound"), iHi = at("prediction_interval_upper_bound");
  if (iT < 0 || iV < 0) throw new Error("BigQuery's forecast has no values");
  return (j.rows ?? []).map((r) => {
    const v = (i: number) => Number(r.f[i]?.v);
    const ts = r.f[iT]?.v;
    // Timestamps come as seconds since 1970 (a string), or as text.
    const date = typeof ts === "string" && /^\d+(\.\d+)?(E\d+)?$/i.test(ts) ? new Date(Number(ts) * 1000).toISOString().slice(0, 10) : String(ts ?? "").slice(0, 10);
    const mid = v(iV), lo = iLo >= 0 ? v(iLo) : mid, hi = iHi >= 0 ? v(iHi) : mid;
    return { date, p50: asChange(f, mid - lastLevel), p10: asChange(f, Math.min(lo, mid) - lastLevel), p90: asChange(f, Math.max(hi, mid) - lastLevel) };
  }).filter((p) => Number.isFinite(p.p50));
}

/* ---------------- BigQuery ---------------- */

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string; project_id?: string };

/** The service account from GOOGLE_APPLICATION_CREDENTIALS_JSON (the key file's JSON, or the same base64-encoded). */
function serviceAccount(): ServiceAccount {
  const raw = process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON?.trim() ?? "";
  const text = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
  const sa = JSON.parse(text) as ServiceAccount;
  if (!sa.client_email || !sa.private_key) throw new Error("The Google service account key is incomplete");
  return sa;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");

let token: { value: string; until: number } | null = null;

async function googleToken(): Promise<string> {
  if (token && token.until > Date.now() + 60_000) return token.value;
  const sa = serviceAccount();
  const aud = sa.token_uri || "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/bigquery", aud, iat: now, exp: now + 3600 }))}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(sa.private_key);
  const res = await fetch(aud, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, cache: "no-store", signal: AbortSignal.timeout(20_000),
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${unsigned}.${b64url(signature)}` }),
  });
  if (!res.ok) throw new Error(`Google sign-in answered ${res.status}`);
  const j = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!j.access_token) throw new Error("Google sign-in gave no token");
  token = { value: j.access_token, until: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return token.value;
}

/** BigQuery's on-demand price: $6.25 per TiB, 10 MB at least per query. */
const USD_PER_BYTE = 6.25 / 2 ** 40;

type QueryAnswer = { jobComplete?: boolean; jobReference?: { jobId?: string; location?: string }; schema?: { fields?: { name: string }[] }; rows?: { f: { v: unknown }[] }[]; totalBytesBilled?: string; totalBytesProcessed?: string; errors?: { message?: string }[] };

/** Run a query and wait for its rows (a minute at most). */
async function bigQuery(sqlText: string): Promise<QueryAnswer> {
  const project = process.env.GOOGLE_CLOUD_PROJECT?.trim();
  if (!project) throw new Error("GOOGLE_CLOUD_PROJECT is not set");
  const location = process.env.BIGQUERY_LOCATION?.trim() || "US";
  const auth = { authorization: `Bearer ${await googleToken()}`, "content-type": "application/json" };
  const base = `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(project)}`;
  let res = await fetch(`${base}/queries`, { method: "POST", headers: auth, cache: "no-store", signal: AbortSignal.timeout(70_000), body: JSON.stringify({ query: sqlText, useLegacySql: false, location, timeoutMs: 60_000 }) });
  if (!res.ok) throw new Error(`BigQuery answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
  let j = (await res.json()) as QueryAnswer;
  for (let i = 0; !j.jobComplete && j.jobReference?.jobId && i < 6; i++) {
    res = await fetch(`${base}/queries/${encodeURIComponent(j.jobReference.jobId)}?location=${encodeURIComponent(j.jobReference.location ?? location)}&timeoutMs=10000`, { headers: auth, cache: "no-store", signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`BigQuery answered ${res.status}`);
    j = (await res.json()) as QueryAnswer;
  }
  if (!j.jobComplete) throw Object.assign(new Error("The forecast took too long; try again."), { status: 504 });
  if (j.errors?.length) throw new Error(`BigQuery: ${j.errors[0].message ?? "query failed"}`);
  const billed = Math.max(10 * 2 ** 20, Number(j.totalBytesBilled ?? j.totalBytesProcessed ?? 0));
  recordUsage({ feature: "edge.timesfm", provider: "bigquery", model: timesfmModel(), usage: { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0 }, extraCostUsd: billed * USD_PER_BYTE });
  return j;
}

/* ---------------- The forecast ---------------- */

/** A driver's forecast: TimesFM when asked for (the route checks the plan), else the free drift forecast. */
export async function forecastDriver(rows: FactorRow[], f: Factor, horizon: number, useTimesfm: boolean): Promise<DriverForecast> {
  const weeks = weeklyLevel(rows, f);
  if (weeks.length < 60) throw Object.assign(new Error("Not enough history for this driver yet."), { status: 409 });
  const last = weeks[weeks.length - 1];
  const history = weeks.slice(-104).map((w) => ({ date: w.date, value: asChange(f, w.value - last.value) }));
  const h = HORIZONS.includes(horizon) ? horizon : 26;
  const base = { factor: f, label: FACTOR_LABEL[f], unit: unitOf(f), horizonWeeks: h, asOf: last.date, history };
  if (useTimesfm) {
    // BigQuery's and Google's own messages (project names, permissions, settings) stay in the log; the
    // person gets a plain message with its reference.
    const points = await bigQuery(forecastSql(weeks.slice(-520), h)).then((j) => parseForecastRows(f, j, last.value)).then((p) => {
      if (!p.length) throw new Error("BigQuery returned no forecast");
      return p;
    }).catch((e) => {
      if ((e as { status?: number }).status === 504) throw e;
      const ref = logError(e, { status: 502, where: "edge-timesfm" });
      throw Object.assign(new Error(`TimesFM could not forecast just now (ref ${ref}). Try again later, or use the standard forecast.`), { status: 502 });
    });
    return { ...base, method: "timesfm", model: timesfmModel(), points, note: `${timesfmModel()} through BigQuery AI.FORECAST on ${Math.min(520, weeks.length)} weeks of history; 10-90% prediction interval.` };
  }
  return { ...base, method: "drift", model: "drift and volatility", points: driftForecast(f, weeks, h), note: "The average weekly move and its volatility over the last five years, widening with the square root of time; 10-90% band. A baseline, not a view." };
}
