/**
 * How a person's ledger Durable Object lines its own copy up with the head YouBank has stored before it
 * appends. Pure (tested in test/run.ts):
 * - YouBank's head is the record. The Durable Object follows it when it is behind, or when the two disagree.
 * - When the Durable Object is ahead with entries that chain cleanly onto YouBank's head, those are entries whose
 *   insert failed after it answered: they are handed back to be written, and the new entry goes after them.
 * - When YouBank holds nothing for the person, the Durable Object starts afresh: deleted entries never come back.
 */
import { verifyChain, type LedgerEntry } from "../../src/lib/ledger/chain";

export type Head = { seq: number; hash: string } | null;
export type Plan = { after: Head; missing: LedgerEntry[]; dropAbove: number | null };

export function reconcile(base: Head, mine: Head, ahead: LedgerEntry[]): Plan {
  if (!mine) return { after: base, missing: [], dropAbove: null };
  // YouBank holds nothing for this person (a new ledger, or one deleted with the account): start afresh, and never
  // bring back entries YouBank no longer has.
  if (!base) return { after: null, missing: [], dropAbove: 0 };
  const baseSeq = base?.seq ?? 0;
  if (mine.seq < baseSeq) return { after: base, missing: [], dropAbove: null };
  if (mine.seq === baseSeq) return mine.hash === base?.hash ? { after: base, missing: [], dropAbove: null } : { after: base, missing: [], dropAbove: baseSeq - 1 };
  // Ahead: keep the extra entries only if they chain onto YouBank's head without a gap.
  const ok = ahead.length === mine.seq - baseSeq && verifyChain(ahead, base).ok;
  return ok ? { after: mine, missing: ahead, dropAbove: null } : { after: base, missing: [], dropAbove: baseSeq };
}
