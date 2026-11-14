/**
 * How new a finding is, for the "New" and "Updated" marks on cards and markers. Pure, shared by the
 * server and the browser (scripts/test-edge-globe.ts).
 */
const HOUR = 3_600_000;
export const NEW_HOURS = 6;
export const UPDATED_HOURS = 3;

/** "new" when found in the last six hours, "updated" when its numbers moved in the last three, else null. Pure. */
export function freshness(detectedAt: string, updatedAt: string | null | undefined, now: number): "new" | "updated" | null {
  const found = Date.parse(detectedAt);
  if (Number.isFinite(found) && now - found >= 0 && now - found < NEW_HOURS * HOUR) return "new";
  const moved = updatedAt ? Date.parse(updatedAt) : NaN;
  if (Number.isFinite(moved) && now - moved >= 0 && now - moved < UPDATED_HOURS * HOUR && moved - found > 10 * 60_000) return "updated";
  return null;
}

/** "12 minutes ago", "3 hours ago", "2 days ago". Pure. */
export function agoWords(iso: string | null | undefined, now: number): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "not yet";
  const m = Math.max(0, Math.round((now - t) / 60_000));
  if (m < 1) return "just now";
  if (m < 60) return `${m} minute${m === 1 ? "" : "s"} ago`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h} hour${h === 1 ? "" : "s"} ago`;
  const d = Math.round(h / 24);
  return `${d} days ago`;
}

/** Ids present now that were not in the first load of a view: the cards that arrived while it was open. Pure. */
export function arrived(first: Set<number>, now: number[]): number[] {
  return now.filter((id) => !first.has(id));
}
