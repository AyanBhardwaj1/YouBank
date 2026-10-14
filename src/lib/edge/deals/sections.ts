/**
 * Finding the sections of a merger document that hold its terms (E1, step 1 of extraction), so no full
 * proxy (often 1 to 5 MB) is ever sent to a model: one call reads one section, about 6 to 12 thousand
 * tokens. Sections are found by their headings in the parsed parts (docs/html.ts keeps headings and whole
 * tables), choosing the longest occurrence of a heading so the table of contents and the summary's
 * cross-references ("Opinion of Lazard (page 52)") lose to the section itself. Where no heading matches,
 * keyword windows around the terms that state a field stand in, marked as such (a field read from a
 * keyword window starts at a lower confidence). A section that cannot be found leaves its fields blank
 * rather than guessed. Pure, tested on saved proxies (scripts/fixtures/deals/).
 */
import type { Part } from "../docs/chunk";
import type { SectionKey } from "./fields";

export type DocKind = "proxy" | "tender" | "s4" | "agreement" | "press";

/** Headings that start each section, by document kind. Ordered: the first pattern is the most specific. */
const HEADINGS: Record<SectionKey, RegExp[]> = {
  summary: [/^summary( term sheet)?$/i, /^summary of the (merger|offer|transaction)/i, /^questions and answers about the/i],
  parties: [/^(the )?parties (to the merger|to the transaction|involved in the merger)/i, /^information about the (companies|parties)/i, /^the companies$/i, /^parties to the merger agreement/i],
  consideration: [/^(the )?merger consideration$/i, /^consideration (to be received|for the shares|to the [a-z]+ stockholders)/i, /^effect of the merger on (the )?(capital stock|common stock)/i, /^(the )?offer price$/i, /^conversion of (shares|securities)/i, /^effect on capital stock/i],
  background: [/^background of the (merger|offer|transaction|mergers|proposed merger)/i, /^background$/i],
  reasons: [/^(the )?reasons for the (merger|offer|transaction)/i, /^recommendation of (the|our) board/i, /reasons for the recommendation/i],
  opinion: [/^opinions? of .{3,80}$/i, /^opinion of (the company's|our) financial advis[eo]r/i, /^fairness opinion/i],
  projections: [/^(certain )?(unaudited )?(prospective )?financial (information|projections|forecasts)/i, /^(certain )?(management|company) (projections|forecasts)/i, /^projected financial information/i],
  financing: [/^financing of the (merger|offer|transaction)/i, /^(debt |equity )?financing$/i, /^source and amount of funds/i],
  termination: [/^termination fees?\b/i, /^(expenses and )?termination fees?/i, /^termination of the merger agreement/i, /^termination$/i, /^go[- ]shop/i, /^no solicitation/i],
  approvals: [/^regulatory approvals? (required|for the merger)/i, /^(antitrust|regulatory) (approvals|matters|clearances)/i, /^regulatory approvals$/i],
  agreement_parties: [/^agreement and plan of merger$/i],
  press: [/^(about|forward[- ]looking statements)/i],
};

/** Terms that state each section's facts, for the keyword windows when no heading is found. */
const TERMS: Record<SectionKey, RegExp> = {
  summary: /merger consideration|termination fee|per share in cash/i,
  parties: /is a (leading|[a-z]+) (provider|company|producer|operator)|headquartered in|principal executive offices/i,
  consideration: /per share in cash|without interest|exchange ratio|merger consideration/i,
  background: /confidentiality agreement|indication of interest|non-binding proposal|first contacted/i,
  reasons: /reasons for the merger|in reaching its determination/i,
  opinion: /discounted cash flow|selected (public )?companies|selected (precedent )?transactions|implied (per share )?(equity )?value/i,
  projections: /projections|forecasts|EBITDA/i,
  financing: /commitment letter|debt financing|equity commitment/i,
  termination: /termination fee|go[- ]shop|reverse termination/i,
  approvals: /hart-scott-rodino|HSR Act|CFIUS|second request|FERC/i,
  agreement_parties: /agreement and plan of merger|merger sub/i,
  press: /premium|enterprise value|synergies|advis[eo]r/i,
};

/** Which sections each kind of document is read for. */
export const SECTIONS_BY_KIND: Record<DocKind, SectionKey[]> = {
  proxy: ["summary", "parties", "consideration", "background", "reasons", "opinion", "projections", "financing", "termination", "approvals"],
  tender: ["summary", "parties", "background", "reasons", "opinion", "projections", "financing", "termination", "approvals"],
  s4: ["summary", "parties", "consideration", "background", "reasons", "opinion", "projections", "termination", "approvals"],
  agreement: ["agreement_parties", "consideration", "termination", "approvals"],
  press: ["press"],
};

/** A form's document kind. Pure. */
export function docKindOf(form: string, fileType = ""): DocKind | null {
  const f = form.toUpperCase();
  if (/^DEFM14[AC]$|^PREM14[AC]$/.test(f)) return "proxy";
  if (/^SC 14D9|^SC TO-T/.test(f)) return "tender";
  if (/^S-4/.test(f)) return "s4";
  if (/^8-K/.test(f) && /EX-2\.1/i.test(fileType)) return "agreement";
  if (/^8-K/.test(f) && /EX-99/i.test(fileType)) return "press";
  return null;
}

export type Located = { key: SectionKey; heading: string; text: string; via: "heading" | "keywords"; chars: number };

/** One part as text: a table row by row ("Midstream | $3,164 | $2,910"), with its units line. Pure. */
export function partText(p: Part): string {
  if (p.kind === "table") return `${p.units ? `${p.units}\n` : ""}${p.rows.map((r) => r.filter(Boolean).join(" | ")).join("\n")}`;
  return p.text;
}

/** Whether a part is a heading that starts a section, and which. Pure. */
export function headingKey(text: string, keys: SectionKey[]): SectionKey | null {
  const t = text.replace(/\s+/g, " ").replace(/[.:]+$/, "").trim();
  if (t.length > 120) return null;
  // A cross-reference ("Opinion of Lazard (page 52)") names a section, it does not start one.
  if (/\(\s*(?:see\s+)?page\s+\d+\s*\)\s*$/i.test(t) || /\s\d{1,3}$/.test(t)) return null;
  for (const k of keys) if (HEADINGS[k].some((re) => re.test(t))) return k;
  return null;
}

/** Every known heading's pattern, so a section ends where the next known section starts. */
const ALL_KEYS = Object.keys(HEADINGS) as SectionKey[];

/**
 * The sections of a parsed document: for each wanted key, the longest run of parts from a matching heading
 * to the next known heading (capped at `maxChars`), or keyword windows when no heading matches. Pure.
 */
export function locateSections(parts: Part[], wanted: SectionKey[], opts: { maxChars?: number; minChars?: number; window?: number } = {}): Located[] {
  const maxChars = opts.maxChars ?? 45_000, minChars = opts.minChars ?? 120, windowChars = opts.window ?? 2_500;
  const starts: { i: number; key: SectionKey; heading: string }[] = [];
  parts.forEach((p, i) => {
    if (p.kind !== "heading" && !(p.kind === "text" && p.text.length <= 120)) return;
    const k = headingKey(p.text, ALL_KEYS);
    if (k) starts.push({ i, key: k, heading: p.text.trim() });
  });
  const out: Located[] = [];
  for (const key of wanted) {
    let best: Located | null = null;
    for (const [n, s] of starts.entries()) {
      if (s.key !== key) continue;
      const end = starts[n + 1]?.i ?? parts.length;
      let text = "";
      for (let i = s.i + 1; i < end && text.length < maxChars; i++) text += `${partText(parts[i])}\n`;
      text = text.slice(0, maxChars).trim();
      if (text.length >= minChars && (!best || text.length > best.chars)) best = { key, heading: s.heading, text, via: "heading", chars: text.length };
    }
    if (!best) {
      // No heading: windows of text around the terms that state this section's facts.
      const all = parts.map(partText);
      const hits: string[] = [];
      let used = 0;
      for (let i = 0; i < all.length && used < maxChars / 3; i++) {
        if (!TERMS[key].test(all[i])) continue;
        const w = [all[i - 1] ?? "", all[i], all[i + 1] ?? ""].join("\n").slice(0, windowChars);
        if (hits.some((h) => h.includes(all[i]))) continue;
        hits.push(w); used += w.length;
      }
      const text = hits.join("\n…\n").slice(0, maxChars);
      if (text.length >= minChars / 2) best = { key, heading: "", text, via: "keywords", chars: text.length };
    }
    if (best) out.push(best);
  }
  return out;
}
