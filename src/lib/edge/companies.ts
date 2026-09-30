/**
 * Who owns what: the operators named in public asset maps (EIA's pipelines and processing plants),
 * matched to the listed parent a person would watch. Curated from public deal announcements as of
 * September 2026; an operator not listed here keeps its own name and no ticker rather than a guess.
 * Every match carries its basis, which the audit trail and the cards show.
 */
export type Parent = { company: string; ticker: string; basis: string };

type Rule = { match: RegExp } & Parent;

const RULES: Rule[] = [
  { match: /^(energy transfer|etc |etc$|transwestern|oasis pipeline|southern union gas|trans pecos|comanche trail)/i, company: "Energy Transfer", ticker: "ET", basis: "subsidiary or operated line" },
  { match: /^(west texas gas|wtg )/i, company: "Energy Transfer", ticker: "ET", basis: "WTG Midstream, acquired July 2024" },
  { match: /^(kinder morgan|el paso natural gas|el paso texas pipeline|gulf coast express|natural gas pl co of am)/i, company: "Kinder Morgan", ticker: "KMI", basis: "subsidiary or operated line (NGPL and Gulf Coast Express are joint ventures it operates)" },
  { match: /^(oneok|roadrunner)/i, company: "ONEOK", ticker: "OKE", basis: "subsidiary or operated joint venture" },
  { match: /^(enlink|coronado midstream)/i, company: "ONEOK", ticker: "OKE", basis: "EnLink, acquired January 2025 (Coronado via EnLink, 2015)" },
  { match: /^medallion/i, company: "ONEOK", ticker: "OKE", basis: "Medallion, acquired October 2024" },
  { match: /^targa/i, company: "Targa Resources", ticker: "TRGP", basis: "subsidiary" },
  { match: /^agave energy/i, company: "Targa Resources", ticker: "TRGP", basis: "via Lucid Energy, acquired 2022" },
  { match: /^enterprise (field services|products)/i, company: "Enterprise Products", ticker: "EPD", basis: "subsidiary" },
  { match: /^dcp /i, company: "Phillips 66", ticker: "PSX", basis: "DCP Midstream, consolidated 2023" },
  { match: /^eagleclaw/i, company: "Kinetik", ticker: "KNTK", basis: "EagleClaw, combined into Kinetik 2022" },
  { match: /^(oxy|occidental)/i, company: "Occidental", ticker: "OXY", basis: "subsidiary" },
  { match: /^chevron/i, company: "Chevron", ticker: "CVX", basis: "subsidiary" },
  { match: /^conocophillips/i, company: "ConocoPhillips", ticker: "COP", basis: "operator" },
  { match: /^xto energy/i, company: "ExxonMobil", ticker: "XOM", basis: "subsidiary" },
  { match: /^transcontinental gas/i, company: "Williams", ticker: "WMB", basis: "subsidiary (Transco)" },
  { match: /^northern natural gas/i, company: "Berkshire Hathaway", ticker: "BRK.B", basis: "subsidiary (Berkshire Hathaway Energy)" },
  { match: /^texas gas transmission/i, company: "Loews", ticker: "L", basis: "via Boardwalk Pipelines" },
  { match: /^atmos/i, company: "Atmos Energy", ticker: "ATO", basis: "subsidiary" },
  { match: /^public service co of nm/i, company: "TXNM Energy", ticker: "TXNM", basis: "subsidiary (PNM)" },
];

/** The listed parent of an operator, or null when the operator is private or not yet mapped. Pure, for tests. */
export function parentOf(operator: string): Parent | null {
  const o = operator.trim();
  if (!o) return null;
  const r = RULES.find((x) => x.match.test(o));
  return r ? { company: r.company, ticker: r.ticker, basis: r.basis } : null;
}

/** The companies Edge can map assets for, for pickers. */
export const MAPPED_COMPANIES: { company: string; ticker: string }[] = [...new Map(RULES.map((r) => [r.ticker, { company: r.company, ticker: r.ticker }])).values()]
  .sort((a, b) => a.company.localeCompare(b.company));

/** Where the matches come from, for the audit trail. */
export const PARENT_MAP_SOURCE = { name: "YouBank parent-company map (curated from public deal announcements, September 2026)", url: "", license: "YouBank" };
