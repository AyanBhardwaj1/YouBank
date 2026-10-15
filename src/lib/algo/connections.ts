/**
 * Broker connections for algo trading. Server only.
 *
 * - "paper": the built-in paper broker, always there, one account per strategy.
 * - "snaptrade": the person's SnapTrade connection from copy trading (copy_brokers), shared, so the
 *   per-user fee is paid once; connecting and disconnecting happen on the Fund copies page's Brokerage tab.
 * - "conn:<id>": a direct connection (algo_connections): Alpaca by OAuth or by API keys, Webull by app
 *   key and secret, Robinhood Crypto by API key and Ed25519 seed. Credentials are encrypted at rest with
 *   AES-256-GCM (lib/crm/crypto, keyed by EMAIL_TOKEN_SECRET), never sent to the browser, and never
 *   written to the audit log. Each is checked with a read call before it is saved.
 */
import { createHmac } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { canUse } from "@/lib/billing/entitlements";
import { decryptToken, encryptionReady, encryptToken, secretsMatch } from "@/lib/crm/crypto";
import { snapUser, symbolId } from "@/lib/copytrade/live";
import { snaptrade, snaptradeReady } from "@/lib/copytrade/snaptrade";
import { siteLink } from "@/lib/site";
import { audit, refuse, type Meta } from "./access";
import { alpaca, alpacaAuthorizeUrl, alpacaExchange, type AlpacaAuth, type AlpacaEnv } from "./brokers/alpaca";
import { robinhoodCrypto } from "./brokers/robinhood";
import { snaptradeAdapter } from "./brokers/snaptrade";
import type { BrokerAdapter, BrokerId } from "./brokers/types";
import { webull, webullEnabled } from "./brokers/webull";

type Person = Pick<CurrentUser, "id" | "email">;

export type ConnectionView = { ref: string; broker: BrokerId; env: "paper" | "live"; label: string; status: string; createdAt: string | null; note: string | null };

type Creds =
  | { broker: "alpaca"; env: AlpacaEnv; auth: AlpacaAuth }
  | { broker: "webull"; appKey: string; appSecret: string }
  | { broker: "robinhood_crypto"; apiKey: string; seed: string };

/** What each direct broker needs set up on the server, and whether it is. */
export function brokerSetup() {
  return {
    encryption: encryptionReady(),
    alpacaOAuth: !!(process.env.ALPACA_OAUTH_CLIENT_ID?.trim() && process.env.ALPACA_OAUTH_CLIENT_SECRET?.trim()),
    alpacaLiveKeys: process.env.ALGO_ALPACA_LIVE_KEYS?.trim() === "1",
    webull: webullEnabled(),
    robinhoodCrypto: true,
    snaptrade: snaptradeReady(),
  };
}

export async function listConnections(user: Person): Promise<ConnectionView[]> {
  const out: ConnectionView[] = [{ ref: "paper", broker: "paper", env: "paper", label: "YouBank paper broker", status: "active", createdAt: null, note: "Simulated fills on real prices, with spread, slippage and fees." }];
  const db = requireDb();
  const [snap] = await db.select({ at: schema.copyBrokers.createdAt }).from(schema.copyBrokers).where(eq(schema.copyBrokers.userId, user.id));
  if (snap) out.push({ ref: "snaptrade", broker: "snaptrade", env: "live", label: "SnapTrade (from Fund copies)", status: "active", createdAt: snap.at.toISOString(), note: "The brokers SnapTrade can trade; Robinhood is read-only there." });
  const rows = await db.select().from(schema.algoConnections).where(and(eq(schema.algoConnections.userId, user.id), inArray(schema.algoConnections.status, ["active", "error"])));
  for (const r of rows) out.push({ ref: `conn:${r.id}`, broker: r.broker as BrokerId, env: r.env === "live" ? "live" : "paper", label: r.label, status: r.status, createdAt: r.createdAt.toISOString(), note: r.lastError });
  return out;
}

