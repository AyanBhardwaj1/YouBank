/**
 * The Thesis Agent on Cloudflare's Agents SDK: one agent (a Durable Object with its own SQLite) per thesis,
 * named `thesis-{id}`. It holds the thesis's schedule and a log of every tick, wakes itself when the next tick
 * is due (an alarm, so it costs nothing while it sleeps), asks YouBank to run the tick (POST /api/cf/thesis/tick,
 * where the thesis's tools, models, data and budget live), and decides from the answer when to wake again:
 * at once for the next slice of a long tick, at the thesis's own next check-in, or not at all once the thesis
 * is paused, stopped or done. YouBank wakes it when a thesis is approved or resumed, and stops it when paused.
 */
import { Agent } from "agents";
import { AppError, callApp } from "./app";
import type { Env } from "./env";
import { afterFailure, nextAfter, type Next, type TickAnswer } from "./thesis-logic";

type State = { thesisId: number | null; status: "idle" | "scheduled" | "stopped"; nextAt: string | null; lastTickAt: string | null; failures: number; ticks: number; why: string | null };

export class ThesisAgent extends Agent<Env, State> {
  initialState: State = { thesisId: null, status: "idle", nextAt: null, lastTickAt: null, failures: 0, ticks: 0, why: null };

  async onStart() {
    this.sql`create table if not exists ticks (at text not null, outcome text not null, ms integer not null)`;
  }

  /** Wake now: run the due tick in a moment (YouBank's request returns at once). */
  async wake(thesisId: number): Promise<State> {
    await this.clear();
    await this.schedule(1, "tick", { thesisId });
    this.setState({ ...this.state, thesisId, status: "scheduled", nextAt: new Date(Date.now() + 1000).toISOString(), failures: 0, why: null });
    return this.state;
  }

  /** Stop scheduling (paused or stopped in YouBank). The log stays. */
  async stop(why = "stopped from YouBank"): Promise<State> {
    await this.clear();
    this.setState({ ...this.state, status: "stopped", nextAt: null, why });
    return this.state;
  }

  async status(): Promise<State & { recent: { at: string; outcome: string; ms: number }[] }> {
    const recent = this.sql<{ at: string; outcome: string; ms: number }>`select at, outcome, ms from ticks order by rowid desc limit 20`;
    return { ...this.state, recent };
  }

  /** The alarm: run one slice of the tick in YouBank, log it, and decide when to wake next. */
  async tick(payload: { thesisId: number }) {
    const t0 = Date.now();
    const id = payload?.thesisId ?? this.state.thesisId;
    if (!id) return;
    let next: Next;
    let outcome: string;
    try {
      const a = await callApp<TickAnswer>(this.env, "/api/cf/thesis/tick", { id }, 60_000);
      next = nextAfter(a, new Date());
      outcome = a.done ? `ticked${a.reason ? ` (${a.reason})` : ""}` : "slice done, more to run";
      this.setState({ ...this.state, thesisId: id, lastTickAt: new Date().toISOString(), failures: 0, ticks: this.state.ticks + 1 });
    } catch (e) {
      const failures = this.state.failures + 1;
      next = afterFailure(failures, e instanceof AppError && e.permanent);
      outcome = e instanceof AppError ? `YouBank answered ${e.status}` : "YouBank did not answer";
      this.setState({ ...this.state, thesisId: id, failures });
    }
    this.sql`insert into ticks (at, outcome, ms) values (${new Date().toISOString()}, ${outcome}, ${Date.now() - t0})`;
    this.sql`delete from ticks where rowid not in (select rowid from ticks order by rowid desc limit 500)`;
    await this.plan(id, next);
  }

  private async plan(thesisId: number, next: Next) {
    if (next.kind === "stop") { await this.stop(next.why); return; }
    const when = next.kind === "at" ? next.when : new Date(Date.now() + next.delaySec * 1000);
    await this.schedule(next.kind === "at" ? next.when : next.delaySec, "tick", { thesisId });
    this.setState({ ...this.state, status: "scheduled", nextAt: when.toISOString(), why: null });
  }

  private async clear() {
    for (const s of await this.listSchedules()) await this.cancelSchedule(s.id);
  }
}
