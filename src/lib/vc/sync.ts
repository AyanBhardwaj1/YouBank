import { upsertStartups } from "./directory";
import { fetchYc } from "./sources/yc";
import { fetchA16z } from "./sources/a16z";
import { fetchShowHn } from "./sources/hn";
import { fetchFormDDays } from "./sources/formd";
import { fetchThiel } from "./sources/thiel";

export type SyncSource = "yc" | "a16z" | "hn" | "formd" | "thiel";

/** Run one source. `days` bounds the time-based feeds (Show HN, Form D). */
export async function runSync(source: SyncSource, days = 2): Promise<{ source: SyncSource; written: number; ms: number }> {
  const t0 = Date.now();
  const rows = source === "yc" ? await fetchYc() : source === "a16z" ? await fetchA16z() : source === "hn" ? await fetchShowHn(days) : source === "formd" ? await fetchFormDDays(days) : await fetchThiel();
  const written = await upsertStartups(rows);
  return { source, written, ms: Date.now() - t0 };
}
