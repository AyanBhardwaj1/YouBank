/**
 * The Voice Analyst (E13): what a spoken question asks for, and the short script read back. Speech is
 * recognised in the browser (its own recognition; the free path) or by the premium realtime session; either
 * way the words arrive here as text. Pure: rules map an utterance to one of Edge's tools (the Thesis Agent's
 * registry plus the feed, the person's theses, a document question and a voice note), with the companies it
 * names; the script writer keeps answers short enough to hear, says when something is uncertain or not found
 * in the same wording as Strict, and keeps citations on screen. Edge never sends anything by voice: a "send"
 * or "email" intent becomes a note to review.
 */

export type Intent = "odds" | "pulse" | "precedents" | "company" | "feed" | "thesis" | "note" | "send" | "ask";
export type Routed = { intent: Intent; names: string[]; tickers: string[]; note?: string; question: string; reason: string };

const TICKER_TOKEN = /\b([A-Z]{1,5})(?:\.[A-Z])?\b/g;
const STOP_TICKERS = new Set(["I", "A", "THE", "AND", "OR", "OF", "US", "IT", "IS", "ON", "AT", "IN", "TO", "FOR", "WHAT", "HOW", "WHO", "CEO", "CFO", "EPS", "EV", "IPO", "M", "Q", "Q1", "Q2", "Q3", "Q4", "AI", "OK", "VS", "UK", "EU", "LBO", "IRR", "PE", "MY", "ME", "WARN", "SEC", "ESG", "USD", "GDP", "CPI", "FED", "NOTE"]);
const NAME = /\b(?:odds|chances?|at|for|on|about|of|is|does|did|will|would|could|from|with|buy|buys|sell|sells|acquire|acquires)\s+((?:[A-Z][a-zA-Z&'’.\-]+)(?:\s+(?:[A-Z][a-zA-Z&'’.\-]+|&|and)){0,3})/g;
const NOT_NAMES = new Set(["Edge", "I", "Me", "My", "The", "This", "That", "What", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday", "Today", "Tomorrow", "Yesterday"]);

/** Tickers spoken or typed in capitals ("TRGP") and company names after a preposition ("at Targa"). Pure. */
export function companiesIn(text: string): { tickers: string[]; names: string[] } {
  const tickers = [...new Set([...text.matchAll(TICKER_TOKEN)].map((m) => m[1]).filter((t) => t.length >= 2 && !STOP_TICKERS.has(t)))];
  const names = [...new Set([...text.matchAll(NAME)].map((m) => m[1].replace(/[’']s$/, "").replace(/\s+(?:and|&)$/, "").trim()).filter((n) => n.length >= 3 && !NOT_NAMES.has(n.split(/\s+/)[0]) && !tickers.includes(n)))];
  return { tickers, names };
}

const RULES: [Intent, RegExp, string][] = [
  ["send", /\b(?:send|email|e-mail|text|message|reply to)\b(?! me)/i, "asked to send something (Edge never sends by voice)"],
  ["note", /^\s*(?:note|add a note|make a note|remember)\b/i, "a voice note"],
  ["company", /^\s*(?:tell me about|what(?:'s| is) (?:going on|happening|new) (?:at|with)|overview of|brief me on|how is(?! my\b))\b/i, "a company overview"],
  ["feed", /\b(?:digest|brief(?:ing)?|my feed|what(?:'s| is) new|what changed (?:today|this week|overnight)|read me|anything new|catch me up)\b/i, "the feed and digest"],
  ["thesis", /\b(?:thes[ie]s|my thesis|kill criteri)/i, "your theses"],
  ["odds", /\b(?:odds|chance|probability|likely|likelihood)\b.*\b(?:sold|sale|acquired|bought|takeover|target|in play|deal)\b|\b(?:in play|sale odds|deal radar|takeover odds)\b/i, "sale odds (Deal Radar)"],
  ["precedents", /\b(?:precedents?|comparable deals?|deals like|comps? for a deal|what (?:did|do) (?:buyers|acquirers) pay|ev ?\/ ?ebitda|multiples? (?:paid|for deals))\b/i, "precedent deals"],
  ["pulse", /\b(?:hiring|jobs?|postings?|headcount|layoffs?|warn notices?|patents?|web traffic|attention|pulse|federal (?:awards?|contracts?))\b/i, "alternative data (Pulse)"],
];

/** The intent of an utterance and the companies it names. Pure. */
export function routeUtterance(text: string): Routed {
  const t = text.trim().replace(/\s+/g, " ");
  const { tickers, names } = companiesIn(t);
  for (const [intent, re, reason] of RULES) {
    if (!re.test(t)) continue;
    if (intent === "note") {
      const m = /^\s*(?:note|add a note|make a note|remember)\s+(?:on|about|for|that)?\s*([^:,.-]+?)\s*[:,.-]\s*(.+)$/i.exec(t);
      return { intent, names: m ? [m[1].trim()] : names, tickers, note: (m?.[2] ?? t).slice(0, 1000), question: t, reason };
    }
    return { intent, names, tickers, question: t, reason };
  }
  return { intent: "ask", names, tickers, question: t, reason: "a question for your documents and filings (Strict)" };
}

export type Citation = { label: string; url?: string };

const WORDS = 70;
/** At most about 70 words (a 25-second answer), cut at a sentence. Pure. */
export function trimScript(s: string, max = WORDS): string {
  const words = s.replace(/\s+/g, " ").trim().split(" ");
  if (words.length <= max) return words.join(" ");
  const cut = words.slice(0, max).join(" ");
  const end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("? "));
  return end > 40 ? cut.slice(0, end + 1) : `${cut}…`;
}

const pct = (v: number | null | undefined, dp = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "unknown" : `${(v * 100).toFixed(dp)} percent`);

/** The spoken script for a tool's answer. Uncertain and missing answers say so in Strict's words. Pure. */
export function scriptFor(intent: Intent, d: Record<string, unknown> | null, who = ""): string {
  if (!d) return trimScript(`I could not find that${who ? ` for ${who}` : ""} in Edge. Nothing in the data in scope answers it.`);
  switch (intent) {
    case "odds": {
      if (d.p === null || d.p === undefined) return `${who || "That company"} is not scored by the Deal Radar.`;
      return trimScript(`The Deal Radar gives ${who} a ${pct(d.p as number)} model probability of announcing an agreement to be acquired within twelve months, against a ${pct(d.base as number, 1)} sector base rate. The interval is ${pct(d.low as number)} to ${pct(d.high as number)}. It is a statistical estimate from public filings, not a rumour or advice.`);
    }
    case "pulse": case "precedents": case "company": return trimScript(String(d.text ?? "I have nothing stored on that yet."));
    case "feed": {
      const items = (d.items as { title: string }[] | undefined) ?? [];
      return items.length ? trimScript(`${items.length} things for you. ${items.slice(0, 3).map((x, i) => `${i + 1}: ${x.title}.`).join(" ")}`) : "Nothing new at what you watch.";
    }
    case "thesis": {
      const list = (d.items as { title: string; overall: number | null; status: string }[] | undefined) ?? [];
      return list.length ? trimScript(list.slice(0, 3).map((x) => `${x.title}: ${x.overall === null ? "no estimate yet" : `${pct(x.overall)} agent estimate`}, ${x.status}.`).join(" ")) : "You have no theses yet.";
    }
    case "note": return trimScript(String(d.text ?? "Noted."));
    case "send": return "I never send anything by voice. I kept what you said as a note for you to review and send yourself.";
    case "ask": return trimScript(d.notFound ? "The documents do not answer this." : String(d.text ?? ""));
  }
}
