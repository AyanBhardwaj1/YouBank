/**
 * The crypto rows a person owns: addresses they read, the costs they entered, and their
 * notarizations, with the on-chain check that confirms a notarization. Server only. Every query is
 * scoped to the signed-in person's id.
 */
import { and, desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { parseAddress } from "./address";
import { isChainKey, type ChainKey } from "./chains";
import { checkNotaryTx, isSha256Hex, isTxHash, type TxFacts } from "./notary";
import { evmClient, isEvmKey } from "./rpc";

const bad = (message: string) => Object.assign(new Error(message), { status: 400 });

/* ---------------- Addresses ---------------- */

export type AddressRow = typeof schema.cryptoAddresses.$inferSelect;

export const listAddresses = (userId: string) =>
  requireDb().select().from(schema.cryptoAddresses).where(eq(schema.cryptoAddresses.userId, userId)).orderBy(schema.cryptoAddresses.createdAt).limit(50);

export async function addAddress(userId: string, input: { address: string; label?: string; role?: string; source?: string }): Promise<AddressRow> {
  const p = parseAddress(input.address);
  if (!p.kind) throw bad(p.error);
  const existing = await listAddresses(userId);
  if (existing.length >= 30) throw bad("You can keep up to 30 addresses. Remove one first.");
  const values = { userId, address: p.address, kind: p.kind, label: (input.label ?? "").trim().slice(0, 60), role: input.role === "watch" ? "watch" : "own", source: input.source === "connected" ? "connected" : "pasted" };
  const [row] = await requireDb().insert(schema.cryptoAddresses).values(values)
    .onConflictDoUpdate({ target: [schema.cryptoAddresses.userId, schema.cryptoAddresses.address], set: { label: values.label, role: values.role } }).returning();
  return row;
}

export async function removeAddress(userId: string, id: number) {
  await requireDb().delete(schema.cryptoAddresses).where(and(eq(schema.cryptoAddresses.userId, userId), eq(schema.cryptoAddresses.id, id)));
}

/* ---------------- Cost basis ---------------- */

export async function costsFor(userId: string): Promise<Record<string, number>> {
  const rows = await requireDb().select().from(schema.cryptoCostBasis).where(eq(schema.cryptoCostBasis.userId, userId));
  return Object.fromEntries(rows.map((r) => [r.asset, r.costUsd]));
}

export async function setCost(userId: string, asset: string, costUsd: number | null) {
  if (!/^[a-z0-9-]{1,80}$/.test(asset)) throw bad("Unknown asset");
  const db = requireDb();
  if (costUsd === null || !(costUsd > 0)) { await db.delete(schema.cryptoCostBasis).where(and(eq(schema.cryptoCostBasis.userId, userId), eq(schema.cryptoCostBasis.asset, asset))); return; }
  if (costUsd > 1e12) throw bad("That cost is too large");
  await db.insert(schema.cryptoCostBasis).values({ userId, asset, costUsd, updatedAt: new Date() })
    .onConflictDoUpdate({ target: [schema.cryptoCostBasis.userId, schema.cryptoCostBasis.asset], set: { costUsd, updatedAt: new Date() } });
}

/* ---------------- Notarizations ---------------- */

export type NotaryRow = typeof schema.cryptoNotarizations.$inferSelect;

/** A transaction's facts as the notary check needs them, from the chain. Pending when not mined (or not yet seen). */
export async function readTx(chain: ChainKey, hash: `0x${string}`): Promise<TxFacts | null> {
  if (!isEvmKey(chain)) return null;
  const client = evmClient(chain);
  const tx = await client.getTransaction({ hash }).catch(() => null);
  if (!tx) return null;
  const receipt = await client.getTransactionReceipt({ hash }).catch(() => null);
  return { from: tx.from, to: tx.to ?? null, value: tx.value, input: tx.input, status: receipt ? receipt.status : "pending", blockNumber: receipt?.blockNumber ?? null };
}

/** Check a notarization against the chain and record the outcome. */
export async function verifyNotarization(row: NotaryRow): Promise<NotaryRow> {
  if (row.status !== "pending" || !isChainKey(row.chain)) return row;
  const tx = await readTx(row.chain, row.txHash as `0x${string}`).catch(() => null);
  // Not found yet: a just-broadcast transaction can take a few seconds to reach a public node.
  if (!tx) return row;
  const v = checkNotaryTx(tx, row.sha256, row.fromAddress);
  if (!v.ok && v.pending) return row;
  const set = v.ok
    ? { status: "confirmed", reason: "", blockNumber: tx.blockNumber !== null ? Number(tx.blockNumber) : null, confirmedAt: new Date() }
    : { status: "failed", reason: v.reason, blockNumber: tx.blockNumber !== null ? Number(tx.blockNumber) : null };
  const [updated] = await requireDb().update(schema.cryptoNotarizations).set(set).where(eq(schema.cryptoNotarizations.id, row.id)).returning();
  return updated ?? row;
}

export async function recordNotarization(userId: string, input: { sha256: string; txHash: string; fromAddress: string; subject?: string; kind?: string; studioDocId?: number | null; studioEventId?: number | null; chain?: string }): Promise<NotaryRow> {
  const sha = input.sha256.toLowerCase();
  if (!isSha256Hex(sha)) throw bad("That is not a SHA-256 hash");
  if (!isTxHash(input.txHash)) throw bad("That is not a transaction hash");
  const from = parseAddress(input.fromAddress);
  if (from.kind !== "evm") throw bad("Notarizing needs an Ethereum-style wallet address");
  const chain = isChainKey(input.chain) && isEvmKey(input.chain) ? input.chain : "base";
  const [row] = await requireDb().insert(schema.cryptoNotarizations).values({
    userId, sha256: sha, txHash: input.txHash.toLowerCase(), fromAddress: from.address, chain, subject: (input.subject ?? "").slice(0, 200),
    kind: input.kind === "studio" ? "studio" : "document", studioDocId: input.studioDocId ?? null, studioEventId: input.studioEventId ?? null,
  }).onConflictDoNothing().returning();
  if (!row) throw Object.assign(new Error("That transaction is already recorded"), { status: 409 });
  return verifyNotarization(row);
}

export async function listNotarizations(userId: string, sha256?: string): Promise<NotaryRow[]> {
  const where = sha256 ? and(eq(schema.cryptoNotarizations.userId, userId), eq(schema.cryptoNotarizations.sha256, sha256.toLowerCase())) : eq(schema.cryptoNotarizations.userId, userId);
  const rows = await requireDb().select().from(schema.cryptoNotarizations).where(where).orderBy(desc(schema.cryptoNotarizations.createdAt)).limit(100);
  // Re-check the few still pending (a free read from a public node), so the list settles on its own.
  return Promise.all(rows.map((r, i) => (r.status === "pending" && i < 10 ? verifyNotarization(r).catch(() => r) : r)));
}