const s = (v: unknown, max = 400) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Save a direct connection after checking it answers. Body: { broker, env?, keyId?, secret?, appKey?, appSecret?, apiKey?, privateKey?, label? }. */
export async function addConnection(user: Person, body: Record<string, unknown>, meta: Meta): Promise<ConnectionView> {
  if (!encryptionReady()) throw refuse("Broker connections are not set up yet.", 503);
  const broker = s(body.broker);
  let creds: Creds;
  if (broker === "alpaca") {
    const env: AlpacaEnv = body.env === "live" ? "live" : "paper";
    if (env === "live" && !brokerSetup().alpacaLiveKeys) throw refuse("Live Alpaca accounts connect through Alpaca's sign-in (OAuth), not pasted keys. Use paper keys here, or Connect with Alpaca.");
    if (!/^[A-Z0-9]{10,40}$/.test(s(body.keyId)) || s(body.secret).length < 20) throw refuse("Paste the API key id and secret from your Alpaca dashboard.");
    creds = { broker, env, auth: { kind: "keys", keyId: s(body.keyId), secret: s(body.secret) } };
  } else if (broker === "webull") {
    if (!webullEnabled()) throw refuse("Direct Webull connections are not switched on here yet. Webull accounts can trade through SnapTrade from Fund copies' Brokerage tab.", 503);
    if (s(body.appKey).length < 8 || s(body.appSecret).length < 8) throw refuse("Paste the App Key and App Secret from Webull's developer centre.");
    creds = { broker, appKey: s(body.appKey), appSecret: s(body.appSecret) };
  } else if (broker === "robinhood_crypto") {
    if (s(body.apiKey).length < 8 || !/^[A-Za-z0-9+/=]{40,48}$/.test(s(body.privateKey))) throw refuse("Paste the API key and the base64 private key you registered with Robinhood's Crypto Trading API.");
    creds = { broker, apiKey: s(body.apiKey), seed: s(body.privateKey) };
  } else throw refuse("Choose Alpaca, Webull or Robinhood Crypto.");
  const adapter = adapterFromCreds(creds);
  const accts = await adapter.accounts();
  if (!accts.length) throw refuse("That connection works but has no account to trade.");
  const env = creds.broker === "alpaca" ? creds.env : "live";
  const label = s(body.label, 60) || `${broker === "alpaca" ? "Alpaca" : broker === "webull" ? "Webull" : "Robinhood Crypto"}${env === "paper" ? " paper" : ""} ${accts[0].number}`.trim();
  const [row] = await requireDb().insert(schema.algoConnections).values({ userId: user.id, broker, env, label, secretEnc: encryptToken(JSON.stringify(creds)) }).returning();
  await audit({ userId: user.id, actor: user.email, action: "connection-add", payload: { broker, env, label, accounts: accts.map((a) => ({ number: a.number, paper: a.paper, type: a.type })) }, ...meta });
  return { ref: `conn:${row.id}`, broker: broker as BrokerId, env, label, status: "active", createdAt: row.createdAt.toISOString(), note: null };
}

/** Revoke a direct connection: its strategies pause and their unsent batches are canceled. */
export async function removeConnection(user: Person, ref: string, meta: Meta): Promise<void> {
  const id = Number(ref.replace(/^conn:/, ""));
  const db = requireDb();
  const won = await db.update(schema.algoConnections).set({ status: "revoked", secretEnc: "" }).where(and(eq(schema.algoConnections.id, id), eq(schema.algoConnections.userId, user.id))).returning({ id: schema.algoConnections.id });
  if (!won.length) throw refuse("That connection was not found.", 404);
  const paused = await db.update(schema.algoStrategies).set({ status: "paused", updatedAt: new Date() }).where(and(eq(schema.algoStrategies.userId, user.id), eq(schema.algoStrategies.connection, ref))).returning({ id: schema.algoStrategies.id });
  if (paused.length) await db.update(schema.algoBatches).set({ status: "canceled", updatedAt: new Date() }).where(and(inArray(schema.algoBatches.strategyId, paused.map((p) => p.id)), eq(schema.algoBatches.status, "proposed")));
  await audit({ userId: user.id, actor: user.email, action: "connection-remove", payload: { ref, pausedStrategies: paused.map((p) => p.id) }, ...meta });
}

function adapterFromCreds(c: Creds): BrokerAdapter {
  if (c.broker === "alpaca") return alpaca(c.env, c.auth);
  if (c.broker === "webull") return webull(c.appKey, c.appSecret);
  return robinhoodCrypto(c.apiKey, c.seed);
}

