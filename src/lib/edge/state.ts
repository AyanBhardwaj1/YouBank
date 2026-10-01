/**
 * A person's Edge as the workspace opens with it: whether the beta is on, their watches and limits, and
 * what they can watch. Read by the Edge API and by the page itself (so the first paint needs no extra
 * request).
 */
import { MONITOR_LIMIT, WATCH_LIMIT, type Blend } from "./access";
import { companiesIn, ensureMaps } from "./assets";
import { PLACES } from "./sources/eia";
import { COVERED, listWatches } from "./watches";
import { memo } from "@/lib/memo";

export async function edgeState(userId: string, beta: boolean, since: string | null, blend: Blend) {
  // An empty list is not kept (the loader throws), so a fresh database's first load does not stick.
  const companies = () => memo("edge:companies:permian", 10 * 60_000, async () => {
    await ensureMaps();
    const list = await companiesIn(PLACES.permian.bbox);
    if (!list.length) throw new Error("no mapped companies yet");
    return list;
  }).catch(() => []);
  const [watches, list] = beta ? await Promise.all([listWatches(userId), companies()]) : [[], []];
  return {
    beta, since, blend, limits: { watches: WATCH_LIMIT, monitors: MONITOR_LIMIT }, watches, companies: list,
    places: Object.entries(PLACES).map(([key, v]) => ({ key, name: v.name, bbox: v.bbox })), covered: COVERED,
  };
}
