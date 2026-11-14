/**
 * The research ledger's sequencer: one Durable Object per person (named by their user id). A Durable Object
 * handles one request at a time, so two AI answers finishing at the same moment can never race for the same
 * place in the chain; YouBank asks it while holding its own per-person lock, so the head YouBank reports is
 * always the stored one and the two copies cannot drift apart. It keeps its own SQLite copy of every entry it appended (a second, independent record of
 * the chain outside YouBank's database) and computes each entry with the same code YouBank verifies with
 * (src/lib/ledger/chain.ts), so YouBank can recompute and refuse anything that does not match.
 */
import { DurableObject } from "cloudflare:workers";
import { nextEntry, type LedgerContent, type LedgerEntry } from "../../src/lib/ledger/chain";
import type { Env } from "./env";
import { reconcile, type Head } from "./ledger-logic";

export class LedgerSequencer extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.ctx.storage.sql.exec("create table if not exists entries (seq integer primary key, hash text not null, body text not null)");
    });
  }

  private head(): Head {
    const r = this.ctx.storage.sql.exec<{ seq: number; hash: string }>("select seq, hash from entries order by seq desc limit 1").toArray()[0];
    return r ? { seq: r.seq, hash: r.hash } : null;
  }

  private after(seq: number): LedgerEntry[] {
    return this.ctx.storage.sql.exec<{ body: string }>("select body from entries where seq > ? order by seq", seq).toArray().map((r) => JSON.parse(r.body) as LedgerEntry);
  }

  /** Append after YouBank's stored head (`base`); returns the new entry and any earlier ones YouBank is missing. */
  async append(content: LedgerContent, base: Head): Promise<string> {
    const plan = reconcile(base, this.head(), this.after(base?.seq ?? 0));
    if (plan.dropAbove !== null) this.ctx.storage.sql.exec("delete from entries where seq > ?", plan.dropAbove);
    const entry = nextEntry(plan.after, content, new Date());
    this.ctx.storage.sql.exec("insert or replace into entries (seq, hash, body) values (?, ?, ?)", entry.seq, entry.hash, JSON.stringify(entry));
    // As JSON text: an entry's meta is free-form, which RPC's structured types do not describe.
    return JSON.stringify({ entry, missing: plan.missing });
  }

  /** Forget everything held for this person (their account was deleted). */
  async purge(): Promise<{ purged: true }> {
    // Rows, not the table: this instance keeps serving appends without a restart.
    this.ctx.storage.sql.exec("delete from entries");
    return { purged: true };
  }

  /** The head, and entries after a sequence number (for a check against YouBank's copy). */
  async read(afterSeq = 0, limit = 200): Promise<string> {
    return JSON.stringify({ head: this.head(), entries: this.after(afterSeq).slice(0, Math.max(1, Math.min(1000, limit))) });
  }
}
