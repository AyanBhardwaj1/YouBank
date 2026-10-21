/**
 * What a screen's source badge says, from the x-data-sources header (source-header.ts): the sources
 * that answered, the credit each requires (word for word), "Your key", "Backup source", "Delayed",
 * "Stale · as of", the fields filled from another source or left empty with the reason, and the sources
 * the person asked for that could not answer. Pure and dependency-free (the browser renders it; tests
 * read it).
 */
import type { SourcesHeader } from "./source-header";
import { etClock } from "./units";

export type BadgeTone = "muted" | "info" | "warn" | "ai" | "key";
export type Chip = { text: string; tone: BadgeTone; title?: string };
export type BadgeModel = { names: string[]; chips: Chip[]; attributions: string[]; fieldNotes: string[]; skipped: string[]; notes: string[] };

/** The providers that count as backups for YouBank's FMP plan: a screen that used any of them says so. */
export const BACKUP_PROVIDERS = ["Nasdaq", "ECB", "CoinGecko", "SEC EDGAR", "AI research"];

/** "price" -> "Price", "marketCap" -> "Market cap", "profile.low52" -> "52-week low". Pure. */
const FIELD_NAMES: Record<string, string> = {
  price: "Price", changePct: "Change", marketCap: "Market cap", low52: "52-week low", high52: "52-week high", description: "Description", website: "Website",
  sector: "Sector", industry: "Industry", name: "Name", exchange: "Exchange", next: "Next report", annual: "Annual estimates", quarters: "Reported quarters",
  epsEstimated: "EPS estimates", target: "Price target", counts: "Rating counts", firms: "Rating changes", payDate: "Pay dates", exDate: "Ex-dividend dates",
};
export const fieldName = (key: string) => { const f = key.includes(".") ? key.slice(key.indexOf(".") + 1) : key; return FIELD_NAMES[f] ?? f; };

/** The names of the sources that answered, as people read them (the registry adapter's label when sent). Pure. */
export function answeredNames(s?: Pick<SourcesHeader, "providers" | "sources">): string[] {
  const labelOf = (p: string) => s?.sources?.find((x) => x.provider === p)?.label ?? p;
  return [...new Set((s?.providers ?? []).map(labelOf))];
}

function chipsOf(s: SourcesHeader): Chip[] {
  const out: Chip[] = [];
  if (s.yourKey) out.push({ text: "Your key", tone: "key", title: "Fetched with your own data key: shown only to you, never shared or exported" });
  const backups = s.providers.filter((p) => BACKUP_PROVIDERS.includes(p));
  const ai = backups.includes("AI research");
  if (backups.length) out.push({ text: ai ? "Backup source, partly researched by AI" : "Backup source", tone: ai ? "ai" : "info", title: `${s.providers.includes("FMP") ? "Some of this" : "This"} came from ${backups.join(", ")} because the first source was unavailable` });
  if (s.delayed) out.push({ text: s.delayedMinutes ? `Delayed ${s.delayedMinutes} min` : "Delayed", tone: "info", title: "Prices from this feed are not real time" });
  if (s.stale) { const clock = s.asOf ? etClock(s.asOf) : ""; out.push({ text: clock ? `Stale · as of ${clock}` : "Stale", tone: "warn", title: s.asOf ? `Last updated ${s.asOf.slice(0, 16).replace("T", " ")} UTC` : "Behind the market" }); }
  if (s.sources?.some((x) => x.licence === "unverified")) out.push({ text: "Terms unverified", tone: "muted", title: "A source here has no confirmed licence for a commercial product (see Settings → Data sources)" });
  return out;
}

/** The badge for an answer's sources, or null when no source was noted. Pure. */
export function badgeModel(s?: SourcesHeader): BadgeModel | null {
  const names = answeredNames(s);
  if (!s || !names.length) return null;
  const fieldNotes = Object.entries(s.fields ?? {}).map(([k, p]) => ("reason" in p ? `${fieldName(k)}: — ${p.reason}` : `${fieldName(k)} from ${p.label}${p.yourKey ? " (your key)" : ""}`));
  const skipped = (s.skipped ?? []).map((k) => `${k.label} skipped: ${k.reason}`);
  return { names, chips: chipsOf(s), attributions: s.attributions ?? [], fieldNotes, skipped, notes: s.notes ?? [] };
}
