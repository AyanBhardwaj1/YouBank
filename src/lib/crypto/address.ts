/**
 * Which chain an address belongs to, checked properly: EVM addresses by their EIP-55 checksum when
 * mixed-case, Bitcoin addresses by their Base58Check or Bech32/Bech32m checksum, Solana addresses by
 * decoding to 32 bytes, and ENS names by shape (resolved later, on Ethereum). Pure, for tests; runs on
 * the client and the server.
 *
 * A pasted address is only ever read: YouBank never asks for a key and never moves funds.
 */
import { getAddress, hexToBytes, isAddress, sha256, toHex } from "viem";

export type AddressKind = "evm" | "bitcoin" | "solana" | "ens";
export type Parsed = { kind: AddressKind; address: string } | { kind: null; error: string };

const B58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Base58 (Bitcoin alphabet) to bytes, or null if a character is not in the alphabet. */
export function base58Decode(s: string): Uint8Array | null {
  // BigInt() rather than literals: the build targets ES2017.
  const ZERO = BigInt(0), BASE = BigInt(58), BYTE = BigInt(256);
  let n = ZERO;
  for (const ch of s) {
    const i = B58.indexOf(ch);
    if (i < 0) return null;
    n = n * BASE + BigInt(i);
  }
  const bytes: number[] = [];
  while (n > ZERO) { bytes.unshift(Number(n % BYTE)); n /= BYTE; }
  for (const ch of s) { if (ch !== "1") break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

const dsha = (b: Uint8Array) => hexToBytes(sha256(hexToBytes(sha256(b))));

/** Legacy (1…) and P2SH (3…) Bitcoin addresses: 25 bytes whose last four are a double-SHA-256 checksum. */
export function isBase58Btc(s: string): boolean {
  if (!/^[13][1-9A-HJ-NP-Za-km-z]{25,34}$/.test(s)) return false;
  const b = base58Decode(s);
  if (!b || b.length !== 25 || (b[0] !== 0x00 && b[0] !== 0x05)) return false;
  const sum = dsha(b.slice(0, 21));
  return sum[0] === b[21] && sum[1] === b[22] && sum[2] === b[23] && sum[3] === b[24];
}

const BECH = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
function polymod(values: number[]): number {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i];
  }
  return chk >>> 0;
}
const hrpExpand = (hrp: string) => [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31)];

/** Native SegWit (bc1q…, Bech32) and Taproot (bc1p…, Bech32m) mainnet addresses (BIP 173, BIP 350). */
export function isBech32Btc(input: string): boolean {
  const s = input.toLowerCase();
  if (s !== input && input.toUpperCase() !== input) return false;
  if (!/^bc1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{8,87}$/.test(s)) return false;
  const data = [...s.slice(3)].map((c) => BECH.indexOf(c));
  const check = polymod([...hrpExpand("bc"), ...data]);
  const version = data[0];
  // Witness version 0 uses Bech32 (constant 1); versions 1 to 16 use Bech32m.
  return version === 0 ? check === 1 : version <= 16 && check === 0x2bc830a3;
}

/** Solana addresses are base58 public keys of exactly 32 bytes. */
export function isSolana(s: string): boolean {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s)) return false;
  return base58Decode(s)?.length === 32;
}

export const isEns = (s: string) => /^([a-z0-9-]+\.)+eth$/i.test(s) && s.length <= 255;

/** Identify and normalise a pasted address. EVM addresses come back checksummed. */
export function parseAddress(raw: string): Parsed {
  const s = raw.trim();
  if (!s) return { kind: null, error: "Paste an address" };
  if (/^0x/i.test(s)) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(s)) return { kind: null, error: "That is not a full EVM address (0x followed by 40 hex characters)" };
    // Mixed case carries an EIP-55 checksum, which must match; all-lower or all-upper carries none.
    if (!isAddress(s, { strict: s !== s.toLowerCase() && s.slice(2) !== s.slice(2).toUpperCase() })) return { kind: null, error: "That address's checksum does not match: check for a typo" };
    return { kind: "evm", address: getAddress(s) };
  }
  if (isEns(s)) return { kind: "ens", address: s.toLowerCase() };
  if (/^bc1/i.test(s)) return isBech32Btc(s) ? { kind: "bitcoin", address: s.toLowerCase() } : { kind: null, error: "That Bitcoin address's checksum does not match: check for a typo" };
  if (/^[13]/.test(s) && s.length <= 35 && isBase58Btc(s)) return { kind: "bitcoin", address: s };
  if (isSolana(s)) return { kind: "solana", address: s };
  if (/^[13]/.test(s) && s.length <= 35) return { kind: null, error: "That Bitcoin address's checksum does not match: check for a typo" };
  return { kind: null, error: "Not an address YouBank reads: use an Ethereum or L2 address (0x…), an ENS name, a Bitcoin address or a Solana address" };
}

/** "0x1234…abcd" for display. */
export const shortAddress = (a: string) => (a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Hex of UTF-8 text (for calldata). */
export const textHex = (s: string) => toHex(new TextEncoder().encode(s));