/** The adapter for a live connection ref ("snaptrade" or "conn:<id>"). Null when it is gone. */
export async function liveAdapter(userId: string, ref: string, accountId: string | null): Promise<{ adapter: BrokerAdapter; env: "paper" | "live" } | null> {
  if (ref === "snaptrade") {
    const u = await snapUser(userId);
    if (!u) return null;
    // The account's own broker decides trading and fractional support (SnapTrade's authorizations).
    const [accts, auths] = await Promise.all([snaptrade.accounts(u), snaptrade.authorizations(u).catch(() => [])]);
    const a = accts.find((x) => x.id === accountId);
    const b = auths.find((x) => x.id === a?.brokerage_authorization)?.brokerage;
    return { adapter: snaptradeAdapter(u, { fractional: b?.allows_fractional_units === true, trading: !!a && b?.allows_trading !== false, lookup: symbolId }), env: a?.is_paper ? "paper" : "live" };
  }
  const id = Number(ref.replace(/^conn:/, ""));
  if (!Number.isInteger(id)) return null;
  const [row] = await requireDb().select().from(schema.algoConnections).where(and(eq(schema.algoConnections.id, id), eq(schema.algoConnections.userId, userId), eq(schema.algoConnections.status, "active")));
  if (!row) return null;
  const creds = JSON.parse(decryptToken(row.secretEnc)) as Creds;
  await requireDb().update(schema.algoConnections).set({ lastUsedAt: new Date() }).where(eq(schema.algoConnections.id, id));
  return { adapter: adapterFromCreds(creds), env: row.env === "live" ? "live" : "paper" };
}

/* ---------------- Alpaca OAuth ---------------- */

const stateKey = () => process.env.BETTER_AUTH_SECRET?.trim() || process.env.EMAIL_TOKEN_SECRET?.trim() || "";
const signState = (body: string) => createHmac("sha256", stateKey()).update(`alpaca-oauth:${body}`).digest("base64url");
export const alpacaRedirect = () => siteLink("/api/algo/connections/alpaca/callback");

/** The link to Alpaca's consent page; the state carries the person and environment, signed, for ten minutes. */
export async function alpacaConnectUrl(user: Person, env: AlpacaEnv, meta: Meta): Promise<string> {
  if (!brokerSetup().alpacaOAuth || !encryptionReady() || !stateKey()) throw refuse("Alpaca sign-in is not set up yet. Paper accounts can connect with API keys.", 503);
  if (env === "live" && !(await canUse(user, "algo.live"))) throw refuse("Live Alpaca accounts are part of the Pro plan.", 402);
  const body = Buffer.from(JSON.stringify({ u: user.id, env, t: Date.now() })).toString("base64url");
  await audit({ userId: user.id, actor: user.email, action: "connection-oauth-start", payload: { broker: "alpaca", env }, ...meta });
  return alpacaAuthorizeUrl(process.env.ALPACA_OAUTH_CLIENT_ID!.trim(), alpacaRedirect(), `${body}.${signState(body)}`, env);
}

/** Finish Alpaca's OAuth: check the state is ours, for this person, and fresh; exchange the code; save the token. */
export async function alpacaCallback(user: Person, code: string, state: string, meta: Meta): Promise<ConnectionView> {
  const [body, sig] = state.split(".");
  if (!body || !sig || !secretsMatch(sig, signState(body))) throw refuse("That Alpaca sign-in link was not ours. Start again from Algo trading.", 400);
  const st = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { u: string; env: AlpacaEnv; t: number };
  if (st.u !== user.id || Date.now() - st.t > 10 * 60_000) throw refuse("That Alpaca sign-in expired. Start again from Algo trading.", 400);
  const token = await alpacaExchange(code, alpacaRedirect());
  const creds: Creds = { broker: "alpaca", env: st.env, auth: { kind: "oauth", token } };
  const accts = await alpaca(st.env, creds.auth).accounts();
  const label = `Alpaca${st.env === "paper" ? " paper" : ""} ${accts[0]?.number ?? ""}`.trim();
  const [row] = await requireDb().insert(schema.algoConnections).values({ userId: user.id, broker: "alpaca", env: st.env, label, secretEnc: encryptToken(JSON.stringify(creds)) }).returning();
  await audit({ userId: user.id, actor: user.email, action: "connection-add", payload: { broker: "alpaca", env: st.env, via: "oauth", label }, ...meta });
  return { ref: `conn:${row.id}`, broker: "alpaca", env: st.env, label, status: "active", createdAt: row.createdAt.toISOString(), note: null };
}
