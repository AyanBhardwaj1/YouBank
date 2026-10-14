/**
 * The Thesis Agent's (E7) kill criteria, checked every tick: each is a typed monitor read against one of the
 * agent's tools (sale odds crossing a line, a signal series falling or rising by a share over some weeks, a new
 * Pulse finding of a kind, a deal announced for the company). Pure: the tick fetches the data, this decides.
 */
import type { KillState, Monitor } from "./types";

export type MonitorData =
  | { tool: "deal_odds"; p: number | null }
  | { tool: "series"; points: { period: string; value: number }[] }
  | { tool: "pulse"; findings: { kind: string; title: string; observedAt: string | null }[] }
  | { tool: "deal"; events: { role: "target" | "acquirer"; announced: string; counterparty: string }[] };

/** Whether a monitor fired, its current value and the reason in words. `since` is when the thesis was approved. Pure. */
export function evalMonitor(m: Monitor, d: MonitorData | null, since: string): Pick<KillState, "status" | "value" | "detail"> {
  if (!d || d.tool !== m.tool) return { status: "unavailable", value: null, detail: "no data from the tool yet" };
  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  switch (m.tool) {
    case "deal_odds": {
      const p = (d as Extract<MonitorData, { tool: "deal_odds" }>).p;
      if (p === null) return { status: "unavailable", value: null, detail: `${m.ticker} is not scored by the Deal Radar` };
      const fired = m.op === ">=" ? p >= m.value : p <= m.value;
      return { status: fired ? "fired" : "watching", value: p, detail: `${m.ticker}'s 12-month sale odds ${pct(p)} (line ${m.op} ${pct(m.value)})` };
    }
    case "series": {
      const pts = (d as Extract<MonitorData, { tool: "series" }>).points;
      if (pts.length < m.weeks + 1) return { status: "unavailable", value: null, detail: `fewer than ${m.weeks + 1} weeks of ${m.metric}` };
      const last = pts[pts.length - 1].value, then = pts[pts.length - 1 - m.weeks].value;
      if (!(then > 0)) return { status: "unavailable", value: null, detail: `${m.metric} was zero ${m.weeks} weeks ago` };
      const change = last / then - 1;
      const fired = m.op === "drop" ? change <= -m.value : change >= m.value;
      return { status: fired ? "fired" : "watching", value: change, detail: `${m.ticker} ${m.metric} ${change >= 0 ? "+" : ""}${pct(change)} over ${m.weeks} weeks (line: ${m.op} of ${pct(m.value)})` };
    }
    case "pulse": {
      const hits = (d as Extract<MonitorData, { tool: "pulse" }>).findings.filter((f) => f.kind === m.kind && (f.observedAt ?? "") >= since.slice(0, 10));
      return { status: hits.length ? "fired" : "watching", value: hits.length, detail: hits.length ? `new ${m.kind.replace(/_/g, " ")}: ${hits[0].title}` : `no new ${m.kind.replace(/_/g, " ")} for ${m.ticker} since ${since.slice(0, 10)}` };
    }
    case "deal": {
      const hits = (d as Extract<MonitorData, { tool: "deal" }>).events.filter((e) => e.role === m.role && e.announced >= since.slice(0, 10));
      return { status: hits.length ? "fired" : "watching", value: hits.length, detail: hits.length ? `${m.ticker} announced as ${m.role} on ${hits[0].announced}${hits[0].counterparty ? ` (${hits[0].counterparty})` : ""}` : `no deal with ${m.ticker} as ${m.role} since ${since.slice(0, 10)}` };
    }
  }
}
