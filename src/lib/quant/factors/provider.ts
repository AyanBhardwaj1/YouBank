/**
 * Registers Q1's factors with the integrity checker (Q3's factor-adjusted alpha) without the checker importing
 * the factor engine. Imported for its side effect by the routes and AI tools that run integrity checks.
 */
import { setFactorProvider } from "../integrity/check";
import { factorPanel } from "./read";

setFactorProvider(async (dates) => {
  if (!dates.length) return null;
  const p = await factorPanel(dates[0]);
  const at = new Map(p.dates.map((d, i) => [d, p.rows[i]]));
  // Days the factors do not cover (a holiday in one calendar but not the other) count as zero factor returns, as
  // long as they are under 5% of the series; otherwise the alpha is not computed.
  const covered = dates.filter((d) => at.has(d)).length;
  if (covered < 0.95 * dates.length) return null;
  const zero = p.names.map(() => 0);
  return { names: p.names, rows: dates.map((d) => at.get(d) ?? zero), source: `${p.source}${covered < dates.length ? `; ${dates.length - covered} uncovered days as zero` : ""}` };
});
