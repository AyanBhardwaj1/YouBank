import { randomBytes } from "node:crypto";

/** Pairing codes: eight characters in two groups, without the look-alikes 0/O, 1/I/L. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function newCode(): string {
  const chars = [...randomBytes(8)].map((b) => ALPHABET[b % ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

/** A code as typed ("abcd 2345", "ABCD-2345") in its canonical form, or null. */
export const normalizeCode = (code: string) => {
  const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return c.length === 8 ? `${c.slice(0, 4)}-${c.slice(4)}` : null;
};
