/**
 * Notarizing a document on chain: proof that a file (a deal document, a Studio model's audit trail)
 * existed in exactly this form at a point in time, without revealing it. Pure, for tests and both
 * sides.
 *
 * How it works:
 * 1. The browser hashes the file with SHA-256. The file never leaves the person's machine.
 * 2. The person's own wallet sends a zero-value transaction to their own address on Base, with the
 *    hash in the calldata as readable text: "YouBank notary v1 sha256:<64 hex>". It costs a fraction
 *    of a cent; YouBank holds no key and pays nothing.
 * 3. The server reads the transaction back from a Base node and checks it says what it should: from
 *    the person's address to itself, no value, this calldata, mined successfully. Only then is the
 *    record marked confirmed. Anyone can check it on Basescan ("Input data", view as UTF-8).
 *
 * A self-transaction was chosen over an attestation contract (EAS) because it needs no contract, no
 * schema and no approval screen beyond "send": every wallet can do it and every explorer shows it.
 */
import { hexToString, isHex } from "viem";
import { textHex } from "./address";

export const NOTARY_PREFIX = "YouBank notary v1 sha256:";
export const isSha256Hex = (s: string) => /^[0-9a-f]{64}$/.test(s);
export const isTxHash = (s: string) => /^0x[0-9a-fA-F]{64}$/.test(s);

/** The calldata that records a hash. */
export function notaryCalldata(sha256: string): `0x${string}` {
  const h = sha256.toLowerCase().replace(/^0x/, "");
  if (!isSha256Hex(h)) throw new Error("That is not a SHA-256 hash (64 hex characters)");
  return textHex(`${NOTARY_PREFIX}${h}`);
}

/** The hash recorded in a transaction's calldata, or null if it is not a YouBank notarization. */
export function parseNotaryCalldata(input: string): string | null {
  if (!isHex(input) || input === "0x") return null;
  let text: string;
  try { text = hexToString(input as `0x${string}`); } catch { return null; }
  if (!text.startsWith(NOTARY_PREFIX)) return null;
  const h = text.slice(NOTARY_PREFIX.length).trim().toLowerCase();
  return isSha256Hex(h) ? h : null;
}

export type TxFacts = { from: string; to: string | null; value: bigint; input: string; status: "success" | "reverted" | "pending"; blockNumber: bigint | null };

export type Verdict = { ok: true } | { ok: false; reason: string; pending?: boolean };

/** Whether a transaction is a valid notarization of `sha256` by `expectedFrom` (when given). Pure, for tests. */
export function checkNotaryTx(tx: TxFacts, sha256: string, expectedFrom?: string): Verdict {
  if (tx.status === "pending") return { ok: false, pending: true, reason: "The transaction is not mined yet" };
  if (tx.status === "reverted") return { ok: false, reason: "The transaction failed on chain" };
  if (expectedFrom && tx.from.toLowerCase() !== expectedFrom.toLowerCase()) return { ok: false, reason: "The transaction was sent from a different address" };
  if (!tx.to || tx.to.toLowerCase() !== tx.from.toLowerCase()) return { ok: false, reason: "A notarization is a transaction to your own address; this one went elsewhere" };
  if (tx.value !== BigInt(0)) return { ok: false, reason: "A notarization moves no funds; this transaction carried value" };
  const recorded = parseNotaryCalldata(tx.input);
  if (!recorded) return { ok: false, reason: "The transaction does not carry a YouBank notarization" };
  if (recorded !== sha256.toLowerCase()) return { ok: false, reason: "The transaction records a different file" };
  return { ok: true };
}

/**
 * Canonical JSON: keys sorted at every level, no whitespace, so the same content always hashes the
 * same (Postgres jsonb re-orders keys, so this matters for Studio models).
 */
export function canonicalJson(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`).join(",")}}`;
}

/** SHA-256 of bytes or text in the browser (Web Crypto), as lowercase hex. */
export async function sha256Hex(data: ArrayBuffer | Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data instanceof Uint8Array ? data : new Uint8Array(data);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
