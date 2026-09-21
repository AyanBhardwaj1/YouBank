/**
 * Venture capital tool pack. Authored from docs/research/vc-pe.md: thesis-driven sourcing across YouBank's
 * startup directory (YC, a16z, Thiel Fellowship, Show HN, SEC Form D, web discovery), diligence and memo
 * deliverables, term sheet review against the NVCA standard, and the deterministic private-markets math
 * (post- and pre-money SAFE conversion, option pool shuffle, preference waterfalls, venture method, fund model).
 */
import { bool, fmt, list, num, str, type Inputs, type ToolDef, type WorkflowOutput } from "../types";

/* ======================================================================================
 * Shared helpers
 * ====================================================================================== */

type Safe = { name: string; amount: number; cap: number; kind: "post" | "pre"; discount: number };

const cleanNum = (s: string | undefined, fallback = 0): number => {
  const raw = String(s ?? "").replace(/[$,%x\s]/gi, "");
  if (raw === "") return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
};

/** One SAFE per line: "name, amount ($mm), cap ($mm), post|pre, discount %". */
function parseSafes(text: string): Safe[] {
  return text
    .split(/\n+/)
    .map((l) => l.trim())
    .filter((l) => l !== "" && !/^name\b/i.test(l))
    .map((l, k) => {
      const p = l.split(/[,;\t|]/).map((s) => s.trim());
      const name = p[0] || `SAFE ${k + 1}`;
      const amount = cleanNum(p[1]), cap = cleanNum(p[2]);
      if (!(amount > 0) || !(cap > 0)) throw new Error(`SAFE "${name}": amount and valuation cap must be positive numbers in $mm. Line: "${l}"`);
      return { name, amount, cap, kind: /pre/i.test(p[3] ?? "post") ? ("pre" as const) : ("post" as const), discount: Math.min(0.9, Math.max(0, cleanNum(p[4]) / 100)) };
    });
}

type PricedRound = { post: number; pps: number; poolTopUp: number; fdPre: number; fdPost: number; capForSafes: number; newShares: number; safeRows: { name: string; amount: number; price: number; shares: number; kind: "post" | "pre" }[] };

/**
 * Price a round with a stacked SAFE conversion and an option pool sized as a percentage of the post-money
 * fully diluted count and created inside the pre-money (the option pool shuffle). Share counts in millions.
 * Post-money SAFEs: shares = amount / (cap / capitalisation), where capitalisation includes common, the
 * existing unissued pool and every converting SAFE and excludes the new pool increase and the new money
 * (YC post-money safe). Pre-money SAFEs: price = cap / (common + existing pool + top-up), so pre-money SAFE
 * holders dilute one another. Discount SAFEs convert at the lower of the cap price and price x (1 - discount).
 * Solved as a fixed point because the pool top-up, the price per share and the SAFE shares are interdependent.
 */
function priceRound(o: { common: number; pool: number; safes: Safe[]; pre: number; newMoney: number; poolTarget: number }): PricedRound {
  const c0 = o.common + o.pool;
  if (!(c0 > 0)) throw new Error("Existing common shares plus the unissued option pool must be positive (millions of shares).");
  if (!(o.pre > 0)) throw new Error("Pre-money valuation must be positive ($mm).");
  if (o.newMoney < 0) throw new Error("New money cannot be negative.");
  if (o.poolTarget < 0 || o.poolTarget >= 0.9) throw new Error("Post-money option pool must be between 0% and 90%.");
  const post = o.pre + o.newMoney;
  if (o.pre - o.poolTarget * post <= 0) throw new Error("The post-money pool target is too large for this pre-money: the top-up cannot be created inside the pre-money.");
  const fPost = o.safes.filter((s) => s.kind === "post").reduce((a, s) => a + s.amount / s.cap, 0);
  if (fPost >= 0.9) throw new Error(`Post-money SAFEs would convert into ${fmt.pct(fPost, 0)} of the company; check the amounts and caps.`);
  let x = 0, pps = o.pre / c0, capForSafes = c0;
  for (let k = 0; k < 60; k++) {
    let sPre = 0;
    for (const s of o.safes) if (s.kind === "pre") sPre += s.amount / Math.min(s.cap / (c0 + x), s.discount > 0 ? pps * (1 - s.discount) : Infinity);
    let t = c0 + sPre;
    for (let j = 0; j < 60; j++) {
      let sPost = 0;
      for (const s of o.safes) if (s.kind === "post") sPost += s.amount / Math.min(s.cap / t, s.discount > 0 ? pps * (1 - s.discount) : Infinity);
      t = c0 + sPre + sPost;
    }
    capForSafes = t;
    x = Math.max(0, (o.poolTarget * post * capForSafes - o.pool * o.pre) / (o.pre - o.poolTarget * post));
    pps = o.pre / (capForSafes + x);
  }
  const safeRows = o.safes.map((s) => {
    const price = Math.min(s.kind === "post" ? s.cap / capForSafes : s.cap / (c0 + x), s.discount > 0 ? pps * (1 - s.discount) : Infinity);
    return { name: s.name, amount: s.amount, price, shares: s.amount / price, kind: s.kind };
  });
  const fdPre = capForSafes + x, newShares = pps > 0 ? o.newMoney / pps : 0;
  return { post, pps, poolTopUp: x, fdPre, fdPost: fdPre + newShares, capForSafes, newShares, safeRows };
}

type Cls = { name: string; invested: number; shares: number; mult: number; part: boolean; cap: number; rank: number };

/** One class per line: "name, invested ($mm), shares (mm), preference x, participating y/n, cap x (0 = uncapped), seniority (1 = most senior)". */
function parseClasses(text: string): Cls[] {
  const rows = text.split(/\n+/).map((l) => l.trim()).filter((l) => l !== "" && !/^name\b/i.test(l));
  if (!rows.length) throw new Error("Enter at least one preferred class, one per line.");
  return rows.map((l, k) => {
    const p = l.split(/[,;\t|]/).map((s) => s.trim());
    const name = p[0] || `Class ${k + 1}`;
    const invested = cleanNum(p[1]), shares = cleanNum(p[2]);
    if (!(invested > 0) || !(shares > 0)) throw new Error(`Class "${name}": invested ($mm) and shares (mm) must both be positive. Line: "${l}"`);
    return { name, invested, shares, mult: cleanNum(p[3], 1) || 1, part: /^(y|t|1|part)/i.test(p[4] ?? "n"), cap: cleanNum(p[5], 0), rank: cleanNum(p[6], k + 1) || k + 1 };
  });
}

type Alloc = { pref: Record<string, number>; total: Record<string, number>; common: number; perShare: number; residual: number };

/** Pay preferences by seniority (pro rata within a rank), then share the residual, applying participation caps. */
function allocate(cls: Cls[], commonSh: number, dist: number, conv: Set<string>): Alloc {
  const pref: Record<string, number> = {}, part: Record<string, number> = {};
  let rem = Math.max(0, dist);
  const ranks = [...new Set(cls.filter((c) => !conv.has(c.name)).map((c) => c.rank))].sort((a, b) => a - b);
  for (const r of ranks) {
    const g = cls.filter((c) => !conv.has(c.name) && c.rank === r);
    const need = g.reduce((a, c) => a + c.mult * c.invested, 0);
    const paid = Math.min(rem, need);
    for (const c of g) pref[c.name] = need > 0 ? (paid * c.mult * c.invested) / need : 0;
    rem -= paid;
  }
  for (const c of cls) if (conv.has(c.name)) pref[c.name] = 0;
  let active = [
    { key: "__common", shares: commonSh, limit: Infinity },
    ...cls.filter((c) => conv.has(c.name)).map((c) => ({ key: c.name, shares: c.shares, limit: Infinity })),
    ...cls.filter((c) => !conv.has(c.name) && c.part).map((c) => ({ key: c.name, shares: c.shares, limit: c.cap > 0 ? Math.max(0, c.cap * c.invested - (pref[c.name] ?? 0)) : Infinity })),
  ].filter((a) => a.shares > 0);
  let pot = rem, perShare = 0;
  for (let k = 0; k <= active.length + 1; k++) {
    const sh = active.reduce((a, b) => a + b.shares, 0);
    if (sh <= 0) break;
    perShare = pot / sh;
    const over = active.find((a) => perShare * a.shares > a.limit + 1e-9);
    if (!over) { for (const a of active) part[a.key] = perShare * a.shares; break; }
    part[over.key] = over.limit; pot -= over.limit; active = active.filter((a) => a.key !== over.key);
  }
  const total: Record<string, number> = {};
  for (const c of cls) total[c.name] = (pref[c.name] ?? 0) + (part[c.name] ?? 0);
  return { pref, total, common: part["__common"] ?? 0, perShare, residual: rem };
}

/** Greedy conversion: convert the class that gains most by giving up its preference, until nobody gains. */
function runWaterfall(cls: Cls[], commonSh: number, dist: number): Alloc & { conv: Set<string> } {
  const conv = new Set<string>();
  for (let pass = 0; pass <= cls.length; pass++) {
    const base = allocate(cls, commonSh, dist, conv);
    let best: { name: string; gain: number } | null = null;
    for (const c of cls) {
      if (conv.has(c.name)) continue;
      const test = allocate(cls, commonSh, dist, new Set([...conv, c.name]));
      const gain = test.total[c.name] - base.total[c.name];
      if (gain > 1e-9 && (!best || gain > best.gain)) best = { name: c.name, gain };
    }
    if (!best) return { ...base, conv };
    conv.add(best.name);
  }
  return { ...allocate(cls, commonSh, dist, conv), conv };
}

/** IRR by bisection on annual cash flows (array index = year offset). */
function irr(cf: number[]): number | null {
  if (!cf.some((c) => c > 0) || !cf.some((c) => c < 0)) return null;
  const f = (r: number) => cf.reduce((a, c, k) => a + c / Math.pow(1 + r, k), 0);
  let lo = -0.9499, hi = 4;
  if (f(lo) * f(hi) > 0) return null;
  for (let k = 0; k < 200; k++) { const mid = (lo + hi) / 2; if (f(lo) * f(mid) <= 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

/** Bessemer good / better / best YoY growth by ARR band (docs/research/vc-pe.md section 4.1). */
function growthBand(arr: number): { band: string; good: number; better: number; best: number } {
  if (arr < 10) return { band: "$1-10M ARR", good: 1.0, better: 1.65, best: 2.3 };
  if (arr < 25) return { band: "$10-25M ARR", good: 0.87, better: 1.15, best: 1.35 };
  if (arr < 50) return { band: "$25-50M ARR", good: 0.77, better: 0.95, best: 1.1 };
  return { band: "$50-100M+ ARR", good: 0.6, better: 0.6, best: 0.8 };
}

const CITE = "Cite every private-company fact with the source id the tool returned; if a figure cannot be sourced, mark it \"not verified\" rather than estimating.";


/* ======================================================================================
 * AI workflows: sourcing and screening
 * ====================================================================================== */

const thesisSourcingMap: ToolDef = {
  kind: "ai", id: "thesis-sourcing-map", title: "Thesis-driven sourcing map", tagline: "Turn a written thesis into a segmented market map with every named company you could invest in.",
  description: "Converts a prose investment thesis into a sourcing run across YouBank's startup directory (YC, a16z, Thiel Fellowship, Show HN, SEC Form D, AI web discovery), then clusters the hits into segments and ranks each company on thesis fit and momentum signals. Produces the market map, the named long list with sources and links, the whitespace where nobody is building, and the five companies to call this week.",
  roles: ["vc"], category: "Sourcing & deals", icon: "Map", deliverable: "research", savesMinutes: 300, tags: ["sourcing", "market map", "thesis", "directory"],
  fields: [
    { key: "thesis", label: "Thesis", type: "textarea", required: true, placeholder: "What you want to own and why now: the wedge, the buyer, the technical unlock", help: "Prose is fine; the more specific the buyer and the wedge, the better the map" },
    { key: "stage", label: "Stage", type: "select", options: ["Pre-seed", "Seed", "Series A", "Series B", "Any"], default: "Seed" },
    { key: "geo", label: "Geography", type: "text", placeholder: "United States, Europe, anywhere", default: "United States" },
    { key: "exclusions", label: "Exclusions", type: "text", placeholder: "e.g. no consumer, no services businesses, nothing already funded above $50M post" },
    { key: "count", label: "Companies to name", type: "number", default: 25, min: 10, max: 60 },
  ],
  example: { thesis: "AI coding agents and the tooling around them: agents that write, review and ship code inside existing repos, sold bottom-up to engineering teams, priced per seat or per task. The unlock is long-context models plus repo-level retrieval; the incumbents to displace are Cursor (Anysphere), GitHub Copilot and Perplexity-style search inside the IDE.", stage: "Seed", geo: "United States", exclusions: "no dev-services consultancies, nothing already above a $100M post-money", count: 25 },
  effort: "high",
  instructions: `1. Restate the thesis as 4-8 searchable concepts (product category, buyer, technical unlock, substitute being displaced) and 3-6 candidate segments. Write down the exclusions as a filter you will apply at the end.
2. Sweep the directory with exactly six to eight search_startups calls, each with limit 20-25 and one keyword phrase: one per source ("yc" for batch companies, "hn" for Show HN launches, the strongest signal for infra and dev tools, "a16z" and "thiel" for credibility markers and co-investor adjacency, "formd" for confirmed raises) plus two with no source filter so web-discovery rows are included. Vary the keyword across calls (product noun, buyer noun, technical term); do not repeat a near-identical query. De-duplicate by name and website as you go.
3. Call form_d_search for at most five issuers: the ones whose raise size or date is load-bearing for the map. Form D gives amount sold, date of first sale and the officers' names.
4. Run web_research at most three times for what the directory cannot know: "<segment> startups raised seed 2026", "<incumbent> competitors 2026", "who is building <technical unlock>". Use it to add companies missing from the directory and to date the last round.
Budget: no more than sixteen tool calls in total. If a sweep returns nothing new, stop sweeping and write the map with what you have, then say in caveats which sources were thin.
5. Cluster the survivors into the segments from step 1 (3-6 segments, each with a one-line definition and the buyer it serves). Score every company 1-5 on thesis fit and 1-5 on momentum (recent launch, Form D, hiring, GitHub or Show HN traction), and say in one clause what the signal was. Use calc for counts, medians of last-round size and any share-of-segment arithmetic.
6. Apply the stage, geography and exclusion filters last, and report how many companies each filter removed.
Produce, in order: kpis (exactly five: companies screened, companies named, segments, median disclosed last round, companies with a raise in the last 90 days); markdown "The map" with one ## heading per segment, its definition, and the companies in it; table "Long list" with columns Company, Segment, Stage, Last round, Founders, Signal, Fit (1-5), Source, Link, sorted by fit then momentum; bullets "Whitespace" (2-4 places in the map where no credible company exists, and what would have to be true); checklist "Call this week" (5 companies, owner blank, with the one-line reason).
Write the summary as the sourcing conclusion first (which segment to hunt in and why, in one sentence), then the counts. Do not use the summary to hedge. Where a company's stage, geography or valuation cannot be verified, keep it in the long list and write "stage unverified" in its Signal cell rather than dropping it or adding a separate audit section. Keep caveats to at most four items: directory coverage of stealth companies, staleness below Series A, Form D's up-to-15-day lag, and anything material you could not verify. ${CITE}`,
  prompt: (i) => `Thesis:\n${str(i, "thesis")}\n\nBuild the sourcing map. Stage: ${str(i, "stage", "Seed")}. Geography: ${str(i, "geo", "United States")}. Name at least ${num(i, "count", 25)} companies.${str(i, "exclusions") ? ` Exclusions: ${str(i, "exclusions")}.` : ""}`,
};

const formDMonitor: ToolDef = {
  kind: "ai", id: "form-d-raise-monitor", title: "Form D raise monitor", tagline: "Who just raised, how much, and who signed the filing.",
  description: "Uses SEC Form D filings, the authoritative public record of exempt private offerings, to confirm raises in a sector or for a watchlist: amount sold, date of first sale, offering size, and the executive officers, directors and promoters named with their business addresses. Cross-checks the directory and the web for what the filing does not say.",
  roles: ["vc"], category: "Sourcing & deals", icon: "FileSearch", deliverable: "table", savesMinutes: 90, tags: ["Form D", "SEC", "raises", "signals"],
  fields: [
    { key: "companies", label: "Companies to check", type: "textarea", required: true, placeholder: "One issuer name per line", help: "Legal entity names work best (e.g. \"Anysphere, Inc.\")" },
    { key: "sector", label: "Sector keywords (for discovery)", type: "text", placeholder: "AI infrastructure, developer tools" },
    { key: "window", label: "Window", type: "select", options: ["Last 30 days", "Last 90 days", "Last 12 months", "All available"], default: "Last 90 days" },
  ],
  example: { companies: "Anysphere, Inc.\nPerplexity AI, Inc.\nHarvey AI, Inc.", sector: "AI applications and developer tools", window: "Last 12 months" },
  effort: "medium",
  instructions: `1. Call form_d_search once per issuer name. If a name returns nothing, retry with the shortest distinctive token (drop "Inc.", "Labs", "PBC") and with the product name, then say plainly that no Form D is on file: a missing Form D means either no exempt offering notice, a 4(a)(2) offering without a notice, or a different legal name.
2. For each filing record: total offering amount, total amount sold, date of first sale, whether the offering is still open, the exemption claimed (Rule 506(b) vs 506(c)), the issuer's revenue range if disclosed, and every related person (officers, directors, promoters) with their city. Related persons are the highest-value field: they name the people to reach and reveal board composition.
3. Use search_startups on each issuer to attach the directory row (program, one-liner, founders, website, investors) and note conflicts between the filing and the directory.
4. Run web_research for the two or three most interesting filings to attach the round narrative: lead investor, post-money if reported, and whether the amount sold matches the reported round size. Flag discrepancies: amount sold is cumulative for the offering and can include earlier tranches.
5. If sector keywords are given, also call search_startups with source "formd" and those keywords to surface issuers not on the watchlist.
Produce: kpis (filings found, total sold, largest raise, filings in the window); table "Form D filings" with Issuer, Filed, Date of first sale, Offering size, Amount sold, Exemption, Officers named, Source; timeline of the filings in date order with the amount in the label; bullets "What to do with this" (who to call, which board seats just changed, which raises contradict reported figures); caveats that Form D is filed within 15 days of first sale, amounts are cumulative, and no valuation is disclosed. ${CITE}`,
  prompt: (i) => `Check Form D filings for:\n${str(i, "companies")}\n\nWindow: ${str(i, "window", "Last 90 days")}.${str(i, "sector") ? ` Also discover new issuers in: ${str(i, "sector")}.` : ""}`,
};

const momentumScan: ToolDef = {
  kind: "ai", id: "hiring-momentum-scan", title: "Hiring signal & momentum scan", tagline: "Which companies on your list are accelerating, and which have gone quiet.",
  description: "Scores a watchlist on the signals VCs use to time outreach and to spot portfolio trouble: headcount and senior or technical hiring velocity, product launches, GitHub and Show HN activity, new Form D filings, founder job changes, and press cadence. Produces a ranked momentum table and a short list of companies whose signals just turned.",
  roles: ["vc"], category: "Screening", icon: "Activity", deliverable: "analysis", savesMinutes: 120, tags: ["signals", "momentum", "hiring", "sourcing"],
  fields: [
    { key: "companies", label: "Companies", type: "textarea", required: true, placeholder: "One per line; pipeline names, portfolio names, or both" },
    { key: "mode", label: "Mode", type: "select", options: ["Pipeline (who to call)", "Portfolio (who needs help)"], default: "Pipeline (who to call)" },
    { key: "window", label: "Window", type: "select", options: ["Last 30 days", "Last quarter", "Last 6 months"], default: "Last quarter" },
  ],
  example: { companies: "Anysphere (Cursor)\nPerplexity\nHarvey\nCognition", mode: "Pipeline (who to call)", window: "Last quarter" },
  effort: "medium",
  instructions: `1. For each company call search_startups (name and, if it fails, the product name) for the directory row: program, one-liner, founders, location, stage, investors, last known raise and source date.
2. Call web_research per company with at most two focused queries (cap the whole run at sixteen tool calls; drop the least informative query if the list is long): "<company> hiring engineering 2026 headcount" and "<company> launch OR announcement <window>". Look for departmental hiring velocity (the single most-used signal), senior and technical hires, product launches, pricing changes, customer logos, and any leadership departure.
3. Call form_d_search per company for a new or amended offering inside the window; a fresh Form D with a large amount sold usually means the round is done and the window to invest has closed.
4. Score each company 0-5 on four axes with calc: hiring velocity, product cadence, financing activity, external validation (press, awards, notable customers). Momentum score = the sum, 0-20. State the evidence for every score in one clause; where a signal cannot be verified, score it 0 and say "no signal found" rather than guessing.
5. In Pipeline mode, rank descending and write the outreach trigger for the top five. In Portfolio mode, rank ascending and flag deceleration: hiring freezes, senior departures, launch silence for a quarter, no financing activity with a known cash-out date.
Produce: kpis (companies scanned, accelerating, decelerating, new Form D filings); table "Momentum" with Company, Stage, Hiring, Product, Financing, Validation, Score, Evidence; bar of momentum scores with the subject list emphasised; bullets "Signals that just turned"; checklist of next actions (call, intro request, board escalation); risks in Portfolio mode. ${CITE}`,
  prompt: (i) => `Scan these companies over the ${str(i, "window", "last quarter").toLowerCase()} in ${str(i, "mode", "pipeline").toLowerCase()} mode:\n${str(i, "companies")}`,
};

const acceleratorFinder: ToolDef = {
  kind: "ai", id: "accelerator-finder", title: "Accelerator & program finder", tagline: "Which programs, batches and fellowships fit a company or a founder profile.",
  description: "Maps the accelerator, fellowship and studio landscape against a company or founder profile: standard deal terms, batch cadence, Demo Day timing, what each program is actually good at, and which alumni prove the fit. Built from YouBank's directory of YC, a16z and Thiel Fellowship companies plus web research on current program terms.",
  roles: ["vc", "student"], specialties: ["Pre-seed / seed", "Angel / syndicate", "Private equity / VC"], category: "Learning", icon: "GraduationCap", deliverable: "research", savesMinutes: 90, tags: ["accelerator", "YC", "Thiel", "pre-seed"],
  fields: [
    { key: "profile", label: "Company or founder profile", type: "textarea", required: true, placeholder: "What you are building, stage, team, traction, geography" },
    { key: "goal", label: "Primary goal", type: "select", options: ["Raise a first round", "Get customers and distribution", "Technical credibility", "Move to the US", "Non-dilutive funding"], default: "Raise a first round" },
    { key: "count", label: "Programs to compare", type: "number", default: 8, min: 4, max: 15 },
  ],
  example: { profile: "Two technical founders, ex-infrastructure engineers, building an evaluation and observability layer for coding agents. Pre-revenue, working prototype used by 40 engineers at three design partners, based in New York, no institutional capital.", goal: "Raise a first round", count: 8 },
  effort: "medium",
  instructions: `1. Use search_startups with source "yc" and keywords from the profile to find alumni that look like the company, and with source "thiel" and source "a16z" for fellowship and studio comparables. Name the alumni; they are the evidence that a program takes this kind of company.
2. Use web_research for current program terms, one query per program family: standard deal (YC's standard deal and its dilution, Techstars, a16z speedrun, sector accelerators, university and government programs), batch cadence and application deadlines, Demo Day format, and any non-dilutive option (grants, fellowships such as the Thiel Fellowship's $250K over two years, SBIR-style programs).
3. Compute the effective cost of each program with calc: dilution sold for the money, expressed both as a percentage and as the implied post-money valuation, and compare it to the median pre-seed and seed post-money the research cites (pre-seed ~$4-6M post for the smallest rounds, seed post-money median ~$24M).
4. Judge fit against the stated goal, not prestige: distribution programs matter for consumer and marketplace, technical credibility for deep tech, and a first-round goal is mostly about Demo Day investor density and batch size.
Produce: kpis (programs compared, median dilution, cheapest capital, next deadline); table "Programs" with Program, What you get, Money, Dilution, Implied post-money, Cadence / next deadline, Best for, Alumni like you; score block rating the top four programs 1-5 against the goal; bullets "How to apply well" (what each program screens for); nextSteps with dated deadlines; caveats that terms change every batch and should be confirmed on the program's own page. ${CITE}`,
  prompt: (i) => `Profile:\n${str(i, "profile")}\n\nGoal: ${str(i, "goal", "Raise a first round")}. Compare ${num(i, "count", 8)} programs.`,
};

const deckScreen: ToolDef = {
  kind: "ai", id: "deck-screen-note", title: "Deck screen & pass/advance note", tagline: "First-pass triage of an inbound deck into a CRM-ready note with a decision.",
  description: "Turns pasted deck or memo text into the structured screen an associate is measured on: stage, ask, round dynamics, traction, team, market, and thesis fit, with the claims that are verifiable separated from the claims that are not. Ends with an explicit pass or advance recommendation and, on a pass, a short respectful reply.",
  roles: ["vc"], specialties: ["Pre-seed / seed", "Series A-B"], category: "Screening", icon: "ClipboardList", deliverable: "memo", savesMinutes: 45, tags: ["screening", "inbound", "triage", "pass"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true, placeholder: "Company name" },
    { key: "deck", label: "Deck / email text", type: "textarea", required: true, placeholder: "Paste the deck text, the forwarded email, or your notes from the deck" },
    { key: "thesis", label: "Your thesis and mandate", type: "textarea", placeholder: "Stage, check size, sectors, what you will not do" },
  ],
  example: { company: "Harvey", deck: "Harvey - AI for elite law firms. Series C ask: $80M at $3B pre. Traction: $50M ARR, up 4x YoY; 300+ customers including 8 of the top 10 US firms by revenue; net revenue retention 160%. Team: ex-DeepMind research lead and a former O'Melveny associate. Market: $1T legal services, $30B+ spend on document review and drafting. Use of funds: 60 engineers, EMEA expansion, agentic workflows.", thesis: "Series A-B application-layer AI where the buyer already has a large services budget; $8-15M checks for 12-18% ownership; no consumer, no hardware." },
  effort: "medium",
  instructions: `1. Extract into a fixed schema, quoting the deck where it matters: what it does in one sentence; stage and the ask (amount, pre-money, structure); round dynamics (lead, committed, timing, why now); traction (ARR or GMV or users, growth, retention, concentration); business model and price point; team and why this team; market and the "why now"; use of funds.
2. Separate claims into verifiable and unverifiable. Verify what you can: form_d_search for prior raises and the officers named, search_startups for program and founder history, web_research for customer logos, launches and any reported round. Deck claims are unverified by default and must be labelled as such.
3. Score thesis fit against the user's mandate on stage, check size, sector, ownership achievable, and anything excluded. A mandate miss is a fast pass regardless of quality.
4. Grade the metrics against the stage benchmarks in the research: Series A de facto bar is 100%+ YoY growth; Series B typically $5-10M ARR with NRR above 100%; burn multiple below 0.8x is top quartile and 1.2-1.8x is median; net dollar retention above 120% is the Bessemer average. Say which metrics are absent, because absence is a finding.
5. Recommend: advance, pass, or track with a trigger. Only 3-4% of evaluated deals close, so the default is a fast, respectful pass with one concrete reason.
Produce: callout with the decision and the one-line reason; kpis (ARR or equivalent, growth, ask, implied post-money, ownership at the ask); table "What the deck claims" with Claim, Source in deck, Verified?, How; score block on thesis fit, team, market, traction, round dynamics (1-5 each); bullets "The two things that would change my mind"; qa "Questions for the first call" (6); email block with the pass or advance reply, under 120 words. ${CITE}`,
  prompt: (i) => `Screen ${str(i, "company")} for a first-pass decision.${str(i, "thesis") ? `\n\nMy mandate: ${str(i, "thesis")}` : ""}\n\nDeck text:\n${str(i, "deck")}`,
};

const startupDeepDive: ToolDef = {
  kind: "ai", id: "startup-deep-dive", title: "Startup deep dive", tagline: "Everything knowable about a private company before the first call.",
  description: "Assembles the pre-call brief on a private company from YouBank's directory, SEC Form D filings and the web: what it sells and to whom, founders and their history, funding history with amounts and investors, product and traction evidence, competitors, and the three things that decide whether this is investable. Every fact is sourced and unverified claims are labelled.",
  roles: ["vc"], category: "Research", icon: "Search", deliverable: "research", savesMinutes: 150, tags: ["diligence", "first call", "private company"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true, placeholder: "Anysphere (Cursor)" },
    { key: "website", label: "Website", type: "text", placeholder: "cursor.com" },
    { key: "focus", label: "What matters most", type: "multiselect", options: ["Team", "Product", "Traction", "Market", "Competition", "Round dynamics", "Technical risk", "Regulatory"], default: ["Team", "Traction", "Competition", "Round dynamics"] },
    { key: "stage", label: "Stage you would invest at", type: "select", options: ["Pre-seed", "Seed", "Series A", "Series B", "Growth / late stage"], default: "Series A" },
  ],
  example: { company: "Anysphere (Cursor)", website: "cursor.com", focus: ["Team", "Traction", "Competition", "Round dynamics"], stage: "Series B" },
  effort: "high",
  instructions: `1. Call search_startups on the company name and again on the product name; take the directory row (program, one-liner, founders, location, stage, investors, raised, source date) as the spine and note which source it came from.
2. Call form_d_search on the legal entity name for the authoritative raise record: amounts sold, dates of first sale, and the officers, directors and promoters named. Use the officer list to establish who is actually on the board.
3. Run web_research four to six times, one question each and no repeats: what the product does and how it is priced; the founders' history before this company; the funding history with leads, amounts and any reported valuation; customer and usage evidence; the competitive set; anything negative (litigation, security incidents, key departures, regulatory exposure).
4. For every competitor that is public, call get_company_financials so the comparison uses real numbers rather than impressions. Use calc for any implied multiple, growth rate or ownership arithmetic and show the inputs.
5. Build the "what would have to be true" list for the chosen stage: at Series A it is growth and evidence of a repeatable go-to-market; at growth stage it is retention, gross margin, efficiency and a credible public-market exit comp.
Produce: kpis (last round and date, post-money if reported, total raised, headcount if known, founded, investors); markdown "What it is" and "Why now" (short paragraphs); table "Funding history" with Date, Round, Amount, Lead, Post-money, Source; table "Competitive set" with Company, Public/private, What differs, Scale; bullets "Evidence of traction" with the source of each; risks (3-5 with severity and mitigation); qa "Questions for the founder" (8, tuned to the focus fields); caveats separating verified filings from press and self-reported figures. ${CITE}`,
  prompt: (i) => `Deep dive on ${str(i, "company")}${str(i, "website") ? ` (${str(i, "website")})` : ""} for a possible ${str(i, "stage", "Series A")} investment. Emphasise: ${list(i, "focus").join(", ") || "team, traction, competition"}.`,
};

const marketMap: ToolDef = {
  kind: "ai", id: "market-map-competitive", title: "Competitive landscape map", tagline: "Who else is building this, how they differ, and where the segment is crowded.",
  description: "Builds the competitive map around a company or a category: incumbents, venture-backed challengers grouped by approach, the public companies that set the price, and the axes that actually separate them. Uses the startup directory and web research for private players and live SEC data for public ones, then says where the segment is crowded and where it is not.",
  roles: ["vc"], category: "Research", icon: "Network", deliverable: "analysis", savesMinutes: 180, tags: ["competition", "market map", "landscape"],
  fields: [
    { key: "subject", label: "Company or category", type: "text", required: true, placeholder: "AI legal workflow software, or Harvey" },
    { key: "axes", label: "Axes to separate players", type: "text", placeholder: "e.g. buyer (enterprise vs SMB) x wedge (drafting vs review)", help: "Leave empty and the model proposes the two axes that matter" },
    { key: "publicComps", label: "Public comparables", type: "tickers", placeholder: "FIG RDDT ARM", help: "Optional; public companies that price the category" },
    { key: "count", label: "Private players to map", type: "number", default: 18, min: 8, max: 40 },
  ],
  example: { subject: "AI legal workflow software (Harvey, Legora, EvenUp)", axes: "buyer (Am Law 100 vs in-house vs SMB) x wedge (drafting vs review vs litigation)", publicComps: ["FIG", "RDDT"], count: 18 },
  effort: "high",
  instructions: `1. Define the category in one sentence and state what is in and out of scope. If the subject is a company, the category is the job it does for the buyer, not its product name.
2. Find private players with four to six search_startups calls (limit 20-25 each), varying keywords and sources (yc, hn, a16z, formd, unfiltered); do not repeat near-identical queries. Add players the directory misses with web_research ("<category> startups 2026", "<subject> competitors", "<category> funding round 2026").
3. For each private player capture: what it does, the buyer, the wedge, stage, last round and investors, and one differentiator in the player's own words where available. Use form_d_search to confirm raises that only appear as press.
4. For the public set (given, or proposed and justified), call get_trading_comps to anchor the category's revenue multiples, growth and margins, and get_company_financials for the one or two that matter most. These are the exit benchmarks.
5. Choose the two axes that separate the players (buyer size, wedge, deployment model, price point, data access). Use calc for segment counts, capital raised per segment and the crowding ratio (players per segment).
Produce: kpis (players mapped, segments, capital into the category, median last round, public multiple anchor); scatter placing the private players on the two axes with the subject emphasised (xLabel and yLabel named, use numeric scores 1-5 per axis and explain the scoring); table "Players" with Company, Segment, Buyer, Wedge, Stage, Last round, Investors, Differentiator, Source; table "Public anchors" with the comps and EV/revenue, growth, gross margin; bullets "Crowded vs open" and "How the winner probably wins"; caveats on private-data coverage. ${CITE}`,
  prompt: (i) => `Map the competitive landscape for ${str(i, "subject")}. Map at least ${num(i, "count", 18)} private players.${str(i, "axes") ? ` Axes: ${str(i, "axes")}.` : ""}${list(i, "publicComps").length ? ` Public anchors: ${list(i, "publicComps").join(", ")}.` : ""}`,
};

const marketSizing: ToolDef = {
  kind: "ai", id: "startup-market-sizing", title: "Market sizing for a startup", tagline: "Bottom-up TAM from buyers and price, reconciled against a top-down check.",
  description: "Sizes the market the way an investment memo has to: a bottom-up build from the number of buyers, the units per buyer and the realistic price, a top-down cross-check from public-company revenue pools and analyst figures, and a reconciliation that explains the gap. Ends with the beachhead segment and the revenue ceiling implied for the company itself.",
  roles: ["vc", "pe"], category: "Research", icon: "Target", deliverable: "analysis", savesMinutes: 180, tags: ["TAM", "market sizing", "memo"],
  fields: [
    { key: "company", label: "Company or product", type: "text", required: true, placeholder: "Harvey - AI drafting and review for law firms" },
    { key: "buyer", label: "Who buys and what they replace", type: "textarea", required: true, placeholder: "Which job title signs, what budget line it comes out of, what it displaces" },
    { key: "price", label: "Price point", type: "text", placeholder: "e.g. $150 per seat per month, or $250K average contract value" },
    { key: "comps", label: "Public revenue pools", type: "tickers", placeholder: "Public companies whose revenue is in this pool" },
  ],
  example: { company: "Harvey - AI drafting, review and research for large law firms", buyer: "Practice-group heads and innovation officers at Am Law 200 firms; comes out of the technology and contract-attorney budget; displaces junior associate hours and document-review vendors", price: "$250K average annual contract value, seat-based with usage tiers", comps: ["FIG"] },
  effort: "high",
  instructions: `1. Bottom-up first. Establish the buyer universe with a countable source (number of firms, hospitals, developers, SMBs) from web_research, and say which source you used. Then build: buyers x attach rate x units per buyer x price = serviceable market. Run three cases (conservative, base, aggressive) by varying attach rate and price, not by varying the buyer count. Every multiplication goes through calc and the inputs are shown.
2. Segment the bottom-up build into the beachhead (who buys first and why), the adjacent segment, and the rest. The beachhead number is the one that matters for a Series A memo.
3. Top-down cross-check. Identify the existing spend pool being displaced and size it from public data: get_company_financials on the public comparables and, where the pool is a segment, search_filing on the latest 10-K for "segment", "revenue by", or the product line name to get the disclosed figure rather than a guess. Add analyst or trade-association figures from web_research, dated and attributed.
4. Reconcile. Put the bottom-up and top-down numbers side by side, explain the gap in terms of price realisation, attach rate or scope, and state which you would underwrite. Reject any number that implies the company captures more than a plausible share of the displaced pool.
5. Convert to a company ceiling: at what revenue does the company need a second product, and what market share does the base case imply at that revenue.
Produce: kpis (bottom-up serviceable market, top-down pool, beachhead, implied share at the base case); table "Bottom-up build" with Driver, Conservative, Base, Aggressive, Source; waterfall from the total pool to the beachhead (total pool, less out-of-scope segments, less unrealistic attach, beachhead as a total step); table "Top-down cross-check" with Source, Figure, Date, What it covers; markdown "Reconciliation"; bullets "Why now" (what changed that makes the attach rate credible); caveats that TAM is an argument, not a measurement. ${CITE}`,
  prompt: (i) => `Size the market for ${str(i, "company")}.\n\nBuyer: ${str(i, "buyer")}.${str(i, "price") ? ` Price point: ${str(i, "price")}.` : ""}${list(i, "comps").length ? ` Public revenue pools: ${list(i, "comps").join(", ")}.` : ""}`,
};

/* ======================================================================================
 * AI workflows: outreach and diligence
 * ====================================================================================== */

const founderOutreach: ToolDef = {
  kind: "ai", id: "founder-outreach-email", title: "Founder outreach email", tagline: "A signal-anchored cold email under 200 words, plus the warm paths that beat it.",
  description: "Drafts the first-touch email to a founder the way the best-converting outreach is written: a subject line naming the specific thing you noticed, one line on why you specifically, one line of evidence you did the work, and one small ask. Researches the hook first, maps the warm introduction paths that convert ten times better than cold, and adds the follow-up variant and the send timing.",
  roles: ["vc"], category: "Communication", icon: "Mail", deliverable: "email", savesMinutes: 40, tags: ["outreach", "cold email", "sourcing", "warm intro"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true, placeholder: "Anysphere (Cursor)" },
    { key: "founder", label: "Founder name and role", type: "text", placeholder: "e.g. Michael Truell, co-founder and CEO" },
    { key: "signal", label: "Hook signal", type: "select", options: ["Show HN or product launch", "New funding or Form D", "Senior or technical hire", "GitHub traction", "Customer or usage milestone", "Conference talk or post", "Let the model find one"], default: "Let the model find one" },
    { key: "why", label: "Why you specifically", type: "textarea", required: true, placeholder: "Your thesis, the portfolio company that is relevant, the customer you can introduce" },
    { key: "ask", label: "The ask", type: "select", options: ["20 minutes this week", "Permission to keep in touch with a quarterly note", "Intro to a named customer, no meeting asked", "Invite to a dinner or event"], default: "20 minutes this week" },
    { key: "tone", label: "Tone", type: "select", options: ["Peer-to-peer and plain", "Warm and brief", "Technical and specific"], default: "Technical and specific" },
  ],
  example: { company: "Anysphere (Cursor)", founder: "Michael Truell, co-founder and CEO", signal: "Let the model find one", why: "I lead seed and Series A at a $120M fund focused on developer tooling; I backed a CI company that sells to the same platform-engineering buyer and can introduce two Fortune 500 platform teams that are standardising on agent tooling this quarter.", ask: "20 minutes this week", tone: "Technical and specific" },
  effort: "medium",
  instructions: `1. Find the hook before writing a word. Call search_startups on the company (program, one-liner, founders, source date), form_d_search on the legal entity (a recent filing means a closed round and changes the ask), and web_research twice: "<company> launch OR Show HN OR announcement" and "<founder> background before <company>". If the user chose a signal type, hunt that signal specifically; if not, pick the most recent, most specific, most verifiable one.
2. Write the email to the published rules: five to six sentences, under 200 words (aim for 120-150); subject line that names the specific thing you noticed, never a generic pitch; first line = why you specifically (thesis, relevant portfolio company, a customer you can introduce); one line of evidence you actually used the product or read the work (a product observation or a data point, not praise); one explicit small ask matching the ask field; a signature that makes you easy to verify (fund, one portfolio name, link). No attachments, no "love what you're building", nothing that reads as a merge field.
3. Draft the follow-up: sent 5-7 business days later, new information only (a thought about their launch, an intro offer, a relevant portfolio data point), three sentences maximum, no guilt.
4. Map the warm paths, because they are what actually converts: name the specific bridge types in priority order (portfolio founders first, then co-investors from the directory row's investor list, then the officers named in the Form D, then alumni and program networks from the directory program field, then customers). For each path say who to ask and the exact one-line forwardable blurb they would send.
5. State the benchmarks so the user can calibrate: cold email to a founder gets a low single-digit reply rate (the published founder-to-VC figure is roughly 1-2%, with ~95% never receiving a response), warm introductions convert 20-30% to a first meeting, and cold-sourced deals take about six months to close versus three for warm. Send Tuesday to Thursday morning in the founder's time zone.
Produce, in order: callout naming the hook and why it is the right one; email block (subject, body, to = founder name) for the first touch; email block for the follow-up with the subject prefixed "Follow-up:"; table "Warm paths" with Path, Who to ask, Why it works, Forwardable line; bullets "Rules this draft follows" tied to the word count and structure; kpis (word count, reply-rate benchmark cold, reply-rate benchmark warm, send window); caveats that authenticity cannot be faked and the fund's own relationship history must be checked before sending. ${CITE}`,
  prompt: (i) => `Draft first-touch outreach to ${str(i, "founder") || "the founder"} at ${str(i, "company")}. Hook signal: ${str(i, "signal", "Let the model find one")}. Ask: ${str(i, "ask", "20 minutes this week")}. Tone: ${str(i, "tone", "Technical and specific")}.\n\nWhy me: ${str(i, "why")}`,
};

const referencePlan: ToolDef = {
  kind: "ai", id: "founder-reference-plan", title: "Founder reference plan", tagline: "Who to call about the founders, including the people they did not offer.",
  description: "Builds the reference programme for a founding team: the on-list references the founder proposes, the off-list references you find yourself, the specific question set for each relationship type, and the scoring rubric that turns ten calls into one paragraph of conviction. Finds candidate references from the directory, Form D related persons and the web.",
  roles: ["vc"], specialties: ["Pre-seed / seed", "Series A-B", "Growth / late stage"], category: "Diligence", icon: "Users", deliverable: "checklist", savesMinutes: 120, tags: ["references", "diligence", "team"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true },
    { key: "founders", label: "Founders and their history", type: "textarea", required: true, placeholder: "Names, prior employers, prior companies, how they met" },
    { key: "concerns", label: "Specific concerns to test", type: "textarea", placeholder: "e.g. can the CTO hire, has the CEO ever sold enterprise, why the last company failed" },
    { key: "count", label: "References to plan", type: "number", default: 10, min: 5, max: 20 },
  ],
  example: { company: "Cognition", founders: "Technical co-founders from competitive programming backgrounds; prior roles at quant and AI research labs; team met through olympiad circles", concerns: "Has the team ever sold to enterprise procurement, and can they recruit senior go-to-market leaders", count: 10 },
  effort: "medium",
  instructions: `1. Establish the founders' verifiable history: web_research on each founder ("<name> before <company>", "<name> <prior employer>"), search_startups for prior companies in the directory, and form_d_search on any prior entity to see who else was an officer. Every claimed role must be attributable to a source or marked unverified.
2. Build the reference list at the target count, at least two of which must be off-list (people the founder did not propose): former managers, former direct reports, co-founders of prior companies, early employees who left, customers from a prior company, and investors in a prior company. Name real candidate people or, where a name cannot be found, the exact role to ask for.
3. Write the question set per relationship type. Former manager: scope owned, how they handled being wrong, would you hire them again into what role. Former report: how decisions were made, how they hire and fire, what they are weakest at. Co-founder: how equity and roles were decided, how conflict was resolved. Customer: what was promised versus delivered. Ask every reference the two closing questions: "who else should I speak to" and "what would make this not work".
4. Tie the plan to the stated concerns: each concern gets at least two references whose answers would settle it, and the question that settles it.
5. Define the scoring rubric (1-5 on ownership, hiring, resilience, honesty, speed) and the disqualifiers (unexplained gaps, pattern of blaming, references who will not speak on the record, any reference the founder tries to coach).
Produce: kpis (references planned, off-list count, concerns covered, disqualifiers to watch); table "Reference plan" with Person or role, Relationship, How to reach, Concern it tests, Priority; qa "Question bank" grouped by relationship type (at least 12 questions); checklist of the calls with owner and due; score block with the rubric dimensions; bullets "Red flags"; caveats on backchannel etiquette and consent. ${CITE}`,
  prompt: (i) => `Plan ${num(i, "count", 10)} references for the founders of ${str(i, "company")}.\n\nFounders: ${str(i, "founders")}${str(i, "concerns") ? `\n\nConcerns to test: ${str(i, "concerns")}` : ""}`,
};

const customerCalls: ToolDef = {
  kind: "ai", id: "customer-reference-guide", title: "Customer & reference call guide", tagline: "The script, the sample and the synthesis for customer diligence.",
  description: "Designs the customer call programme for a diligence: how many calls and of which type, a structured script that gets past the polite answers to willingness to pay and expansion, a note-taking form, and the synthesis framework that converts the calls into a retention and pricing view for the memo.",
  roles: ["vc", "pe"], specialties: ["Series A-B", "Growth / late stage", "Corporate VC", "Growth equity"], category: "Diligence", icon: "MessageSquare", deliverable: "checklist", savesMinutes: 150, tags: ["customer calls", "diligence", "references", "churn"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true },
    { key: "product", label: "What it sells and to whom", type: "textarea", required: true, placeholder: "Product, buyer, price point, contract length" },
    { key: "calls", label: "Calls planned", type: "number", default: 10, min: 5, max: 20 },
    { key: "mix", label: "Sample mix", type: "multiselect", options: ["Happy reference customers", "Churned customers", "Evaluated and did not buy", "Champions who changed jobs", "Competitor's customers"], default: ["Happy reference customers", "Churned customers", "Evaluated and did not buy"] },
  ],
  example: { company: "Harvey", product: "AI drafting, review and research sold to Am Law 200 firms and in-house legal teams; $250K average annual contract value, annual prepaid contracts", calls: 12, mix: ["Happy reference customers", "Churned customers", "Evaluated and did not buy", "Champions who changed jobs"] },
  effort: "medium",
  instructions: `1. Design the sample against the mix requested and say why each cell matters: on-list happy customers establish the best case, churned customers establish the real reason for loss, evaluated-and-passed establish the competitive alternative and the price ceiling, champions who changed jobs establish whether the product travels with the buyer. Recommend 5-15 calls (the working range in the research) and state what each cell is worth.
2. Use web_research to find named customer candidates (case studies, press, conference talks, job posts mentioning the tool) and search_startups for the company row so the product description is accurate. Name real candidate accounts where you can; otherwise specify the account profile and how to source it.
3. Write the script in the standard order with the wording that gets honest answers: the problem before the product ("what were you doing before"), the buying process (who signed, what budget it came from, what else was evaluated), implementation and time to value, current usage and who inside uses it, quantified value, the renewal question ("what happens if it disappears on Monday"), expansion ("what would you pay double for"), and the price test ("at what price would you have said no"). Add the two closing questions: what nearly stopped the deal, and who else should I talk to.
4. Provide the note form: fields for account, segment, ARR, tenure, usage frequency, value quantified, renewal intent 1-5, expansion intent 1-5, alternatives considered, verbatim quote.
5. Define the synthesis: aggregate renewal and expansion intent into an implied retention read, triangulate against the company's reported NRR and GRR (Bessemer's average net dollar retention is 120%+, with only the bottom quartile under 100%; median gross retention is ~90%), and list the two or three findings that would change the investment decision.
Produce: kpis (calls planned, cells covered, target retention read, minimum calls for a conclusion); table "Sample design" with Cell, Calls, Why it matters, How to source; steps for the call flow with the exact opening and closing lines; qa "Script" with at least 14 question/purpose pairs; table "Note form" with Field, What good looks like; bullets "Synthesis rules"; caveats that reference customers are selected by the company and that the off-list cells carry the real information. ${CITE}`,
  prompt: (i) => `Design the customer diligence programme for ${str(i, "company")}: ${num(i, "calls", 10)} calls, mix of ${list(i, "mix").join(", ") || "happy and churned customers"}.\n\nWhat it sells: ${str(i, "product")}`,
};

const diligenceChecklist: ToolDef = {
  kind: "ai", id: "vc-diligence-checklist", title: "Diligence checklist by stage", tagline: "The workstream-by-workstream list, sized to the stage and the cheque.",
  description: "Produces the diligence plan for a specific deal: market, product, team, customers, cohorts, unit economics, model, cap table and terms, and legal or IP, each with the artefacts to request, the owner, the days it takes, and the kill criteria. Scales the depth to the stage so a pre-seed deal is not run like a growth round, and includes the 2025 NVCA additions.",
  roles: ["vc"], category: "Diligence", icon: "ListChecks", deliverable: "checklist", savesMinutes: 120, tags: ["diligence", "checklist", "process", "data room"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true },
    { key: "stage", label: "Stage", type: "select", options: ["Pre-seed", "Seed", "Series A", "Series B", "Growth / late stage"], default: "Series A", required: true },
    { key: "check", label: "Check size", type: "number", unit: "$mm", default: 10 },
    { key: "lead", label: "Role in the round", type: "select", options: ["Lead", "Co-lead", "Follow", "Pro rata only"], default: "Lead" },
    { key: "days", label: "Days to a decision", type: "number", default: 21, min: 5, max: 90 },
  ],
  example: { company: "Perplexity", stage: "Series B", check: 25, lead: "Co-lead", days: 21 },
  effort: "medium",
  instructions: `1. Size the programme to the stage and role. Pre-seed and seed: team, market, product, a light cap table review and reference calls; a lead seed cheque still needs cap table and terms work. Series A and later add cohort and retention analysis, unit economics, a rebuilt operating model, an ARR reconciliation to invoices or bank data, and 5-15 customer calls. A follow or pro rata role compresses to confirmatory work and the terms.
2. For each of the nine workstreams (market, product and technology, team, customers, cohorts and retention, unit economics, financial model, cap table and terms, legal and IP) list: the artefacts to request from the data room, who does the work, the elapsed days, and the kill criterion that would end the process.
3. Name the artefacts precisely: charter and all prior SAFEs and side letters, IP assignments for every founder and contractor, employment agreements, litigation and regulatory correspondence, the cap table as a spreadsheet with all classes, the option ledger, monthly revenue by customer for 24 months, the subscription or transaction export for cohorts, CAC by channel, the bank statements for the proof of cash, security posture and any penetration test, and the model.
4. Include the current legal additions the research flags: the October 2025 NVCA forms add two-way national-security representations (Outbound Investment Security Program and Data Security Program), QSBS threshold language, and formalised milestone-tranched closings. Add these as explicit items in legal and terms rather than assuming counsel will catch them.
5. Build the calendar backwards from the decision date: references and customer calls start first because they take the longest, confirmatory legal last, and the IC memo is circulated 24-72 hours before the partner meeting.
Produce: kpis (workstreams, artefacts requested, days to decision, calls required); checklist "Data room request list" with owner and due dates; table "Workstreams" with Workstream, Owner, Days, Artefacts, Kill criterion; timeline of the days-to-decision calendar with the IC date; risks (the 3-5 items most likely to break the deal, with severity); bullets "What we will not do at this stage and why"; caveats that legal conclusions are counsel's. ${CITE}`,
  prompt: (i) => `Build the diligence plan for a ${str(i, "check") ? `$${num(i, "check", 10)}mm ` : ""}${str(i, "lead", "Lead").toLowerCase()} cheque into ${str(i, "company")} at ${str(i, "stage", "Series A")}, with a decision in ${num(i, "days", 21)} days.`,
};

const cohortAnalysis: ToolDef = {
  kind: "ai", id: "cohort-retention-analysis", title: "Cohort & retention analysis", tagline: "Cohort triangles, NRR, GRR and churn from a raw subscription export.",
  description: "Turns a pasted subscription, invoice or transaction export into the retention analysis a memo needs: monthly cohort triangles for logo and revenue retention, net and gross dollar retention, logo churn, expansion and contraction decomposition, and a verdict on whether retention is stabilising and whether newer cohorts are better than older ones.",
  roles: ["vc", "pe"], specialties: ["Series A-B", "Growth / late stage", "Corporate VC", "Growth equity"], category: "Diligence", icon: "LineChart", deliverable: "analysis", savesMinutes: 240, tags: ["cohorts", "retention", "NRR", "churn"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true },
    { key: "data", label: "Subscription / revenue export", type: "csv", required: true, columns: "customer_id, month (YYYY-MM), mrr, segment, first_month", help: "Any long-format export works: one row per customer per month. Extra columns are used if present." },
    { key: "model", label: "Business model", type: "select", options: ["B2B SaaS (seat or subscription)", "Usage-based / consumption", "Marketplace (GMV)", "Consumer subscription"], default: "B2B SaaS (seat or subscription)" },
    { key: "segment", label: "Cut by", type: "select", options: ["Whole company", "Segment column", "Cohort size", "Channel"], default: "Whole company" },
  ],
  example: { company: "Example Series A SaaS", model: "B2B SaaS (seat or subscription)", segment: "Whole company", data: "customer_id,month,mrr,segment,first_month\nC1,2025-01,4000,Enterprise,2025-01\nC1,2025-02,4000,Enterprise,2025-01\nC1,2025-03,6000,Enterprise,2025-01\nC2,2025-01,1200,SMB,2025-01\nC2,2025-02,1200,SMB,2025-01\nC2,2025-03,0,SMB,2025-01\nC3,2025-02,2500,Mid-market,2025-02\nC3,2025-03,2500,Mid-market,2025-02\nC4,2025-03,8000,Enterprise,2025-03" },
  effort: "high",
  instructions: `1. Map the columns first and print the mapping: the customer key, the period, the revenue measure, the cohort month (use the first period in which the customer has revenue if no first_month column exists), and any segment column. State the number of customers, periods and total revenue you parsed, and name any row you dropped and why.
2. Build the cohort triangle: for each cohort month, revenue and logo counts by months-since-start, indexed to 100 in month 0. Report at minimum months 0, 3, 6 and 12 where the data allows.
3. Compute with calc, and state the definition next to each number: net dollar retention over 12 months = (starting cohort revenue + expansion - contraction - churn) / starting cohort revenue, measured on the cohort present 12 months earlier; gross dollar retention excludes expansion; logo retention counts customers with any revenue. Decompose the change into expansion, contraction and churned revenue so the three components add to the net change.
4. Answer the two questions that matter: is the curve flattening (retention stabilising rather than continuing to decay), and are newer cohorts better than older ones at the same age. Say so explicitly, with the numbers that support it.
5. Benchmark against the research: Bessemer's net dollar retention average is 120%+ with only the bottom quartile under 100%; median gross retention is ~90% and top quartile 96%; bottom-up products are judged good at 100% and great at 120% net, enterprise 110% and 130%. For consumer, use the six-month retention benchmarks (social good ~25% / great ~45%, transactional ~30% / ~50%, consumer SaaS ~40% / ~70%, SMB SaaS ~60% / ~80%, enterprise ~70% / ~90%). For marketplaces, retention must be measured on GMV and repeat rate per side, not revenue.
6. If the export is too short for a 12-month view, say so and report the longest horizon the data supports rather than annualising a short window.
Produce: kpis (NRR, GRR, logo retention, monthly logo churn, expansion share of growth); table "Cohort triangle (revenue index, month 0 = 100)" with cohorts as rows and months since start as columns; line chart of 3-4 cohort retention curves; waterfall decomposing the last 12 months (starting revenue, expansion, contraction, churn, ending revenue as totals); table "Benchmark" with Metric, This company, Benchmark, Verdict; callout on whether retention is stabilising; caveats on definition differences and on reconciliation to invoices and bank data still being manual.`,
  prompt: (i) => `Run the cohort and retention analysis for ${str(i, "company")} (${str(i, "model", "B2B SaaS")}), cut by ${str(i, "segment", "whole company").toLowerCase()}.`,
};

const metricsBenchmark: ToolDef = {
  kind: "ai", id: "saas-metrics-benchmark", title: "SaaS metrics benchmark", tagline: "Where a company sits against stage benchmarks, and whether it clears the bar.",
  description: "Positions a company's growth, retention, efficiency and unit economics against the published stage benchmarks (Bessemer growth bands and net dollar retention, SaaS Capital and CFO Advisors medians, burn multiple and magic number quartiles, LTV/CAC and CAC payback ranges) and returns a percentile view plus an explicit Series A or B readiness verdict with the two metrics to fix.",
  roles: ["vc", "pe"], specialties: ["Pre-seed / seed", "Series A-B", "Growth / late stage", "Growth equity"], category: "Screening", icon: "Gauge", deliverable: "analysis", savesMinutes: 90, tags: ["benchmarks", "SaaS", "metrics", "readiness"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true },
    { key: "arr", label: "ARR", type: "number", unit: "$mm", required: true, default: 5 },
    { key: "growth", label: "YoY ARR growth", type: "number", unit: "%", default: 140 },
    { key: "nrr", label: "Net dollar retention", type: "number", unit: "%", default: 118 },
    { key: "grossMargin", label: "Gross margin", type: "number", unit: "%", default: 74 },
    { key: "burnMultiple", label: "Burn multiple", type: "number", unit: "x", default: 1.1 },
    { key: "cacPayback", label: "CAC payback", type: "number", unit: "months", default: 14 },
    { key: "magic", label: "Magic number", type: "number", default: 0.8 },
    { key: "fcfMargin", label: "FCF margin", type: "number", unit: "%", default: -60 },
    { key: "buyer", label: "Buyer", type: "select", options: ["SMB", "Mid-market", "Enterprise", "Prosumer / bottom-up"], default: "Mid-market" },
    { key: "target", label: "Round being tested", type: "select", options: ["Seed", "Series A", "Series B", "Series C / growth"], default: "Series A" },
  ],
  example: { company: "Example AI application company", arr: 5, growth: 140, nrr: 118, grossMargin: 74, burnMultiple: 1.1, cacPayback: 14, magic: 0.8, fcfMargin: -60, buyer: "Mid-market", target: "Series A" },
  effort: "medium",
  instructions: `1. Restate the inputs and compute the derived metrics with calc: Rule of 40 (growth % + FCF margin %), the Rule of X with growth weighted roughly 2x for a private company, growth endurance implied for next year (~70% of this year's rate for private cloud companies), and implied net new ARR.
2. Place each metric in the right band and name the source: growth against Bessemer's good/better/best for the ARR band ($1-10M ARR: 100% / 165% / 230%+; $10-25M: 87% / 115% / 135%+; $25-50M: 77% / 95% / 110%+; $50-100M: 60% / 60% / 80%+) and against the far lower private medians (SaaS Capital's 2026 survey median 22%; medians of ~75% at $1-5M, 50% at $5-20M, 35% at $20-50M); net dollar retention against 120%+ average and sub-100% bottom quartile; gross margin against 65-70% cloud average, 76% median and 84% top quartile; burn multiple against <0.8x top quartile and 1.2-1.8x median; CAC payback against SMB under 12, mid-market under 18 and enterprise under 24 months with top quartile 7-15; magic number against >0.9 top quartile and 0.5-0.7 median at Series A; LTV/CAC against 3.2:1 median and 5:1 top quartile; Rule of 40 against the public median of 28-31 and top decile ~48.
3. Give a verdict on the round being tested: the de facto Series A bar in 2026 is 100%+ YoY growth; Series B is typically $5-10M ARR with net retention above 100%. Say clearly whether the company clears it and on which metric it fails.
4. Use web_research only if a current public-comp anchor is needed for the efficiency argument, and get_trading_comps if public multiples are relevant to the exit case. Do not invent benchmark numbers that are not in the list above; if a metric has no benchmark, say so.
5. Name the two metrics to fix and the mechanism to fix each (pricing, segment mix, sales productivity, gross margin structure), and what the company would look like in four quarters if it did.
Produce: kpis (ARR, growth vs band, NRR, burn multiple, Rule of 40); table "Benchmark" with Metric, Company, Median, Top quartile, Percentile read, Source; bar comparing the company's growth with the good/better/best bars for its ARR band (format pct); score block scoring growth, retention, efficiency, unit economics and margin 1-5; callout with the readiness verdict; bullets "The two metrics to fix"; caveats that definitions differ by company and that self-reported ARR needs reconciliation.`,
  prompt: (i) => `Benchmark ${str(i, "company")}: $${num(i, "arr", 5)}mm ARR growing ${num(i, "growth", 140)}% YoY, ${num(i, "nrr", 118)}% net dollar retention, ${num(i, "grossMargin", 74)}% gross margin, ${num(i, "burnMultiple", 1.1)}x burn multiple, ${num(i, "cacPayback", 14)}-month CAC payback, magic number ${num(i, "magic", 0.8)}, ${num(i, "fcfMargin", -60)}% FCF margin, ${str(i, "buyer", "Mid-market")} buyer. Test readiness for ${str(i, "target", "Series A")}.`,
};

const investmentMemo: ToolDef = {
  kind: "ai", id: "vc-investment-memo", title: "Investment memo", tagline: "The full memo in the house structure, with a recommendation and cited numbers.",
  description: "Drafts the investment memo in the structure partner meetings expect: executive summary with the deal header and what must be true, market and why now, team, product, business model and unit economics, traction and cohorts, competition, deal terms with ownership and returns, risks and mitigants, and the post-investment plan. Pulls the company facts from the directory, Form D and the web, and the exit comps from live public data.",
  roles: ["vc"], category: "Deliverables", icon: "FileText", deliverable: "memo", savesMinutes: 420, tags: ["memo", "IC", "deliverable"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true },
    { key: "terms", label: "Deal terms", type: "textarea", required: true, placeholder: "e.g. $12M Series A at $48M pre / $60M post, 12% post-money pool, 1x non-participating, 5-seat board" },
    { key: "recommendation", label: "Your leaning", type: "select", options: ["Invest", "Invest with conditions", "Pass", "Undecided - argue both sides"], default: "Invest with conditions" },
    { key: "metrics", label: "Metrics", type: "csv", columns: "metric, value, period, source", help: "ARR, growth, NRR, burn, CAC payback, headcount - whatever you have" },
    { key: "notes", label: "Diligence notes", type: "textarea", placeholder: "Customer call findings, reference notes, product observations, open questions" },
    { key: "comps", label: "Public exit comps", type: "tickers", placeholder: "RDDT ARM CRWV FIG" },
  ],
  example: { company: "Anysphere (Cursor)", terms: "$40M growth round at $2.5B pre / $2.54B post, no new pool, 1x non-participating, one board observer, full pro rata", recommendation: "Invest with conditions", metrics: "metric,value,period,source\nARR,500,2026-06,company\nYoY growth,300%,2026-06,company\nNet dollar retention,150%,2026-06,company\nGross margin,55%,2026-06,company\nBurn multiple,0.6x,2026-06,company", notes: "Four customer calls: two platform-engineering leads describe standardising on the product; one churned account cited security review failure; pricing pressure from bundled incumbents. Reference calls on the founders are strong on velocity, thin on enterprise go-to-market.", comps: ["FIG", "CRWV", "RDDT"] },
  effort: "high",
  instructions: `1. Gather before drafting: search_startups for the directory row, form_d_search for the raise record and the officers named, web_research for the funding history, product, customers and competitors, and get_trading_comps on the public comps for the exit anchor. Use the user's metrics CSV and notes as primary evidence and say when a number is company-reported rather than verified.
2. Write in the standard ten-part structure: (1) executive summary with a deal header (round, amount, pre and post, ownership, board, pro rata) plus "what must be true" in three bullets and an explicit recommendation; (2) market and why now, with the beachhead; (3) team, tied to the specific execution challenge this company faces; (4) product and the evidence of need; (5) business model and unit economics, naming the two or three variables that decide the outcome; (6) traction and cohorts; (7) competition; (8) deal terms, ownership and returns with exit scenarios; (9) risks and mitigants, 2-3 material risks stated plainly with evidence; (10) post-investment monitoring plan and the first-100-day value-add.
3. Do the ownership and returns arithmetic with calc and show it: ownership = investment / post-money; ownership at exit = entry ownership x (1 - expected dilution, 40-50% is the working assumption); proceeds = ownership at exit x exit equity value; gross multiple on invested capital. Run three exit cases anchored to the public comps' revenue multiples, not to a round of applause.
4. Compare the terms to market: 1x non-participating is standard, a 10-15% post-money pool created in the pre-money, broad-based weighted-average anti-dilution, standard pro rata, and a 3 or 5 seat board (a 5-seat Series A board is typically 2 founders, 2 investors, 1 independent). Flag anything off-market in the risks section.
5. State the risks the way strong memos do: name them plainly, size them, and explain why underwriting the uncertainty is justified. Never bury a risk in a mitigant.
Produce, in order: callout with the recommendation and the one-sentence thesis; kpis (round, post-money, ownership, entry multiple on ARR, implied exit needed for a 10x); markdown with the ten sections as ## headings (short paragraphs, no padding); table "Metrics" from the user's CSV with a Verified? column; table "Returns" with Exit case, Exit value, Revenue multiple, Ownership at exit, Proceeds, MOIC; risks (3-5 with severity and mitigation); qa "Open questions for IC" (5); checklist "Conditions to closing"; caveats listing every company-reported figure that is not independently verified. ${CITE}`,
  prompt: (i) => `Draft the investment memo for ${str(i, "company")}. Terms: ${str(i, "terms")}. My leaning: ${str(i, "recommendation", "Invest with conditions")}.${str(i, "notes") ? `\n\nDiligence notes:\n${str(i, "notes")}` : ""}${list(i, "comps").length ? `\n\nPublic exit comps: ${list(i, "comps").join(", ")}.` : ""}`,
};

const icPreRead: ToolDef = {
  kind: "ai", id: "ic-pre-read", title: "IC pre-read & key questions", tagline: "The two-page pre-read partners will actually read, plus the questions they will ask.",
  description: "Compresses a deal into the pre-read circulated 24 to 72 hours before the partner meeting: the deal header, the thesis in three bullets, the three numbers that matter, the two risks that could kill it, what the deal lead is asking the committee to decide, and the anticipated partner questions with the answers already prepared.",
  roles: ["vc"], category: "Deliverables", icon: "Presentation", deliverable: "memo", savesMinutes: 120, tags: ["IC", "partner meeting", "pre-read"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true },
    { key: "terms", label: "Terms and ask", type: "textarea", required: true, placeholder: "Round, valuation, cheque, ownership, board, what you want IC to approve" },
    { key: "thesis", label: "Thesis in your words", type: "textarea", required: true },
    { key: "openItems", label: "Open diligence items", type: "textarea", placeholder: "What is not finished yet" },
    { key: "objections", label: "Expected objections", type: "text", placeholder: "e.g. price, competition from incumbents, single-product risk" },
  ],
  example: { company: "Perplexity", terms: "$30M at a $14B post-money, 0.21% ownership, information rights only, no board seat; asking IC to approve the full cheque with pro rata protected", thesis: "Answer engines take a durable share of high-intent commercial search; distribution deals and the browser wedge make the switching cost real; the comparable public multiples support a $50B+ outcome.", openItems: "Query-level retention data, gross margin after inference costs, and the enterprise pipeline are still outstanding", objections: "price relative to revenue, incumbent bundling, inference cost curve" },
  effort: "medium",
  instructions: `1. Verify the deal header before writing: form_d_search for the raise record and the officers named, search_startups for the directory row, web_research for the reported round and investors. The header must be right: round, amount, pre and post-money, cheque, ownership, board and information rights, pro rata, closing date.
2. Compress the thesis into three bullets of the form "we believe X, which is true if Y, and we will know by Z". Anything that cannot be stated that way is not yet a thesis.
3. Choose exactly three numbers that carry the argument (usually one growth, one retention or efficiency, one market) and one number that argues against it. Compute any derived figure with calc and label company-reported figures.
4. Write the decision request explicitly: the amount, the conditions, the reserve allocation being requested for follow-ons, and what the lead will do if the round prices higher.
5. Anticipate the partner questions. Generate 8-12, weighted to the objections field, and answer each in two or three sentences with the evidence or with an honest "not yet known, here is how we would find out". The questions a lead cannot answer are the agenda for the meeting.
Produce: kpis (round, post-money, cheque, ownership, ownership at exit after 45% dilution, reserve requested); callout with the decision being requested; bullets "Thesis" (exactly three, in the we-believe form); table "The numbers" with Metric, Value, Period, Source, Verified?; risks (the two that could kill it, with severity and mitigation); qa "Partner questions" (8-12 with prepared answers); checklist "Open diligence" with owner and due date; nextSteps ending with the decision date. ${CITE}`,
  prompt: (i) => `Write the IC pre-read for ${str(i, "company")}.\n\nTerms and ask: ${str(i, "terms")}\n\nThesis: ${str(i, "thesis")}${str(i, "openItems") ? `\n\nOpen items: ${str(i, "openItems")}` : ""}${str(i, "objections") ? `\n\nExpected objections: ${str(i, "objections")}` : ""}`,
};

const termSheetAnalyzer: ToolDef = {
  kind: "ai", id: "term-sheet-analyzer", title: "Term sheet analyzer", tagline: "Every term diffed against NVCA standard, with the off-market ones flagged.",
  description: "Reads a pasted term sheet and produces a term-by-term comparison against the NVCA model and current market practice: valuation and effective price after the pool, liquidation preference, participation, anti-dilution, board composition, protective provisions, pro rata, drag-along, ROFR and co-sale, redemption, pay-to-play and milestone tranches. Flags each term as market, aggressive or off-market with the push-back language and the questions for counsel.",
  roles: ["vc", "pe"], category: "Diligence", icon: "Scale", deliverable: "analysis", savesMinutes: 180, tags: ["term sheet", "NVCA", "legal", "negotiation"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true },
    { key: "termSheet", label: "Term sheet text", type: "textarea", required: true, placeholder: "Paste the term sheet (or the key terms section of the LOI)" },
    { key: "side", label: "You are", type: "select", options: ["The investor leading", "A co-investor", "An existing investor", "Advising the founder"], default: "The investor leading" },
    { key: "stage", label: "Stage", type: "select", options: ["Seed", "Series A", "Series B", "Series C / growth"], default: "Series A" },
  ],
  example: { company: "Example Series A", side: "The investor leading", stage: "Series A", termSheet: "Series A Preferred Stock. Amount: $12,000,000. Pre-money valuation: $48,000,000 including a 15% post-closing employee option pool created pre-closing. Liquidation preference: 1.5x participating, senior to all existing preferred. Anti-dilution: full ratchet. Dividends: 8% cumulative. Board: five directors, three designated by the Series A investor, one founder, one independent chosen by the investor. Protective provisions: consent of the Series A required for any sale, any financing, any new hire above $200,000, any budget approval, and any capital expenditure above $100,000. Pro rata: investor has a right to purchase up to 2x its pro rata in the next round. Redemption: redeemable at the investor's option after year 5 at cost plus 8%. Pay-to-play: preferred converts to common if the holder does not participate pro rata in any future round. No-shop: 60 days. Milestone tranche: 40% of the investment released on reaching $8M ARR." },
  effort: "high",
  instructions: `1. Extract every term into the NVCA order and quote the operative language for each: security and amount; pre-money and whether the option pool sits in the pre-money and at what size; price per share; liquidation preference (multiple, participating or not, cap, seniority or pari passu); dividends; anti-dilution; conversion; board composition; protective provisions; pro rata and super pro rata; drag-along; ROFR and co-sale; information rights; redemption; pay-to-play; no-shop and exclusivity; milestone tranches; founder vesting and acceleration; legal fee cap.
2. Mark each term Market / Aggressive / Off-market against the standard the research sets out: 1x non-participating is standard and multiples above 1x or participation are investor-aggressive and rare in early-stage US deals; broad-based weighted average is standard and full ratchet is rare and punitive; a 10-15% post-money pool created in the pre-money is standard; a 5-seat Series A board is typically 2 founders, 2 investors, 1 independent; protective provisions normally cover sale of the company, senior stock, debt above a threshold, dividends, board size and charter changes, and should not extend to ordinary budget, hiring or capex decisions; standard pro rata is market and super pro rata is off-market; cumulative dividends and investor-option redemption are off-market in venture; pay-to-play appears in down markets; milestone tranches are now formalised in the 2025 NVCA forms but shift risk to the founder.
3. Quantify the economics, not just the labels. Use calc to compute: the effective price per share after the pool (the option pool shuffle reduces the real pre-money, so show the pre-money net of the pool), the investor's post-money ownership, and what the preference is worth at three exit values. Show a 1x non-participating versus the proposed structure at each exit value so the difference is a number, not an adjective.
4. Write the push-back for every aggressive or off-market term: what to ask for, what to trade for it, and the fallback. Rank the terms by how much they are worth in dollars or control, and say which two to spend the negotiation on.
5. List the questions for counsel and the documents that must be read before signing (charter, prior SAFEs and side letters, existing preferences, MFN letters), and include the October 2025 NVCA additions: two-way national-security representations and QSBS threshold language.
Produce: kpis (terms reviewed, off-market count, effective pre-money after the pool, investor ownership, preference value at a mid exit); table "Term-by-term" with Term, What it says, NVCA standard, Verdict, Why it matters; callout naming the single worst term; table "Preference economics" comparing the proposed structure with 1x non-participating at three exit values; bullets "Push-back script" for each flagged term; qa "Questions for counsel" (6); risks with severity; caveats that this is not legal advice and that jurisdictional differences apply.`,
  prompt: (i) => `Analyse this ${str(i, "stage", "Series A")} term sheet for ${str(i, "company")}. I am ${str(i, "side", "the investor leading").toLowerCase()}.\n\n${str(i, "termSheet")}`,
};

/* ======================================================================================
 * AI workflows: pricing, portfolio and reporting
 * ====================================================================================== */

const roundComps: ToolDef = {
  kind: "ai", id: "round-comparables", title: "Round comparables", tagline: "Is this price market? Stage, sector and geography comps with the percentile.",
  description: "Prices a proposed round against stage medians and against actual comparable rounds: the Carta and PitchBook medians for pre-money, post-money, round size and dilution by stage, the AI premium, and named recent rounds found in the directory, Form D and the press. Returns a defensible range and the percentile the proposed price sits in.",
  roles: ["vc"], category: "Valuation", icon: "Percent", deliverable: "analysis", savesMinutes: 150, tags: ["valuation", "round comps", "pricing", "Carta"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true },
    { key: "stage", label: "Stage", type: "select", options: ["Pre-seed", "Seed", "Series A", "Series B", "Series C"], default: "Series A", required: true },
    { key: "pre", label: "Proposed pre-money", type: "number", unit: "$mm", required: true, default: 50 },
    { key: "raise", label: "Round size", type: "number", unit: "$mm", required: true, default: 12 },
    { key: "arr", label: "ARR (or revenue)", type: "number", unit: "$mm", default: 4 },
    { key: "growth", label: "YoY growth", type: "number", unit: "%", default: 200 },
    { key: "sector", label: "Sector", type: "text", placeholder: "AI applications, fintech infrastructure, devtools", default: "AI applications" },
    { key: "geo", label: "Geography", type: "text", default: "United States" },
  ],
  example: { company: "Example AI application company", stage: "Series A", pre: 84, raise: 16, arr: 5, growth: 200, sector: "AI applications", geo: "United States" },
  effort: "medium",
  instructions: `1. State the deal maths first with calc: post-money = pre + raise; dilution = raise / post; entry multiple = pre / ARR and post / ARR; ownership for the cheque.
2. Compare against the stage medians in the research, naming the source and the quarter: pre-seed median pre-money $7.7M (PitchBook Q4 2025) with ~$1M rounds and 10-15% dilution; seed pre-money ~$16M (Q3 2025) and post-money median $24M (Q4 2025) on $3.1-4M rounds and ~19.5-20% dilution; Series A pre-money $49.3M (Q3 2025) and post-money $78.7M (Q4 2025, +37% YoY) on $10-15M rounds and 18-20% dilution; Series B pre-money ~$119M on $30-40M rounds and ~14% dilution; Series C pre-money $300-400M on $50M+ rounds and 10-15% dilution. Apply the AI premium where it applies: seed ~$17.9M pre (42% above median) and Series A ~$84M pre (~70% above), with AI taking over 60% of Q1 2026 venture dollars.
3. Find named comparable rounds, not just medians: search_startups (unfiltered and with source "formd") for companies in the sector and stage, form_d_search to confirm amounts sold and dates, and web_research for reported post-money valuations of 5-10 truly comparable rounds. Tabulate each with the date, amount, reported post-money and the source; mark reported valuations as press-reported.
4. Adjust for the things that move price, in this order: growth rate against the Bessemer band for the ARR level, net retention, capital efficiency (burn multiple), team pedigree, round competitiveness, and sector premium. Convert the adjustment into a range, not a point, and place the proposed price in a percentile with the reasoning.
5. Cross-check with the private ARR multiple grid: 10-15x ARR at 100%+ growth, 7-10x at 50-100%, 5-8x at 20-50%. Say what multiple the proposal implies and whether the growth supports it.
Produce: kpis (post-money, dilution, ARR multiple, stage median pre-money, percentile); table "Stage medians" with Stage, Median pre, Median post, Median round, Median dilution, Source; table "Comparable rounds" with Company, Date, Round, Amount, Reported post-money, Source; bar of the proposed pre-money against the stage median, the AI-premium median and the comparable-round median; callout with the defensible range and the verdict; bullets "What would justify the top of the range"; caveats that private valuation data is self-reported and that medians lag by a quarter.`,
  prompt: (i) => `Is $${num(i, "pre", 50)}mm pre-money for a $${num(i, "raise", 12)}mm ${str(i, "stage", "Series A")} in ${str(i, "sector", "AI applications")} (${str(i, "geo", "United States")}) market for ${str(i, "company")}? ARR $${num(i, "arr", 4)}mm growing ${num(i, "growth", 200)}%.`,
};

const lateStageComps: ToolDef = {
  kind: "ai", id: "late-stage-public-comps", title: "Public comps for a late-stage round", tagline: "What the public market would pay, and what that implies for this private price.",
  description: "Builds the public comparable set for a late-stage private round from live SEC and market data, calendarises the multiples, and converts them into an implied private valuation range with the customary discount for illiquidity and scale. Uses recent IPOs as the most relevant anchors and states what the private price implies about the required public multiple at exit.",
  roles: ["vc", "pe"], specialties: ["Growth / late stage", "Secondaries", "Corporate VC", "Growth equity"], category: "Valuation", icon: "BarChart3", deliverable: "table", savesMinutes: 180, tags: ["comps", "late stage", "IPO", "exit"],
  fields: [
    { key: "company", label: "Private company", type: "text", required: true },
    { key: "arr", label: "ARR / revenue", type: "number", unit: "$mm", required: true, default: 200 },
    { key: "growth", label: "YoY growth", type: "number", unit: "%", default: 80 },
    { key: "grossMargin", label: "Gross margin", type: "number", unit: "%", default: 72 },
    { key: "fcfMargin", label: "FCF margin", type: "number", unit: "%", default: -15 },
    { key: "comps", label: "Public comps", type: "tickers", placeholder: "RDDT ARM CRWV FIG", help: "Leave empty and the model proposes the set" },
    { key: "pre", label: "Proposed pre-money", type: "number", unit: "$mm", default: 4000 },
  ],
  example: { company: "Example growth-stage AI infrastructure company", arr: 250, growth: 90, grossMargin: 68, fcfMargin: -10, comps: ["CRWV", "ARM", "RDDT", "FIG"], pre: 5000 },
  effort: "high",
  instructions: `1. Choose the comp set. If tickers are given, use them and say what each one anchors; if not, propose 5-8 US-listed companies matched on business model, growth and scale, and justify each in one clause. Recent IPOs (for example RDDT, ARM, CRWV, FIG) are the most relevant anchors for a company that will list.
2. Call get_trading_comps for the set and get_company_financials for the two closest comps. Record EV/LTM revenue, growth, gross margin, FCF margin and Rule of 40 for each, and compute the median and the growth-adjusted multiple (EV/revenue divided by growth) with calc.
3. Where a comp's multiple is an outlier, use search_filing on its latest 10-Q or 10-K for "remaining performance obligations", "net revenue retention", "guidance" or "outlook" to explain the premium or discount in one sentence rather than leaving it unexplained.
4. Apply the multiple to the private company's revenue, then adjust: a private, pre-IPO company customarily trades at a discount to the public set for illiquidity, scale and disclosure. State the discount you apply as a number and justify it. Also run the reverse: at the proposed pre-money, what EV/revenue multiple is being paid, what growth would justify it in the public set, and what revenue the company needs at exit to return a target multiple.
5. Anchor the exit case to the published IPO profile: $100M+ LTM revenue, ~65% growth, 120% net retention, 70% gross margin and visible FCF breakeven within one to two years, and note public SaaS trades broadly at 5-15x revenue with the BVP cloud index as the forward-multiple reference.
Produce: kpis (median EV/revenue, growth-adjusted multiple, implied EV at the median, implied EV after discount, multiple implied by the proposed price); table "Public comps" with Ticker, EV, EV/LTM revenue, Growth, Gross margin, FCF margin, Rule of 40, and a median row in totals; scatter of growth (x) versus EV/revenue (y) with the private company plotted at its proposed multiple and emphasised; table "Implied valuation" with Method, Multiple, Implied EV, Premium/discount to the proposal; bullets "What has to be true to IPO"; caveats on fiscal-year calendarisation, reported versus adjusted figures and the illiquidity discount being a judgement.`,
  prompt: (i) => `Build the public comp set and the implied valuation for ${str(i, "company")}: $${num(i, "arr", 200)}mm revenue growing ${num(i, "growth", 80)}%, ${num(i, "grossMargin", 72)}% gross margin, ${num(i, "fcfMargin", -15)}% FCF margin. Proposed pre-money $${num(i, "pre", 4000)}mm.${list(i, "comps").length ? ` Comps: ${list(i, "comps").join(", ")}.` : ""}`,
};

const secondaryPricing: ToolDef = {
  kind: "ai", id: "direct-secondary-pricing", title: "Direct secondary pricing", tagline: "What a block of private shares is worth, and the discount to expect.",
  description: "Prices a direct secondary purchase or sale of private shares: the last primary round price, the share class being sold and what rights it carries, observed secondary and tender-offer marks, the public comp anchor, and the discount range a buyer should expect after ROFR, transfer restrictions and information asymmetry. Ends with a bid range and the process steps.",
  roles: ["vc", "pe"], specialties: ["Secondaries", "Growth / late stage", "Angel / syndicate", "Growth equity"], category: "Valuation", icon: "ArrowLeftRight", deliverable: "analysis", savesMinutes: 150, tags: ["secondaries", "tender", "liquidity", "pricing"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true },
    { key: "side", label: "You are", type: "select", options: ["Buying a block", "Selling a block", "Advising an employee seller"], default: "Buying a block" },
    { key: "shareClass", label: "Share class", type: "select", options: ["Common / options exercised", "Series A-B preferred", "Late-stage preferred", "SPV / forward contract"], default: "Common / options exercised" },
    { key: "size", label: "Block size", type: "number", unit: "$mm", default: 5 },
    { key: "lastRound", label: "Last round post-money", type: "number", unit: "$mm", default: 3000 },
    { key: "comps", label: "Public comps", type: "tickers", placeholder: "RDDT ARM CRWV FIG" },
  ],
  example: { company: "Anysphere (Cursor)", side: "Buying a block", shareClass: "Common / options exercised", size: 5, lastRound: 9900, comps: ["CRWV", "FIG", "RDDT"] },
  effort: "high",
  instructions: `1. Establish the primary anchor: form_d_search for the most recent offering (amount sold, date of first sale) and web_research for the reported post-money and the date. Compute the age of the mark in months with calc; a mark older than two quarters is stale and the public comps should carry more weight.
2. Establish the share class difference. Common sold by an employee sits behind every preference in the stack, so it is worth less than the last preferred price by construction; quantify the gap by reference to the preference overhang (total invested capital and any multiple above 1x) rather than asserting a percentage. If a waterfall is needed, say so and point to the exit waterfall calculator.
3. Find observed secondary evidence with web_research: completed tender offers (company-sponsored purchases of employee and early shares), reported secondary trades, marketplace indications, and any mutual-fund mark disclosures. Note the platform context from the research: secondary marketplaces show meaningful monthly volume and thousands of pre-IPO names with frequently updated indications, and tender offers and secondary sales have been the largest source of realised liquidity.
4. Anchor to the public market with get_trading_comps on the comps and convert to an implied EV/revenue for the private name if revenue is known; then build the discount stack explicitly: illiquidity, information asymmetry, transfer restrictions and ROFR delay, class subordination, and any forward-contract or SPV structure discount. Show it as a table of percentage deductions from the last round price.
5. Set the bid or ask range and the walk-away. Then list the process steps: confirm the share class and vesting, request the company's transfer policy, budget for ROFR (typically 30 days plus), confirm the buyer qualifies, model the tax consequences for the seller, and decide whether an SPV or forward is acceptable.
Produce: kpis (last round post-money and its age, implied price per share if known, indicative discount, bid range low and high); table "Discount stack" with Factor, Deduction, Rationale; table "Observed marks" with Source, Date, Price or discount, What it covers; waterfall from the last round price to the bid (as deduction steps with the bid as a total); steps for the process; risks (ROFR, stale mark, class subordination, blocked transfer) with severity; caveats that secondary pricing is negotiated and that marketplace indications are not executed trades. ${CITE}`,
  prompt: (i) => `Price a ${str(i, "side", "Buying a block").toLowerCase()} transaction in ${str(i, "company")}: $${num(i, "size", 5)}mm of ${str(i, "shareClass", "common")}, last round post-money $${num(i, "lastRound", 3000)}mm.${list(i, "comps").length ? ` Public anchors: ${list(i, "comps").join(", ")}.` : ""}`,
};

const cvcFit: ToolDef = {
  kind: "ai", id: "cvc-strategic-fit", title: "Corporate VC strategic fit", tagline: "Does this investment help the business unit, and what does the sponsor have to sign?",
  description: "Assesses a startup for a corporate venture mandate on both axes: the financial case and the strategic case for the sponsoring business unit. Covers the commercial relationship that justifies the investment, the channel and procurement path, the competitive and antitrust sensitivities, the information rights a strategic can actually have, and the internal approval package the business-unit sponsor must sign.",
  roles: ["vc"], specialties: ["Corporate VC", "Growth / late stage"], category: "Diligence", icon: "Building2", deliverable: "memo", savesMinutes: 180, tags: ["CVC", "strategic", "corporate", "partnership"],
  fields: [
    { key: "company", label: "Startup", type: "text", required: true },
    { key: "parent", label: "Corporate parent", type: "ticker", required: true, placeholder: "MSFT" },
    { key: "unit", label: "Sponsoring business unit and its goal", type: "textarea", required: true, placeholder: "Which P&L sponsors this, what it is trying to do, what it would buy or resell" },
    { key: "terms", label: "Proposed terms", type: "textarea", placeholder: "Cheque, valuation, rights sought, commercial agreement attached" },
  ],
  example: { company: "Harvey", parent: "MSFT", unit: "The industry-solutions group for legal and professional services: it sells cloud and productivity into Am Law firms and wants a differentiated agentic workflow layer it can co-sell rather than build", terms: "$25M at a $6B post-money, information rights, no board seat, a co-sell agreement and marketplace listing attached" },
  effort: "high",
  instructions: `1. Ground the parent in real numbers: get_company_financials on the parent ticker, and search_filing on its latest 10-K for "strategy", "segment", "competition" and the relevant product line to establish what the sponsoring unit's P&L actually looks like and what management has told the market it is prioritising. Cite the filing.
2. Ground the startup: search_startups for the directory row, form_d_search for the raise record and officers, web_research for product, customers, competitors and any existing relationship with the parent or its competitors.
3. Score the strategic case on five axes with evidence: does it accelerate a stated priority of the parent; is there a concrete commercial relationship (reseller, co-sell, marketplace, embedded OEM, procurement) and what is it worth; does it defend against a specific competitor; does it give the parent information or optionality it cannot buy; and would the parent be a credible acquirer later.
4. Score the financial case separately using the same discipline as a financial investor: ownership for the cheque, entry multiple, exit paths (and the fact that a strategic investor's presence can narrow the buyer universe), and whether the price is market against stage medians.
5. Handle the frictions a corporate investor must handle and that financial investors do not: signalling risk to the startup's other customers; competitive information walls and what information rights are actually acceptable; antitrust and exclusivity limits; the parent's procurement and security review as a gating item for the commercial agreement; and the internal approval path with the business-unit sign-off that slows corporate cycles.
6. Write the approval package: the one-page case for the sponsor, the commercial milestones that justify the investment independent of the financial return, and the conditions under which the parent would walk away.
Produce: kpis (cheque, ownership, entry multiple, revenue opportunity for the unit, strategic score out of 25); score block on the five strategic axes; table "Strategic case" with Axis, Evidence, Source, Score; table "Commercial agreement" with Element, What we want, What is realistic, Owner; risks (signalling, information walls, antitrust, buyer-universe narrowing) with severity and mitigation; checklist "Internal approvals" with owner; bullets "What the sponsor signs"; caveats that antitrust and information-wall questions are counsel's. ${CITE}`,
  prompt: (i) => `Assess ${str(i, "company")} for ${str(i, "parent").toUpperCase()}'s corporate venture mandate.\n\nSponsoring unit: ${str(i, "unit")}${str(i, "terms") ? `\n\nProposed terms: ${str(i, "terms")}` : ""}`,
};

const boardPrep: ToolDef = {
  kind: "ai", id: "board-meeting-prep", title: "Board meeting prep", tagline: "Read the deck before the room: the three decisions, the numbers that changed, the questions to ask.",
  description: "Prepares an investor for a portfolio board meeting: reconciles the metrics in the board deck against the prior quarter, identifies the three decisions the board actually has to make, drafts the questions that surface what the deck omits, and sets out the cash, hiring and financing timeline the board must own. Produces the pre-read notes and a follow-up action list.",
  roles: ["vc"], specialties: ["Series A-B", "Growth / late stage", "Corporate VC"], category: "Portfolio", icon: "Briefcase", deliverable: "memo", savesMinutes: 120, tags: ["board", "portfolio", "governance"],
  fields: [
    { key: "company", label: "Company", type: "text", required: true },
    { key: "deck", label: "Board deck / update text", type: "textarea", required: true, placeholder: "Paste the deck text or the founder update" },
    { key: "priorQuarter", label: "Prior quarter numbers", type: "textarea", placeholder: "What was reported last quarter, and what was promised" },
    { key: "role", label: "Your role", type: "select", options: ["Board director", "Board observer", "Lead investor, no seat", "Follow-on investor"], default: "Board director" },
    { key: "agenda", label: "What you want on the agenda", type: "text", placeholder: "e.g. pricing change, VP Sales hire, bridge vs priced round" },
  ],
  example: { company: "Example Series B portfolio company", role: "Board director", deck: "Q3: ARR $18.4M (from $16.1M), net new $2.3M, logo churn 1.8% monthly, gross margin 71%, net burn $2.1M/month, cash $26M. Hiring: 12 open roles, VP Sales search in final stage. Pipeline: $9M weighted. Plan for Q4: launch usage-based pricing, open EMEA, close the Series C in Q2 next year at a $400M+ pre.", priorQuarter: "Q2 reported ARR $16.1M, net burn $1.7M/month, cash $32M, promised a VP Sales by end of Q3 and gross margin improvement to 74%", agenda: "burn trajectory versus the Series C timing, and the VP Sales decision" },
  effort: "medium",
  instructions: `1. Reconcile the deck against the prior quarter and against what was promised. Use calc for: quarter-over-quarter and annualised ARR growth, net new ARR, implied burn multiple (net burn / net new ARR), runway in months (cash / monthly net burn), months of runway at the current plan versus at the promised plan, and gross margin change. Every variance to what was promised is a board item.
2. Name what the deck omits. The standard omissions are cohort retention, revenue concentration, pipeline conversion by stage, churn by segment, sales rep productivity and the cash bridge to the next round. List the missing items explicitly and request them.
3. Choose the three decisions the board must make this meeting, each stated as a choice with options and a recommendation, not as a discussion topic. Include the financing decision if runway is under 12 months: bridge, insider round or priced round, and what the company must show to price it.
4. Benchmark the key metrics against the stage benchmarks (burn multiple under 0.8x is top quartile and 1.2-1.8x is median; net retention above 120% is the Bessemer average; CAC payback under 18 months for mid-market) so the board conversation is calibrated rather than anecdotal.
5. Use web_research only for external context the board needs (a competitor's raise, a pricing move, a market event) and cite it. Do not pad the pre-read with market commentary.
Produce: kpis (ARR, QoQ growth, net burn, runway in months, burn multiple, cash); table "Reported versus promised" with Metric, Prior quarter, This quarter, Promised, Variance, tone-carrying comment; bullets "What the deck does not show" (the requests); steps "Three decisions" each with the options and your recommendation; qa "Questions to ask in the room" (8); timeline of the next two quarters with the financing and hiring milestones; checklist of follow-ups with owner and due; risks with severity.`,
  prompt: (i) => `Prepare me for ${str(i, "company")}'s board meeting. I am a ${str(i, "role", "board director").toLowerCase()}.${str(i, "agenda") ? ` I want on the agenda: ${str(i, "agenda")}.` : ""}\n\nBoard deck:\n${str(i, "deck")}${str(i, "priorQuarter") ? `\n\nPrior quarter:\n${str(i, "priorQuarter")}` : ""}`,
};

const lpLetter: ToolDef = {
  kind: "ai", id: "lp-update-letter", title: "Portfolio update / LP letter", tagline: "The quarterly letter: new investments, markups, markdowns, DPI and what you are seeing.",
  description: "Drafts the quarterly LP letter from portfolio data in the fund's own voice: the quarter's activity, new investments with the thesis in two sentences each, material markups and markdowns with the basis for the change, realisations and DPI, fund-level TVPI and IRR, the market view, and the capital plan. Includes the capital account and performance figures in the order LPs expect.",
  roles: ["vc", "pe"], category: "Reporting", icon: "ScrollText", deliverable: "memo", savesMinutes: 300, tags: ["LP", "reporting", "quarterly letter", "ILPA"],
  fields: [
    { key: "fund", label: "Fund", type: "text", required: true, placeholder: "Fund II, $85M, 2023 vintage" },
    { key: "quarter", label: "Quarter", type: "text", required: true, placeholder: "Q3 2026", default: "Q3 2026" },
    { key: "portfolio", label: "Portfolio data", type: "csv", required: true, columns: "company, invested ($mm), current value ($mm), ownership %, last round, mark basis, status", help: "One row per position" },
    { key: "activity", label: "Quarter activity and commentary", type: "textarea", placeholder: "New investments, follow-ons, exits, notable news, what you are seeing in the market" },
    { key: "metrics", label: "Fund metrics", type: "text", placeholder: "e.g. called 62%, DPI 0.15x, TVPI 1.6x, net IRR 18%" },
  ],
  example: { fund: "Fund II, $85M, 2023 vintage", quarter: "Q3 2026", portfolio: "company,invested,current value,ownership,last round,mark basis,status\nAlpha AI,3.0,14.0,9.5%,Series B at $220M post,last round,markup\nBeta Data,2.5,2.5,8.0%,Seed at $28M post,last round,flat\nGamma Health,2.0,0.6,7.0%,Series A at $60M post,impairment,markdown\nDelta Dev,1.5,6.2,6.0%,Series A at $150M post,last round,markup\nEpsilon Fin,2.0,0.0,0.0%,none,written off,written off", activity: "Two new investments this quarter, one follow-on into the top position, one write-off. Seed pricing in AI applications remains 40-70% above the broader median and we passed on four deals on price.", metrics: "called 62%, DPI 0.10x, TVPI 1.58x, net IRR 16%" },
  effort: "medium",
  instructions: `1. Parse the portfolio CSV and compute with calc, showing the arithmetic: total invested, total fair value, gross multiple by position and for the fund, unrealised versus realised, and the contribution of the top position to total value (the power law should be visible and named). Reconcile the stated fund metrics against the portfolio data and flag any inconsistency rather than papering over it.
2. Structure the letter the way LPs read it: (1) one-paragraph summary with the headline numbers; (2) fund performance (called, distributed, DPI, RVPI, TVPI, net IRR) with the definitions stated once; (3) new investments this quarter, two sentences each (what it does, why we own it, ownership); (4) material value changes, markups and markdowns, each with the basis for the mark; (5) realisations and the liquidity path; (6) what we are seeing in the market; (7) capital plan and the next call.
3. Be precise on marks. For each markup or markdown name the basis: a new priced round, a tender or secondary, a milestone miss, a peer-multiple move, or an impairment. This is the paragraph auditors and LPs read most closely. Where the basis is judgement, say so.
4. Calibrate performance honestly against the vintage benchmarks: 2021-vintage medians are near 1.0x TVPI with DPI close to zero at year five; 2018 vintage median TVPI ~1.6x with DPI 0.15x; top quartile for mature vintages is roughly 25%+ net IRR and 3x+ TVPI; distributions industry-wide have been at about 14% of NAV for four straight years. A letter that ignores the liquidity environment reads as naive.
5. Note the reporting standards where relevant: the ILPA Reporting Template v2.0 (fees, expenses, offsets, carry, cash-flow detail) applies to funds still investing in Q1 2026 or launched after 1 January 2026, and the ILPA Performance Template standardises gross and net IRR, TVPI and MOIC for funds starting from 1 January 2026.
Produce: kpis (TVPI, DPI, net IRR, called %, fair value, top position share of value); markdown with the seven sections as ## headings, written in plain institutional prose, no marketing adjectives; table "Portfolio" with Company, Invested, Fair value, Multiple, Ownership, Last round, Mark basis, Status, with totals; bar of fair value by position; table "Value changes this quarter" with Company, Change, Basis; bullets "Market view"; nextSteps with the capital call plan; caveats that marks are Level 3 fair value estimates under ASC 820 and subject to audit.`,
  prompt: (i) => `Draft the ${str(i, "quarter", "Q3 2026")} LP letter for ${str(i, "fund")}.${str(i, "metrics") ? ` Fund metrics: ${str(i, "metrics")}.` : ""}${str(i, "activity") ? `\n\nActivity and commentary:\n${str(i, "activity")}` : ""}`,
};

const markAssistant: ToolDef = {
  kind: "ai", id: "asc-820-mark", title: "Quarterly mark & valuation memo", tagline: "Roll forward a Level 3 mark with a documented basis the auditor will accept.",
  description: "Produces the quarterly fair-value mark for a private position under ASC 820: calibration to the last round rolled forward, a guideline public company cross-check from live market data, the triggers that justify a change, and the valuation memo documenting the judgement. Says when the answer is to hold the mark at the last round price.",
  roles: ["vc", "pe"], specialties: ["Growth / late stage", "Secondaries", "Corporate VC", "Growth equity", "Fund of funds / LP"], category: "Accounting & audit", icon: "Landmark", deliverable: "memo", savesMinutes: 180, tags: ["ASC 820", "marks", "fair value", "audit"],
  fields: [
    { key: "company", label: "Position", type: "text", required: true },
    { key: "lastRound", label: "Last round", type: "textarea", required: true, placeholder: "Date, price per share, post-money, class purchased, amount raised, lead" },
    { key: "held", label: "Our position", type: "textarea", required: true, placeholder: "Class, shares, cost, current carrying value, ownership %" },
    { key: "kpis", label: "Current KPIs vs the round case", type: "textarea", placeholder: "ARR, growth, burn, runway, milestones hit or missed since the round" },
    { key: "comps", label: "Guideline public companies", type: "tickers", placeholder: "RDDT ARM CRWV FIG" },
    { key: "asOf", label: "Valuation date", type: "date", default: "2026-09-30" },
  ],
  example: { company: "Example Series B position", lastRound: "Series B priced 2025-11-14 at $9.40 per share, $220M post-money, $40M raised, led by a crossover fund; we bought Series A-1 preferred", held: "Series A-1 preferred, 1.45M shares, cost $3.0M, carrying value $13.6M, 9.5% fully diluted", kpis: "ARR $24M versus a $28M plan, growth 85% versus 110% planned, net burn $1.9M per month, runway 14 months, EMEA launch slipped a quarter", comps: ["CRWV", "FIG", "RDDT"], asOf: "2026-09-30" },
  effort: "high",
  instructions: `1. State the framework: private positions are Level 3 under ASC 820; the primary method for a recently priced company is calibration to the last transaction price rolled forward, with guideline public company multiples and precedent transactions as cross-checks, PWERM where an exit is near, and DCF only for cash-generative later-stage companies.
2. Test the triggers for a change since the last valuation date, one by one, and record the answer for each: a new round or tender or secondary (use form_d_search and web_research to check), milestone hits or misses, peer multiple moves, a change in the capital structure or in rights (ratchets, participation, seniority), a financing need inside 12 months, and any impairment indicator. If no trigger fired, the defensible answer is to hold the mark, and you should say so.
3. Run the calibration: implied revenue or ARR multiple at the last round, the current multiple of the guideline set from get_trading_comps, and the roll-forward that applies the change in the guideline multiple to the company's current metric. Do the arithmetic with calc and show each step. Where the company's performance diverges from the round case, adjust the metric, not the multiple, and say which you changed.
4. Handle the class allocation honestly: the price of a preferred round is not the value of every class. Note whether an option-pricing (backsolve) allocation is needed to allocate equity value across classes, and flag it as a specialist step with a third-party valuation provider where the position is material.
5. Write the memo: valuation date, position, method selected and why, inputs with sources, the calculation, the conclusion (value per share and total), sensitivities, and the alternative methods considered and rejected. Auditors prefer independent third-party support for material Level 3 positions; say when to get it.
Produce: kpis (carrying value, proposed fair value, change, implied multiple, guideline median multiple); table "Trigger assessment" with Trigger, Evidence, Fired?, Effect; table "Calibration" with Input, At last round, At valuation date, Source; waterfall from the carrying value to the proposed mark (metric change, multiple change, proposed value as a total); markdown "Valuation memo" with the sections listed above; callout with the recommended mark and whether third-party support is needed; caveats that Level 3 inputs are judgements, that this is not an audit opinion, and that the allocation across share classes requires an option-pricing model. ${CITE}`,
  prompt: (i) => `Roll forward the mark for ${str(i, "company")} as of ${str(i, "asOf", "2026-09-30")}.\n\nLast round: ${str(i, "lastRound")}\nOur position: ${str(i, "held")}${str(i, "kpis") ? `\nCurrent KPIs: ${str(i, "kpis")}` : ""}${list(i, "comps").length ? `\nGuideline public companies: ${list(i, "comps").join(", ")}.` : ""}`,
};

const operatorEquity: ToolDef = {
  kind: "ai", id: "operator-equity-guide", title: "How operators get equity", tagline: "Advisor shares, angel cheques, syndicates, scouts and rolling funds, with the numbers.",
  description: "Maps every route an operator has to owning startup equity and prices each one: FAST-framework advisor grants by stage and involvement, angel cheques on post-money SAFEs, syndicate and SPV economics with carry and fees, scout programmes, and rolling or micro-funds. Turns a profile into a recommended route with the ownership and dollar consequences and the first three steps.",
  roles: ["vc", "student"], specialties: ["Angel / syndicate", "Pre-seed / seed", "Private equity / VC"], category: "Learning", icon: "Handshake", deliverable: "research", savesMinutes: 120, tags: ["angel", "advisor", "FAST", "syndicate", "scout"],
  fields: [
    { key: "profile", label: "Your profile", type: "textarea", required: true, placeholder: "Role, expertise, network, how much time you can give, how much you can invest" },
    { key: "capital", label: "Capital available per year", type: "number", unit: "$mm", default: 0.1 },
    { key: "goal", label: "Goal", type: "select", options: ["Build a portfolio of angel positions", "Advise a few companies for equity", "Lead a syndicate", "Become a scout for a fund", "Raise a rolling or micro-fund"], default: "Build a portfolio of angel positions" },
    { key: "sectors", label: "Where you have an edge", type: "text", placeholder: "e.g. enterprise security, payments operations, developer communities" },
  ],
  example: { profile: "Staff engineer turned head of platform at a public infrastructure company; twelve years in developer tooling; strong network among platform engineering leaders; can give two hours a week per company and invest modestly", capital: 0.15, goal: "Build a portfolio of angel positions", sectors: "developer tooling, platform engineering, observability" },
  effort: "medium",
  instructions: `1. Price advisor equity with the FAST framework: 0.25-1.0% at idea stage, 0.2-0.8% at seed, 0.15-0.6% at Series A and later, by involvement tier (standard, strategic, expert), granted as NSOs vesting monthly over two years, usually without a cliff. Convert the percentage into dollars at a realistic post-money for each stage and state what "expert" involvement actually requires in hours.
2. Price angel cheques: on a post-money SAFE, ownership sold = investment / post-money cap, so a $500K cheque at a $6.7M cap is about 7.5%. Use the 2026 cap norms (roughly $10M post-money caps for $250K-1M raises, ~$15M for $1-2.5M, priced rounds above $2.5M) to show what the user's annual capital buys at each stage, and apply the common angel sizing rule of 1-2% of net worth per deal and 5-10% overall.
3. Price syndicate and SPV economics: a lead typically earns 10-20% carry and sometimes a 1-2% fee, with formation, filings and K-1s handled by a platform. Show the carry dollars at 3x, 5x and 10x on a representative SPV size, and note that prolific leads run hundreds of SPVs.
4. Cover scouts (a firm's capital deployed through a dashboard, paid from a carry pool, deal-by-deal or programme-wide) and rolling or micro-funds (typically $5-20M vehicles with quarterly capital), including what each demands in deal flow before it works.
5. Match to the profile. Rank the routes for this specific person on time required, capital required, expected ownership, dependency on proprietary deal flow, and how fast the first position happens. Use search_startups and web_research to name concrete starting points: programmes, syndicate platforms, and 5-10 companies in the user's edge sectors where their expertise is directly useful.
Produce: kpis (route recommended, annual capital, ownership per advisory role, carry at 5x on a representative SPV); table "Routes" with Route, What you give, What you get, Typical economics, Time required, Speed to first position; table "FAST advisor grants" with Stage, Standard, Strategic, Expert (as percentages and as dollars at a stated post-money); bar of expected ownership by route; steps "Your first three moves"; bullets "How the deal flow actually arrives"; caveats that grants and carry are negotiated, that securities rules constrain who may invest and how deals may be marketed, and that this is not legal or tax advice.`,
  prompt: (i) => `Profile:\n${str(i, "profile")}\n\nGoal: ${str(i, "goal", "Build a portfolio of angel positions")}. Capital available per year: $${num(i, "capital", 0.1)}mm.${str(i, "sectors") ? ` Edge: ${str(i, "sectors")}.` : ""}`,
};

/* ======================================================================================
 * Calculators
 * ====================================================================================== */

/** Priced round with stacked SAFE conversion, option pool top-up, and ownership by holder. */
const capTable: ToolDef = {
  kind: "calc", id: "cap-table-dilution", title: "Cap table & dilution", tagline: "Price a round with SAFEs converting, the pool top-up, and ownership by holder.",
  description: "Builds the pro forma cap table for a priced round: converts a stack of post-money and pre-money SAFEs (with discounts) at their own prices, creates the option pool top-up inside the pre-money, solves the price per share, and reports ownership by holder before and after. Compares founder ownership with the Carta stage medians.",
  roles: ["vc", "student"], category: "Modeling", icon: "PieChart", savesMinutes: 90, tags: ["cap table", "dilution", "SAFE", "option pool"],
  fields: [
    { key: "company", label: "Company", type: "text", placeholder: "Anysphere (Cursor)" },
    { key: "founderShares", label: "Founder common", type: "number", unit: "shares mm", required: true, default: 8 },
    { key: "otherCommon", label: "Other issued common (employees, advisors)", type: "number", unit: "shares mm", default: 1 },
    { key: "pool", label: "Unissued options in the existing pool", type: "number", unit: "shares mm", default: 0.5 },
    { key: "safes", label: "SAFE stack", type: "textarea", placeholder: "Seed SAFE, 2, 20, post\nAngel syndicate, 0.5, 25, post, 10", help: "One per line: name, amount ($mm), cap ($mm), post|pre, discount %. Leave empty for a clean priced round." },
    { key: "pre", label: "Pre-money valuation", type: "number", unit: "$mm", required: true, default: 48 },
    { key: "newMoney", label: "New money", type: "number", unit: "$mm", required: true, default: 12 },
    { key: "poolTarget", label: "Post-money option pool", type: "number", unit: "%", default: 12, help: "Created inside the pre-money: the option pool shuffle" },
  ],
  example: { company: "Anysphere (Cursor) - illustrative Series A", founderShares: 8, otherCommon: 1, pool: 0.5, safes: "Seed SAFE, 2, 20, post\nAngel syndicate, 0.5, 25, post\nFriends round, 0.25, 8, pre, 20", pre: 48, newMoney: 12, poolTarget: 12 },
  compute: (i: Inputs): WorkflowOutput => {
    const founders = num(i, "founderShares"), other = num(i, "otherCommon"), pool = num(i, "pool");
    if (founders <= 0) throw new Error("Founder common must be positive (millions of shares).");
    if (other < 0 || pool < 0) throw new Error("Share counts cannot be negative.");
    const safes = parseSafes(str(i, "safes"));
    const pre = num(i, "pre"), newMoney = num(i, "newMoney"), poolTarget = num(i, "poolTarget") / 100;
    const r = priceRound({ common: founders + other, pool, safes, pre, newMoney, poolTarget });
    const name = str(i, "company") || "the company";
    const holders: { label: string; shares: number }[] = [
      { label: "Founders", shares: founders },
      ...(other > 0 ? [{ label: "Other common (employees, advisors)", shares: other }] : []),
      { label: `Option pool (${fmt.num(pool, 2)} existing + ${fmt.num(r.poolTopUp, 2)} top-up)`, shares: pool + r.poolTopUp },
      ...r.safeRows.map((s) => ({ label: `${s.name} (${s.kind}-money SAFE)`, shares: s.shares })),
      ...(r.newShares > 0 ? [{ label: "New investor", shares: r.newShares }] : []),
    ];
    const preBase = founders + other + pool + r.safeRows.reduce((a, s) => a + s.shares, 0);
    const safePct = r.safeRows.reduce((a, s) => a + s.shares, 0) / r.fdPost;
    const founderPct = founders / r.fdPost;
    const carta = [{ label: "After seed", value: 0.56 }, { label: "After Series A", value: 0.36 }, { label: "After Series B", value: 0.23 }];
    const pres = [pre * 0.7, pre * 0.85, pre, pre * 1.15, pre * 1.3];
    const pools = [0, 0.05, 0.1, poolTarget > 0.1 ? poolTarget : 0.15, 0.2];
    const grid = pres.map((p) => pools.map((q) => {
      try { return founders / priceRound({ common: founders + other, pool, safes, pre: p, newMoney, poolTarget: q }).fdPost; } catch { return null; }
    }));
    return {
      title: `Pro forma cap table: ${name}`,
      summary: `At a ${fmt.money(pre)} pre-money with ${fmt.money(newMoney)} of new money the price per share is ${fmt.moneyRaw(r.pps, 4)} and the post-money is ${fmt.money(r.post)}. The new investor takes ${fmt.pct(r.newShares / r.fdPost)}, the ${r.safeRows.length} converting SAFE${r.safeRows.length === 1 ? "" : "s"} take ${fmt.pct(safePct)}, the pool sits at ${fmt.pct((pool + r.poolTopUp) / r.fdPost)} post-money, and founders end at ${fmt.pct(founderPct)}${r.poolTopUp > 0 ? `. The ${fmt.num(r.poolTopUp, 2)}mm-share pool top-up is created inside the pre-money, so it dilutes everyone except the new investor` : ""}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Price per share", value: fmt.moneyRaw(r.pps, 4) }, { label: "Post-money", value: fmt.money(r.post) },
          { label: "New investor", value: fmt.pct(r.newShares / r.fdPost), hint: "new money / post-money" },
          { label: "SAFE holders", value: fmt.pct(safePct) },
          { label: "Founders", value: fmt.pct(founderPct), tone: founderPct >= 0.5 ? "pos" : founderPct >= 0.3 ? "neutral" : "warn" },
          { label: "Fully diluted shares", value: `${fmt.num(r.fdPost, 2)}mm` },
        ] },
        { type: "table", title: "Ownership by holder", columns: ["Holder", "Shares (mm)", "% before the round", "% after the round", "Value at post ($mm)"],
          rows: holders.map((h) => [h.label, fmt.num(h.shares, 3), h.label === "New investor" ? "-" : fmt.pct(h.shares / preBase), fmt.pct(h.shares / r.fdPost), fmt.num((h.shares / r.fdPost) * r.post, 1)]),
          totals: ["Total", fmt.num(r.fdPost, 3), "100.0%", "100.0%", fmt.num(r.post, 1)], emphasisRow: 0,
          note: `Pre-money fully diluted excludes the pool top-up (${fmt.num(r.poolTopUp, 2)}mm shares) and the new money. Post-money SAFEs convert at cap / capitalisation (${fmt.num(r.capForSafes, 2)}mm shares); pre-money SAFEs at cap / (common + pool incl. top-up).` },
        { type: "table", title: "SAFE conversion", columns: ["SAFE", "Type", "Amount ($mm)", "Cap ($mm)", "Conversion price", "Shares (mm)", "% post-round", "Discount to round price"],
          rows: r.safeRows.length ? r.safeRows.map((s) => [s.name, s.kind === "post" ? "Post-money" : "Pre-money", fmt.num(s.amount, 2), fmt.num(safes.find((x) => x.name === s.name)?.cap ?? 0, 1), fmt.moneyRaw(s.price, 4), fmt.num(s.shares, 3), fmt.pct(s.shares / r.fdPost), fmt.pct(1 - s.price / r.pps)]) : [["No SAFEs", "-", "-", "-", "-", "-", "-", "-"]] },
        { type: "bar", title: "Ownership after the round", format: "pct", data: holders.map((h) => ({ label: h.label.replace(/ \(.*\)$/, ""), value: h.shares / r.fdPost, emphasis: h.label === "Founders" })) },
        { type: "bar", title: "Founder ownership vs Carta stage medians", format: "pct", data: [{ label: "This round", value: founderPct, emphasis: true }, ...carta.map((c) => ({ label: c.label, value: c.value }))] },
        { type: "sensitivity", title: "Founder ownership after the round: pre-money × post-money pool", rowLabel: "Pre-money ($mm)", colLabel: "Pool target", rows: pres.map((p) => fmt.num(p, 0)), cols: pools.map((q) => fmt.pct(q, 0)), values: grid, format: "pct", baseRow: 2, baseCol: 3 },
      ],
      caveats: [
        "Post-money SAFE capitalisation includes common, the existing unissued pool and every converting SAFE, and excludes the new pool increase and the new money (YC post-money safe). Pre-money SAFEs are priced off the capitalisation excluding other SAFEs, so they dilute one another.",
        "Discount SAFEs convert at the lower of the cap price and the round price less the discount. MFN SAFEs must be re-entered with the terms they inherit.",
        "The pool top-up is created inside the pre-money, so existing holders bear it: the option pool shuffle reduces the effective price the investor pays.",
        "Carta medians for founder ownership: roughly 56% after seed, 36% after Series A, 23% after Series B. Side letters, non-standard SAFEs and secondary transfers need a lawyer to read.",
      ],
      nextSteps: ["Run the exit waterfall with these classes to see who converts", "Check the pro rata cost of defending this ownership in the next round", "Compare the price with the round comparables workflow"],
    };
  },
};

/** SAFE stack to equity: conversion price, shares and ownership for every SAFE in a priced round. */
const safeConversion: ToolDef = {
  kind: "calc", id: "safe-to-equity", title: "SAFE-to-equity conversion table", tagline: "What each SAFE actually converts into, and the effective valuation it paid.",
  description: "Converts a stack of post-money, pre-money and discount SAFEs into a priced round and shows, per SAFE, the conversion price, the shares issued, the post-round ownership, the effective pre-money it paid, and its paper markup against the round price. Shows the cross-dilution pre-money SAFEs cause each other.",
  roles: ["vc", "student"], specialties: ["Pre-seed / seed", "Angel / syndicate", "Private equity / VC"], category: "Modeling", icon: "Layers", savesMinutes: 60, tags: ["SAFE", "conversion", "pre-seed", "seed"],
  fields: [
    { key: "safes", label: "SAFE stack", type: "textarea", required: true, placeholder: "Angel A, 0.5, 8, post\nSeed SAFE, 0.75, 10, post\nMFN note, 0.25, 10, post", help: "One per line: name, amount ($mm), cap ($mm), post|pre, discount %" },
    { key: "common", label: "Common outstanding", type: "number", unit: "shares mm", required: true, default: 9 },
    { key: "pool", label: "Unissued options", type: "number", unit: "shares mm", default: 0.5 },
    { key: "pre", label: "Round pre-money", type: "number", unit: "$mm", required: true, default: 24 },
    { key: "newMoney", label: "New money", type: "number", unit: "$mm", required: true, default: 6 },
    { key: "poolTarget", label: "Post-money option pool", type: "number", unit: "%", default: 12 },
  ],
  example: { safes: "Angel A, 0.5, 8, post\nSeed SAFE, 0.75, 10, post\nFriends pre-money SAFE, 0.25, 6, pre\nDiscount note, 0.3, 15, post, 20", common: 9, pool: 0.5, pre: 24, newMoney: 6, poolTarget: 12 },
  compute: (i: Inputs): WorkflowOutput => {
    const safes = parseSafes(str(i, "safes"));
    if (!safes.length) throw new Error("Enter at least one SAFE: name, amount ($mm), cap ($mm), post|pre, discount %.");
    const common = num(i, "common"), pool = num(i, "pool"), pre = num(i, "pre"), newMoney = num(i, "newMoney"), poolTarget = num(i, "poolTarget") / 100;
    const r = priceRound({ common, pool, safes, pre, newMoney, poolTarget });
    const rows = r.safeRows.map((s) => {
      const src = safes.find((x) => x.name === s.name);
      const pct = s.shares / r.fdPost;
      return { ...s, cap: src?.cap ?? 0, discount: src?.discount ?? 0, pct, effectivePre: s.price * r.fdPre, markup: r.pps / s.price, valueAtPost: pct * r.post };
    });
    const totalIn = rows.reduce((a, s) => a + s.amount, 0), totalPct = rows.reduce((a, s) => a + s.pct, 0);
    const naive = rows.reduce((a, s) => a + s.amount / s.cap, 0);
    return {
      title: "SAFE conversion into the priced round",
      summary: `${rows.length} SAFEs totalling ${fmt.money(totalIn)} convert into ${fmt.num(rows.reduce((a, s) => a + s.shares, 0), 2)}mm shares, or ${fmt.pct(totalPct)} of the ${fmt.num(r.fdPost, 2)}mm-share post-money cap table, at a round price of ${fmt.moneyRaw(r.pps, 4)}. The naive sum of amount / cap is ${fmt.pct(naive)}; the difference is the dilution the new money and the pool top-up impose on the SAFE holders.`,
      blocks: [
        { type: "kpis", items: [
          { label: "SAFE money in", value: fmt.money(totalIn) }, { label: "SAFE ownership post-round", value: fmt.pct(totalPct) },
          { label: "Round price per share", value: fmt.moneyRaw(r.pps, 4) }, { label: "Pool top-up", value: `${fmt.num(r.poolTopUp, 2)}mm` },
          { label: "Post-money", value: fmt.money(r.post) }, { label: "Best markup", value: fmt.x(Math.max(...rows.map((s) => s.markup)), 2) },
        ] },
        { type: "table", title: "Conversion by SAFE", columns: ["SAFE", "Type", "Amount ($mm)", "Cap ($mm)", "Discount", "Conversion price", "Shares (mm)", "% post-round", "Effective pre-money paid ($mm)", "Markup vs round"],
          rows: rows.map((s) => [s.name, s.kind === "post" ? "Post-money" : "Pre-money", fmt.num(s.amount, 2), fmt.num(s.cap, 1), s.discount > 0 ? fmt.pct(s.discount, 0) : "-", fmt.moneyRaw(s.price, 4), fmt.num(s.shares, 3), fmt.pct(s.pct), fmt.num(s.effectivePre, 1), fmt.x(s.markup, 2)]),
          totals: ["Total", "", fmt.num(totalIn, 2), "", "", "", fmt.num(rows.reduce((a, s) => a + s.shares, 0), 3), fmt.pct(totalPct), "", ""] },
        { type: "bar", title: "Ownership by SAFE holder", format: "pct", data: rows.map((s) => ({ label: s.name, value: s.pct })) },
        { type: "callout", tone: rows.some((s) => s.kind === "pre") ? "warn" : "info", title: rows.some((s) => s.kind === "pre") ? "Pre-money SAFEs in the stack" : "All post-money",
          text: rows.some((s) => s.kind === "pre")
            ? "Pre-money SAFEs are priced off a capitalisation that excludes other SAFEs, so each additional SAFE dilutes the earlier pre-money holders and nobody's final ownership is known until the round prices. Post-money SAFEs (about 87% of SAFEs on Carta) fix ownership at amount / cap and push the dilution onto the founders instead."
            : "Every SAFE here is post-money, so each holder's share is fixed at amount / cap of the pre-round capitalisation and the dilution from later SAFEs falls on the founders, not on earlier SAFE holders." },
      ],
      caveats: [
        "Conversion price is the lower of the cap price and, where a discount applies, the round price less the discount. Post-money capitalisation includes common, the existing pool and all SAFEs and excludes the new pool increase and the new money.",
        "MFN SAFEs inherit the terms of any later SAFE: re-enter them with the inherited cap and discount.",
        "Interest-bearing convertible notes need accrued interest added to the principal before conversion.",
      ],
    };
  },
};

/** Ownership of every holder group across a sequence of priced rounds. */
const dilutionPath: ToolDef = {
  kind: "calc", id: "dilution-path", title: "Dilution path across rounds", tagline: "Where founders, employees, the pool and each investor land after every round.",
  description: "Projects ownership for every holder group through a sequence of priced rounds, applying each round's new money and the pool top-up created inside the pre-money, and compares the founder path with the Carta stage medians. Reports the ownership retention ratio each round and the cumulative dilution.",
  roles: ["vc", "student"], category: "Modeling", icon: "TrendingDown", savesMinutes: 60, tags: ["dilution", "ownership", "rounds", "founders"],
  fields: [
    { key: "founders", label: "Founder ownership today", type: "number", unit: "%", required: true, default: 78 },
    { key: "otherCommon", label: "Other common today (employees, angels, advisors)", type: "number", unit: "%", default: 12 },
    { key: "pool", label: "Unissued option pool today", type: "number", unit: "%", default: 10 },
    { key: "rounds", label: "Rounds", type: "textarea", required: true, placeholder: "Series A, 48, 12, 12\nSeries B, 150, 35, 14", help: "One per line: name, pre-money ($mm), new money ($mm), post-money pool target %" },
  ],
  example: { founders: 78, otherCommon: 12, pool: 10, rounds: "Seed, 16, 4, 12\nSeries A, 49, 13, 13\nSeries B, 119, 35, 14\nSeries C, 350, 60, 15" },
  compute: (i: Inputs): WorkflowOutput => {
    const f0 = num(i, "founders") / 100, o0 = num(i, "otherCommon") / 100, p0 = num(i, "pool") / 100;
    const start = f0 + o0 + p0;
    if (f0 <= 0) throw new Error("Founder ownership must be positive.");
    if (Math.abs(start - 1) > 0.02) throw new Error(`Founders, other common and the pool must sum to 100% (they sum to ${fmt.pct(start)}).`);
    const rounds = str(i, "rounds").split(/\n+/).map((l) => l.trim()).filter((l) => l !== "" && !/^name\b/i.test(l)).map((l, k) => {
      const p = l.split(/[,;\t|]/).map((s) => s.trim());
      const pre = cleanNum(p[1]), money = cleanNum(p[2]);
      if (!(pre > 0) || !(money > 0)) throw new Error(`Round "${p[0] || k + 1}": pre-money and new money must be positive ($mm). Line: "${l}"`);
      return { name: p[0] || `Round ${k + 1}`, pre, money, poolTarget: Math.max(0, Math.min(0.5, cleanNum(p[3], 10) / 100)) };
    });
    if (!rounds.length) throw new Error("Enter at least one round: name, pre-money ($mm), new money ($mm), pool target %.");
    type Holder = { label: string; pct: number[] };
    const holders: Holder[] = [{ label: "Founders", pct: [f0] }, { label: "Other common", pct: [o0] }, { label: "Option pool", pct: [p0] }];
    let poolPct = p0;
    const table: { name: string; post: number; f: number; investor: number; poolAdd: number; retention: number }[] = [];
    rounds.forEach((r, k) => {
      const post = r.pre + r.money, fShare = r.money / post;
      const poolPost = Math.max(r.poolTarget, poolPct * (1 - fShare));
      const factor = (1 - fShare - poolPost) / (1 - poolPct);
      if (factor <= 0) throw new Error(`Round "${r.name}": the new money plus the pool target leaves nothing for existing holders. Check the inputs.`);
      for (const h of holders) {
        const prev = h.pct[h.pct.length - 1];
        h.pct.push(h.label === "Option pool" ? poolPost : prev * factor);
      }
      holders.push({ label: `${r.name} investors`, pct: [...Array(k + 1).fill(0), fShare] });
      table.push({ name: r.name, post, f: fShare, investor: fShare, poolAdd: Math.max(0, poolPost - poolPct * (1 - fShare)), retention: factor });
      poolPct = poolPost;
    });
    const cols = ["Today", ...rounds.map((r) => r.name)];
    const fEnd = holders[0].pct[holders[0].pct.length - 1];
    const carta = [{ x: "Today", y: null as number | null }, ...rounds.map((r, k) => ({ x: r.name, y: k === 0 ? 0.56 : k === 1 ? 0.36 : k === 2 ? 0.23 : null }))];
    return {
      title: "Dilution path",
      summary: `Founders go from ${fmt.pct(f0)} today to ${fmt.pct(fEnd)} after ${rounds.length} round${rounds.length === 1 ? "" : "s"}, a cumulative dilution of ${fmt.pct(1 - fEnd / f0)} and an ownership retention ratio of ${fmt.x(fEnd / f0, 2)}. The largest single dilution is ${rounds[table.reduce((best, t, k) => (t.investor + t.poolAdd > table[best].investor + table[best].poolAdd ? k : best), 0)].name} at ${fmt.pct(Math.max(...table.map((t) => t.investor + t.poolAdd)))} of the post-money between new money and the pool top-up.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Founders today", value: fmt.pct(f0) }, { label: "Founders at the end", value: fmt.pct(fEnd), tone: fEnd >= 0.25 ? "pos" : "warn" },
          { label: "Cumulative dilution", value: fmt.pct(1 - fEnd / f0) }, { label: "Retention ratio", value: fmt.x(fEnd / f0, 2), hint: "ending founder % / starting founder %" },
          { label: "Final post-money", value: fmt.money(table[table.length - 1].post) }, { label: "Rounds", value: String(rounds.length) },
        ] },
        { type: "table", title: "Ownership by holder (%)", columns: ["Holder", ...cols],
          rows: holders.map((h) => [h.label, ...cols.map((_, k) => (h.pct[k] === undefined ? "-" : fmt.pct(h.pct[k])))]), emphasisRow: 0,
          note: "Each round's pool top-up is created inside the pre-money, so it dilutes every existing holder but not the incoming investor." },
        { type: "table", title: "Round mechanics", columns: ["Round", "Pre-money ($mm)", "New money ($mm)", "Post-money ($mm)", "Investor %", "Pool top-up %", "Existing holders retain"],
          rows: rounds.map((r, k) => [r.name, fmt.num(r.pre, 0), fmt.num(r.money, 1), fmt.num(table[k].post, 0), fmt.pct(table[k].investor), fmt.pct(table[k].poolAdd), fmt.pct(table[k].retention)]) },
        { type: "line", title: "Founder ownership vs Carta stage medians", format: "pct", series: [
          { name: "Founders", points: cols.map((c, k) => ({ x: c, y: holders[0].pct[k] })) },
          { name: "Carta median", points: carta },
        ] },
        { type: "bar", title: "Ownership at the end", format: "pct", data: holders.map((h) => ({ label: h.label, value: h.pct[h.pct.length - 1] ?? 0, emphasis: h.label === "Founders" })) },
      ],
      caveats: [
        "Pool targets are expressed as a percentage of the post-money fully diluted count and are created inside the pre-money (the option pool shuffle). Where the existing pool already exceeds the target, no top-up is created.",
        "Carta medians: founders hold roughly 56% after seed, 36% after Series A and 23% after Series B; Series C founders typically hold 15-22%.",
        "SAFEs and convertible notes are not modelled here: convert them first with the cap table calculator and enter the resulting ownership as today's split.",
      ],
      nextSteps: ["Price the next round in detail with the cap table calculator", "Cost the pro rata needed to hold your ownership through these rounds"],
    };
  },
};

/** Exit waterfall with stacked preferences, participation caps and conversion decisions. */
const exitWaterfall: ToolDef = {
  kind: "calc", id: "exit-waterfall", title: "Exit waterfall & liquidation preferences", tagline: "Who gets what at each exit value, and which classes convert.",
  description: "Runs the liquidation waterfall across a grid of exit values: pays preferences by seniority (pro rata within a rank), decides for every non-participating class whether converting to common beats taking the preference, applies participation caps, and deducts transaction costs and a management carve-out. Reports proceeds and MOIC per class and the breakpoints where the answer changes.",
  roles: ["vc", "pe"], category: "Modeling", icon: "Waterfall", savesMinutes: 150, tags: ["waterfall", "liquidation preference", "exit", "participating"],
  fields: [
    { key: "classes", label: "Preferred classes", type: "textarea", required: true, placeholder: "Series A, 12, 12, 1, n, 0, 2\nSeries B, 35, 17.5, 1, y, 3, 1", help: "One per line: name, invested ($mm), shares (mm), preference multiple, participating y/n, participation cap (x of invested, 0 = uncapped), seniority (1 = most senior)" },
    { key: "common", label: "Common and options", type: "number", unit: "shares mm", required: true, default: 40 },
    { key: "exits", label: "Exit values", type: "text", required: true, default: "50 150 300 500 1000", help: "Space or comma separated, $mm" },
    { key: "focus", label: "Exit to break down in detail", type: "number", unit: "$mm", default: 150 },
    { key: "costs", label: "Transaction costs", type: "number", unit: "% of exit value", default: 2 },
    { key: "carve", label: "Management carve-out", type: "number", unit: "% of net proceeds", default: 5 },
  ],
  example: { classes: "Series A, 12, 12, 1, n, 0, 2\nSeries B, 35, 17.5, 1, y, 3, 1", common: 40, exits: "50 150 300 500 1000", focus: 150, costs: 2, carve: 5 },
  compute: (i: Inputs): WorkflowOutput => {
    const cls = parseClasses(str(i, "classes"));
    const commonSh = num(i, "common");
    if (!(commonSh > 0)) throw new Error("Common and option shares must be positive (millions).");
    const costs = num(i, "costs") / 100, carve = num(i, "carve") / 100;
    if (costs < 0 || costs >= 1 || carve < 0 || carve >= 1) throw new Error("Transaction costs and the carve-out must each be between 0% and 100%.");
    const exits = list(i, "exits").map(Number).filter((x) => Number.isFinite(x) && x > 0).sort((a, b) => a - b);
    if (!exits.length) throw new Error("Enter at least one exit value ($mm).");
    const focus = num(i, "focus", exits[Math.floor(exits.length / 2)]);
    const distOf = (e: number) => e * (1 - costs) * (1 - carve);
    const runs = exits.map((e) => ({ e, r: runWaterfall(cls, commonSh, distOf(e)) }));
    const f = runWaterfall(cls, commonSh, distOf(focus));
    const totalPref = cls.reduce((a, c) => a + c.mult * c.invested, 0);
    const totalInvested = cls.reduce((a, c) => a + c.invested, 0);
    const breakpoint = totalPref / ((1 - costs) * (1 - carve));
    const fdShares = commonSh + cls.reduce((a, c) => a + c.shares, 0);
    const steps: { label: string; value: number; total?: boolean }[] = [
      { label: "Exit value", value: focus, total: true },
      { label: "Transaction costs", value: -focus * costs },
      { label: "Management carve-out", value: -focus * (1 - costs) * carve },
      { label: "Distributable", value: distOf(focus), total: true },
      ...cls.map((c) => ({ label: `${c.name}${f.conv.has(c.name) ? " (converted)" : f.pref[c.name] > 0 ? " (preference + participation)" : ""}`, value: -(f.total[c.name] ?? 0) })),
      { label: "Common and options", value: -f.common },
    ];
    return {
      title: "Exit waterfall",
      summary: `At a ${fmt.money(focus)} exit, ${fmt.money(distOf(focus))} is distributable after ${fmt.pct(costs, 0)} of costs and a ${fmt.pct(carve, 0)} carve-out. Common and options receive ${fmt.money(f.common)} (${fmt.moneyRaw(f.common / commonSh, 2)} per share) and ${f.conv.size ? `${[...f.conv].join(", ")} convert${f.conv.size === 1 ? "s" : ""} to common` : "no class converts"}. Preferences total ${fmt.money(totalPref)}, so common only participates above roughly ${fmt.money(breakpoint)} of exit value if nobody converts.`,
      blocks: [
        { type: "kpis", items: [
          { label: `Common per share at ${fmt.money(focus)}`, value: fmt.moneyRaw(f.common / commonSh, 3) },
          { label: "Preference overhang", value: fmt.money(totalPref), hint: `${fmt.x(totalPref / totalInvested, 2)} of invested capital` },
          { label: "Common participates above", value: fmt.money(breakpoint) },
          { label: "Converting at this exit", value: f.conv.size ? [...f.conv].join(", ") : "none" },
          { label: "Fully diluted shares", value: `${fmt.num(fdShares, 2)}mm` },
          { label: "Common share of proceeds", value: fmt.pct(f.common / distOf(focus)) },
        ] },
        { type: "table", title: "Proceeds by class ($mm)", columns: ["Class", ...exits.map((e) => fmt.money(e)), "Invested ($mm)", "Preference ($mm)", "Terms"],
          rows: [
            ...cls.map((c) => [c.name, ...runs.map((r) => fmt.num(r.r.total[c.name] ?? 0, 1)), fmt.num(c.invested, 1), fmt.num(c.mult * c.invested, 1), `${fmt.x(c.mult)} ${c.part ? (c.cap > 0 ? `participating, capped ${fmt.x(c.cap)}` : "participating") : "non-participating"}, rank ${c.rank}`]),
            ["Common and options", ...runs.map((r) => fmt.num(r.r.common, 1)), "-", "-", `${fmt.num(commonSh, 2)}mm shares`],
          ],
          totals: ["Distributable", ...exits.map((e) => fmt.num(distOf(e), 1)), fmt.num(totalInvested, 1), fmt.num(totalPref, 1), ""],
          note: "Non-participating classes convert when converting pays more than the preference; participating classes stop sharing once their cap is reached." },
        { type: "table", title: "MOIC by class", columns: ["Class", ...exits.map((e) => fmt.money(e))],
          rows: cls.map((c) => [c.name, ...runs.map((r) => fmt.x((r.r.total[c.name] ?? 0) / c.invested, 2))]) },
        { type: "waterfall", title: `Distribution at a ${fmt.money(focus)} exit (USD mm)`, format: "money", steps },
        { type: "line", title: "Proceeds by class across exit values (USD mm)", format: "money", series: [
          ...cls.map((c) => ({ name: c.name, points: runs.map((r) => ({ x: fmt.money(r.e), y: r.r.total[c.name] ?? 0 })) })),
          { name: "Common and options", points: runs.map((r) => ({ x: fmt.money(r.e), y: r.r.common })) },
        ] },
        { type: "bullets", title: "Conversion decisions", items: runs.map((r) => `${fmt.money(r.e)} exit: ${r.r.conv.size ? `${[...r.r.conv].join(", ")} convert${r.r.conv.size === 1 ? "s" : ""} to common` : "every class takes its preference"}; common receives ${fmt.money(r.r.common)} (${fmt.moneyRaw(r.r.common / commonSh, 3)} per share).`) },
      ],
      caveats: [
        "Preferences are paid by seniority rank, pro rata within a rank when proceeds are insufficient. Conversion is solved greedily: the class that gains most by converting converts, and the process repeats until no class gains.",
        "Participation caps are applied to total proceeds (preference plus participation) as a multiple of invested capital; a capped class that would do better as common is converted instead.",
        "Options are treated as common without a strike price: for exact per-share proceeds, net the aggregate exercise price or use treasury-stock treatment. Accrued dividends, escrow, earn-outs, transaction bonuses and any senior debt are not modelled.",
      ],
      nextSteps: ["Re-run with a 1x non-participating structure to price the term you are negotiating", "Check the fund-level effect of these proceeds in the fund model"],
    };
  },
};

/** Venture method: work back from an expected exit and a target multiple to today's pre-money. */
const ventureMethod: ToolDef = {
  kind: "calc", id: "venture-method", title: "Venture method valuation", tagline: "From expected exit and target multiple back to the pre-money you can pay.",
  description: "Prices an early-stage round the way venture capitalists actually do it: discount the expected exit equity value by a target multiple or a target IRR, derive the ownership needed at exit, gross it up for expected future dilution with a retention ratio, and convert into the ownership needed today and the implied pre- and post-money valuation.",
  roles: ["vc", "student"], category: "Valuation", icon: "Compass", savesMinutes: 45, tags: ["venture method", "valuation", "ownership", "dilution"],
  fields: [
    { key: "investment", label: "Investment", type: "number", unit: "$mm", required: true, default: 10 },
    { key: "exitEquity", label: "Expected exit equity value", type: "number", unit: "$mm", required: true, default: 1000 },
    { key: "years", label: "Years to exit", type: "number", unit: "years", default: 7, min: 1, max: 15 },
    { key: "method", label: "Target", type: "select", options: ["Target multiple", "Target IRR"], default: "Target multiple" },
    { key: "targetMultiple", label: "Target gross multiple", type: "number", unit: "x", default: 10 },
    { key: "targetIrr", label: "Target IRR", type: "number", unit: "%", default: 40 },
    { key: "dilution", label: "Expected dilution before exit", type: "number", unit: "%", default: 40 },
  ],
  example: { investment: 10, exitEquity: 1000, years: 7, method: "Target multiple", targetMultiple: 10, targetIrr: 40, dilution: 40 },
  compute: (i: Inputs): WorkflowOutput => {
    const inv = num(i, "investment"), exitEq = num(i, "exitEquity"), years = num(i, "years", 7);
    const useIrr = str(i, "method", "Target multiple") === "Target IRR";
    const targetIrr = num(i, "targetIrr") / 100, dil = num(i, "dilution") / 100;
    if (!(inv > 0) || !(exitEq > 0)) throw new Error("Investment and expected exit equity value must be positive ($mm).");
    if (years <= 0) throw new Error("Years to exit must be positive.");
    if (dil < 0 || dil >= 1) throw new Error("Expected dilution must be between 0% and 100%.");
    const mult = useIrr ? Math.pow(1 + targetIrr, years) : num(i, "targetMultiple");
    if (!(mult > 0)) throw new Error("Target multiple must be positive.");
    const discounted = exitEq / mult;
    const ownAtExit = inv / discounted;
    const ownToday = ownAtExit / (1 - dil);
    if (ownToday >= 1) throw new Error(`These assumptions require ${fmt.pct(ownToday)} of the company today. Lower the investment, raise the expected exit, or lower the target multiple.`);
    const postToday = inv / ownToday, preToday = postToday - inv;
    const impliedIrr = Math.pow(mult, 1 / years) - 1;
    const proceeds = ownAtExit * exitEq;
    const exitsGrid = [exitEq * 0.4, exitEq * 0.7, exitEq, exitEq * 1.5, exitEq * 2.5];
    const multGrid = useIrr ? [0.2, 0.3, 0.4, 0.5, 0.6].map((r) => Math.pow(1 + r, years)) : [mult * 0.5, mult * 0.75, mult, mult * 1.5, mult * 2];
    const grid = exitsGrid.map((e) => multGrid.map((m) => {
      const oe = inv / (e / m), ot = oe / (1 - dil);
      return ot >= 1 || ot <= 0 ? null : inv / ot - inv;
    }));
    return {
      title: "Venture method valuation",
      summary: `A ${fmt.money(inv)} cheque underwritten to ${fmt.x(mult)} gross (${fmt.pct(impliedIrr)} IRR over ${fmt.num(years, 0)} years) against a ${fmt.money(exitEq)} exit needs ${fmt.pct(ownAtExit)} of the company at exit. Grossing up for ${fmt.pct(dil, 0)} of future dilution, that is ${fmt.pct(ownToday)} today, which implies a ${fmt.money(postToday)} post-money and a ${fmt.money(preToday)} pre-money.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Pre-money you can pay", value: fmt.money(preToday) }, { label: "Post-money", value: fmt.money(postToday) },
          { label: "Ownership today", value: fmt.pct(ownToday) }, { label: "Ownership at exit", value: fmt.pct(ownAtExit) },
          { label: "Proceeds at exit", value: fmt.money(proceeds) }, { label: useIrr ? "Implied multiple" : "Implied IRR", value: useIrr ? fmt.x(mult) : fmt.pct(impliedIrr) },
        ] },
        { type: "table", title: "Build", columns: ["Step", "Value", "Formula"], rows: [
          ["Expected exit equity value", fmt.money(exitEq), "input"],
          [useIrr ? "Target IRR" : "Target gross multiple", useIrr ? fmt.pct(targetIrr) : fmt.x(mult), useIrr ? `multiple = (1 + IRR)^${fmt.num(years, 0)} = ${fmt.x(mult)}` : "input"],
          ["Discounted exit value", fmt.money(discounted), "exit equity / target multiple"],
          ["Ownership needed at exit", fmt.pct(ownAtExit), "investment / discounted exit value"],
          ["Expected dilution before exit", fmt.pct(dil, 0), "input"],
          ["Ownership needed today", fmt.pct(ownToday), "ownership at exit / (1 - dilution)"],
          ["Implied post-money", fmt.money(postToday), "investment / ownership today"],
          ["Implied pre-money", fmt.money(preToday), "post-money - investment"],
        ], emphasisRow: 7 },
        { type: "sensitivity", title: "Implied pre-money ($mm): exit value × target multiple", rowLabel: "Exit equity value ($mm)", colLabel: useIrr ? "Target IRR" : "Target multiple",
          rows: exitsGrid.map((e) => fmt.num(e, 0)), cols: multGrid.map((m) => (useIrr ? fmt.pct(Math.pow(m, 1 / years) - 1, 0) : fmt.x(m, 1))), values: grid, format: "num", baseRow: 2, baseCol: 2 },
        { type: "bar", title: "Ownership needed today by expected dilution", format: "pct", data: [0.2, 0.3, 0.4, 0.5, 0.6].map((d) => ({ label: `${fmt.pct(d, 0)} dilution`, value: ownAtExit / (1 - d), emphasis: Math.abs(d - dil) < 0.001 })) },
      ],
      caveats: [
        "The retention ratio approach assumes the investor does not defend its ownership with follow-ons; if you plan to take pro rata, model the reserves separately and lower the assumed dilution.",
        "Target multiples are gross, before fees and carry; a 3x net fund typically underwrites individual deals to 10x or more because most positions return less than 1x.",
        "The expected exit value is the argument. Anchor it to public comparables at the revenue the company would have, not to the largest outcome in the category.",
      ],
      nextSteps: ["Sanity-check the exit value with the public comps workflow", "Test the required winner size in the fund model"],
    };
  },
};

/** Pro rata cost through this round and the next ones. */
const proRata: ToolDef = {
  kind: "calc", id: "pro-rata-cost", title: "Pro rata cost calculator", tagline: "What it costs to keep your ownership, this round and the next three.",
  description: "Computes the cost of exercising pro rata in a round and of fully defending ownership against the pool top-up, then projects the cost through subsequent rounds at a given step-up so reserves can be sized. Reports the cost as a multiple of the original cheque and against the reserves available.",
  roles: ["vc"], category: "Portfolio", icon: "Wallet", savesMinutes: 45, tags: ["pro rata", "reserves", "follow-on", "ownership"],
  fields: [
    { key: "ownership", label: "Your ownership today", type: "number", unit: "%", required: true, default: 10 },
    { key: "firstCheck", label: "Your original cheque", type: "number", unit: "$mm", default: 2 },
    { key: "pre", label: "This round's pre-money", type: "number", unit: "$mm", required: true, default: 48 },
    { key: "raise", label: "This round's size", type: "number", unit: "$mm", required: true, default: 12 },
    { key: "poolTarget", label: "Post-money option pool", type: "number", unit: "%", default: 12 },
    { key: "existingPool", label: "Existing unissued pool", type: "number", unit: "%", default: 5 },
    { key: "reserves", label: "Reserves available for this company", type: "number", unit: "$mm", default: 6 },
    { key: "futureRounds", label: "Future rounds to project", type: "number", default: 2, min: 0, max: 6 },
    { key: "stepUp", label: "Valuation step-up per round", type: "number", unit: "x", default: 2.2 },
    { key: "roundPct", label: "Future round size", type: "number", unit: "% of post-money", default: 15 },
  ],
  example: { ownership: 10, firstCheck: 2, pre: 48, raise: 12, poolTarget: 12, existingPool: 5, reserves: 6, futureRounds: 2, stepUp: 2.2, roundPct: 15 },
  compute: (i: Inputs): WorkflowOutput => {
    const own0 = num(i, "ownership") / 100, firstCheck = num(i, "firstCheck"), reserves = num(i, "reserves");
    const pre = num(i, "pre"), raise = num(i, "raise");
    const poolTarget = num(i, "poolTarget") / 100, p0 = num(i, "existingPool") / 100;
    const nFuture = Math.round(num(i, "futureRounds", 3)), stepUp = num(i, "stepUp", 2.5), roundPct = num(i, "roundPct", 20) / 100;
    if (!(own0 > 0) || own0 >= 1) throw new Error("Ownership must be between 0% and 100%.");
    if (!(pre > 0) || !(raise > 0)) throw new Error("Pre-money and round size must be positive ($mm).");
    if (p0 >= 1 || poolTarget >= 1) throw new Error("Pool percentages must be below 100%.");
    if (roundPct <= 0 || roundPct >= 0.9) throw new Error("Future round size must be between 0% and 90% of post-money.");
    if (stepUp <= 0) throw new Error("Step-up must be positive.");
    type Row = { name: string; pre: number; post: number; f: number; poolPost: number; ownPass: number; proRataCost: number; ownProRata: number; holdCost: number };
    const rows: Row[] = [];
    let own = own0, pool = p0, prev = pre, first = true;
    for (let k = 0; k <= nFuture; k++) {
      const p = first ? pre : prev * stepUp;
      const post = first ? pre + raise : p / (1 - roundPct);
      const money = post - p;
      const fShare = money / post;
      const poolPost = Math.max(first ? poolTarget : pool, pool * (1 - fShare));
      const factor = (1 - fShare - poolPost) / (1 - pool);
      if (factor <= 0) throw new Error("The round size plus the pool target leaves nothing for existing holders.");
      const ownPass = own * factor;
      const proRataCost = own * money;
      const ownProRata = ownPass + proRataCost / post;
      const holdCost = Math.max(0, (own - ownPass) * post);
      rows.push({ name: first ? "This round" : `Round +${k}`, pre: p, post, f: fShare, poolPost, ownPass, proRataCost, ownProRata, holdCost });
      own = ownProRata; pool = poolPost; prev = post; first = false;
    }
    const cum = rows.reduce((a, r) => a + r.proRataCost, 0), cumHold = rows.reduce((a, r) => a + r.holdCost, 0);
    const r0 = rows[0];
    const stepGrid = [1.5, 2, 2.5, 3, 4], pctGrid = [0.1, 0.15, 0.2, 0.25, 0.3];
    const grid = stepGrid.map((s) => pctGrid.map((q) => {
      let o = own0, pl = p0, pv = pre, total = 0;
      for (let k = 0; k <= nFuture; k++) {
        const p = k === 0 ? pre : pv * s;
        const post = k === 0 ? pre + raise : p / (1 - q);
        const money = post - p, fShare = money / post;
        const poolPost = Math.max(k === 0 ? poolTarget : pl, pl * (1 - fShare));
        const factor = (1 - fShare - poolPost) / (1 - pl);
        if (factor <= 0) return null;
        total += o * money;
        o = o * factor + (o * money) / post; pl = poolPost; pv = post;
      }
      return total;
    }));
    return {
      title: "Pro rata cost",
      summary: `Full pro rata in this round costs ${fmt.money(r0.proRataCost)} and holds you at ${fmt.pct(r0.ownProRata)} versus ${fmt.pct(r0.ownPass)} if you pass. Defending ${fmt.pct(own0)} exactly, including the pool top-up, costs ${fmt.money(r0.holdCost)}. Across this round and ${nFuture} more at ${fmt.x(stepUp)} step-ups, pro rata totals ${fmt.money(cum)}, which is ${fmt.x(firstCheck > 0 ? cum / firstCheck : 0, 1)} the original cheque and ${reserves > 0 ? fmt.pct(cum / reserves) : "n/a"} of the reserves set aside.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Pro rata cost, this round", value: fmt.money(r0.proRataCost) },
          { label: "Ownership if you pass", value: fmt.pct(r0.ownPass), tone: "warn" },
          { label: "Ownership with pro rata", value: fmt.pct(r0.ownProRata) },
          { label: "Cost to hold your %", value: fmt.money(r0.holdCost) },
          { label: `Cumulative pro rata (${rows.length} rounds)`, value: fmt.money(cum), tone: reserves > 0 && cum > reserves ? "neg" : "pos" },
          { label: "Multiple of first cheque", value: fmt.x(firstCheck > 0 ? cum / firstCheck : 0, 1) },
        ] },
        { type: "table", title: "Round by round", columns: ["Round", "Pre-money ($mm)", "New money ($mm)", "Post-money ($mm)", "Investor % of round", "Pool post", "Ownership if you pass", "Pro rata cost ($mm)", "Ownership with pro rata", "Cost to hold ($mm)"],
          rows: rows.map((r) => [r.name, fmt.num(r.pre, 0), fmt.num(r.post - r.pre, 1), fmt.num(r.post, 0), fmt.pct(r.f), fmt.pct(r.poolPost, 0), fmt.pct(r.ownPass), fmt.num(r.proRataCost, 2), fmt.pct(r.ownProRata), fmt.num(r.holdCost, 2)]),
          totals: ["Total", "", "", "", "", "", "", fmt.num(cum, 2), "", fmt.num(cumHold, 2)], emphasisRow: 0 },
        { type: "bar", title: "Ownership under three policies (this round)", format: "pct", data: [
          { label: "Pass", value: r0.ownPass }, { label: "Pro rata", value: r0.ownProRata, emphasis: true }, { label: "Defend fully", value: own0 },
        ] },
        { type: "sensitivity", title: "Cumulative pro rata cost ($mm): step-up × future round size", rowLabel: "Step-up per round", colLabel: "Round size (% of post)", rows: stepGrid.map((s) => fmt.x(s, 1)), cols: pctGrid.map((q) => fmt.pct(q, 0)), values: grid, format: "num", baseRow: 2, baseCol: 2 },
        { type: "callout", tone: reserves > 0 && cum > reserves ? "warn" : "info", title: "Reserve check",
          text: reserves > 0
            ? `Reserves of ${fmt.money(reserves)} cover ${fmt.pct(Math.min(1, reserves / cum), 0)} of the projected pro rata. Typical funds reserve 30-50% of the fund and deploy it into only the top handful of positions; a fully defended position through three rounds commonly needs about 2.4x the first cheque.`
            : "Enter the reserves allocated to this position to see the coverage. Typical funds reserve 30-50% of the fund and concentrate it in the top positions, treating reserves as an option rather than an obligation." },
      ],
      caveats: [
        "Pro rata is modelled as the right to buy your ownership percentage of the new money, which holds your share of the new money but not your ownership against the pool top-up: the cost-to-hold column prices that gap.",
        "Future rounds assume a constant step-up and a round size expressed as a percentage of post-money, with the pool held at its prior level unless the round requires a top-up.",
        "Super pro rata rights are off-market in standard NVCA terms; a right to more than your pro rata should be negotiated explicitly.",
      ],
    };
  },
};

/** Fund model: pacing, fees, reserves, power-law outcomes, TVPI/DPI/IRR and the required winner. */
const fundModel: ToolDef = {
  kind: "calc", id: "vc-fund-model", title: "Fund model", tagline: "Fees, pacing, reserves and a power-law outcome set into TVPI, DPI and net IRR.",
  description: "Builds the fund-level model: management fees with a step-down, investable capital, initial cheques and reserves, pacing across the investment period, an outcome distribution with write-offs and a small number of winners, carry with an optional hurdle, and the resulting gross MOIC, net TVPI, DPI and net IRR with a J-curve. Reports the winner exit value the fund needs to hit its target.",
  roles: ["vc", "pe"], category: "Planning & forecasting", icon: "Landmark", savesMinutes: 300, tags: ["fund model", "portfolio construction", "reserves", "TVPI"],
  fields: [
    { key: "size", label: "Fund size", type: "number", unit: "$mm", required: true, default: 50 },
    { key: "fee", label: "Management fee, investment period", type: "number", unit: "%", default: 2 },
    { key: "feeStep", label: "Management fee after the investment period", type: "number", unit: "%", default: 1.5 },
    { key: "invPeriod", label: "Investment period", type: "number", unit: "years", default: 4, min: 1, max: 6 },
    { key: "term", label: "Fund term", type: "number", unit: "years", default: 10, min: 5, max: 15 },
    { key: "positions", label: "Initial positions", type: "number", default: 25, min: 5, max: 60 },
    { key: "entryOwn", label: "Entry ownership", type: "number", unit: "%", default: 8 },
    { key: "reserve", label: "Reserves", type: "number", unit: "% of investable capital", default: 40 },
    { key: "followOns", label: "Positions that receive follow-on", type: "number", default: 6, min: 0, max: 30 },
    { key: "dilution", label: "Dilution from entry to exit", type: "number", unit: "%", default: 50 },
    { key: "lossRate", label: "Write-offs", type: "number", unit: "% of positions", default: 55 },
    { key: "baseRate", label: "Base outcomes", type: "number", unit: "% of positions", default: 35 },
    { key: "baseMoic", label: "Base-outcome gross MOIC", type: "number", unit: "x", default: 1 },
    { key: "winnerMoic", label: "Winner gross MOIC", type: "number", unit: "x", default: 12 },
    { key: "hold", label: "Years from investment to exit", type: "number", unit: "years", default: 7, min: 2, max: 12 },
    { key: "carry", label: "Carried interest", type: "number", unit: "%", default: 20 },
    { key: "hurdle", label: "Preferred return", type: "number", unit: "%", default: 0 },
    { key: "target", label: "Target gross fund multiple", type: "number", unit: "x", default: 3 },
    { key: "recycle", label: "Recycle fees from early proceeds", type: "toggle", default: false },
  ],
  example: { size: 50, fee: 2, feeStep: 1.5, invPeriod: 4, term: 10, positions: 25, entryOwn: 8, reserve: 40, followOns: 6, dilution: 50, lossRate: 55, baseRate: 35, baseMoic: 1, winnerMoic: 12, hold: 7, carry: 20, hurdle: 0, target: 3, recycle: false },
  compute: (i: Inputs): WorkflowOutput => {
    const size = num(i, "size"), fee = num(i, "fee") / 100, feeStep = num(i, "feeStep") / 100;
    const invP = Math.round(num(i, "invPeriod", 4)), term = Math.round(num(i, "term", 10));
    const N = Math.round(num(i, "positions", 25)), entryOwn = num(i, "entryOwn") / 100, reserve = num(i, "reserve") / 100;
    const folCount = Math.round(num(i, "followOns", 6)), dil = num(i, "dilution") / 100;
    const loss = num(i, "lossRate") / 100, base = num(i, "baseRate") / 100, baseM = num(i, "baseMoic"), winM = num(i, "winnerMoic");
    const hold = Math.round(num(i, "hold", 7)), carryPct = num(i, "carry") / 100, hurdle = num(i, "hurdle") / 100;
    const target = num(i, "target", 3), recycle = bool(i, "recycle");
    if (!(size > 0)) throw new Error("Fund size must be positive ($mm).");
    if (term <= invP) throw new Error("Fund term must be longer than the investment period.");
    if (N < 1) throw new Error("The fund needs at least one position.");
    if (loss + base >= 1) throw new Error(`Write-offs plus base outcomes must leave room for winners (they total ${fmt.pct(loss + base, 0)}).`);
    if (reserve < 0 || reserve >= 1) throw new Error("Reserves must be between 0% and 100% of investable capital.");
    if (entryOwn <= 0 || entryOwn >= 1) throw new Error("Entry ownership must be between 0% and 100%.");
    const fees = size * fee * invP + size * feeStep * (term - invP);
    const investable = recycle ? size : size - fees;
    if (investable <= 0) throw new Error("Fees consume the whole fund: lower the fee or the term.");
    const initialPool = investable * (1 - reserve), reservePool = investable * reserve;
    const initialCheck = initialPool / N, followOnPer = folCount > 0 ? reservePool / folCount : 0;
    const nWin = N * (1 - loss - base), nBase = N * base, nLoss = N * loss;
    const winFollow = Math.min(folCount, nWin), baseFollow = Math.max(0, Math.min(folCount - nWin, nBase));
    const run = (w: number, l: number) => {
      const nw = N * (1 - l - base), nb = N * base;
      const wf = Math.min(folCount, nw), bf = Math.max(0, Math.min(folCount - nw, nb));
      const invW = nw * initialCheck + wf * followOnPer, invB = nb * initialCheck + bf * followOnPer;
      const gross = invW * w + invB * baseM;
      const pref = hurdle > 0 ? size * (Math.pow(1 + hurdle, hold) - 1) : 0;
      const cy = carryPct * Math.max(0, gross - size - pref);
      return { gross, carry: cy, net: gross - cy, tvpi: (gross - cy) / size, grossMoic: gross / investable };
    };
    const r = run(winM, loss);
    const investedWin = nWin * initialCheck + winFollow * followOnPer, investedBase = nBase * initialCheck + baseFollow * followOnPer;
    const cf: number[] = Array(term + 1).fill(0);
    for (let y = 0; y < invP; y++) cf[y] -= size / invP;
    for (let y = 0; y < invP; y++) { const t = Math.min(term, y + hold); cf[t] += r.net / invP; }
    const netIrr = irr(cf);
    let cumul = 0;
    const jcurve = cf.map((c, k) => { cumul += c; return { x: `Y${k}`, y: cumul }; });
    const ownExit = entryOwn * (1 - dil);
    const requiredWinner = (0.64 * target * size) / ownExit;
    const kimOwn = size / 1000;
    const weeksPerDeal = N > 0 ? (52 * invP) / N : 0;
    const winGrid = [winM * 0.5, winM * 0.75, winM, winM * 1.5, winM * 2];
    const maxLoss = Math.max(0.1, Math.min(0.9, 0.95 - base));
    const lossLo = Math.max(0.05, Math.min(loss - 0.2, maxLoss - 0.2)), lossHi = Math.min(maxLoss, Math.max(loss + 0.2, lossLo + 0.2));
    const lossGrid = [0, 1, 2, 3, 4].map((k) => lossLo + ((lossHi - lossLo) * k) / 4);
    const grid = winGrid.map((w) => lossGrid.map((l) => run(w, l).tvpi));
    const lossBaseCol = lossGrid.reduce((b, l, k) => (Math.abs(l - loss) < Math.abs(lossGrid[b] - loss) ? k : b), 0);
    return {
      title: "Fund model",
      summary: `A ${fmt.money(size)} fund paying ${fmt.pct(fee, 1)} then ${fmt.pct(feeStep, 1)} loses ${fmt.money(fees)} to fees (${fmt.pct(fees / size, 0)} of committed capital), leaving ${fmt.money(investable)} to invest: ${fmt.money(initialCheck)} initial cheques into ${N} companies plus ${fmt.money(reservePool)} of reserves for ${folCount} follow-ons. With ${fmt.pct(loss, 0)} write-offs and ${fmt.pct(1 - loss - base, 0)} winners at ${fmt.x(winM)}, gross proceeds are ${fmt.money(r.gross)}: ${fmt.x(r.grossMoic, 2)} gross, ${fmt.x(r.tvpi, 2)} net TVPI and ${netIrr === null ? "an IRR that cannot be solved" : `${fmt.pct(netIrr)} net IRR`}. To hit ${fmt.x(target)} gross, the best position must exit at about ${fmt.money(requiredWinner)}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Gross MOIC", value: fmt.x(r.grossMoic, 2) }, { label: "Net TVPI", value: fmt.x(r.tvpi, 2), tone: r.tvpi >= 2.5 ? "pos" : r.tvpi >= 1.5 ? "neutral" : "warn" },
          { label: "Net IRR", value: netIrr === null ? "n/a" : fmt.pct(netIrr) }, { label: "Carry", value: fmt.money(r.carry) },
          { label: "Fees over the term", value: fmt.money(fees), hint: `${fmt.pct(fees / size, 0)} of committed capital` },
          { label: "Required winner exit", value: fmt.money(requiredWinner), hint: `at ${fmt.pct(ownExit)} ownership at exit for ${fmt.x(target)} gross` },
        ] },
        { type: "table", title: "Construction", columns: ["Item", "Value", "Note"], rows: [
          ["Committed capital", fmt.money(size), `GP commit of 1-2% is customary`],
          ["Management fees", fmt.money(fees), `${fmt.pct(fee, 1)} for ${invP} years, then ${fmt.pct(feeStep, 1)} to year ${term}`],
          ["Investable capital", fmt.money(investable), recycle ? "fees recycled from early proceeds" : "committed less fees"],
          ["Initial cheques", `${fmt.money(initialCheck)} x ${N}`, `${fmt.pct(1 - reserve, 0)} of investable capital`],
          ["Reserves", fmt.money(reservePool), `${fmt.pct(reserve, 0)} of investable capital across ${folCount} follow-ons (${fmt.money(followOnPer)} each)`],
          ["Pacing", `${fmt.num(N / invP, 1)} new positions a year`, `one every ${fmt.num(weeksPerDeal, 1)} weeks`],
          ["Entry ownership", fmt.pct(entryOwn), `implies a ${fmt.money(initialCheck / entryOwn)} post-money entry`],
          ["Ownership at exit", fmt.pct(ownExit), `after ${fmt.pct(dil, 0)} dilution`],
          ["Kim heuristic check", fmt.pct(kimOwn), `about 1% ownership per $10mm of fund size at seed: ${entryOwn >= kimOwn ? "entry ownership clears it" : "entry ownership is below it"}`],
        ] },
        { type: "table", title: "Outcome distribution", columns: ["Bucket", "Positions", "Invested ($mm)", "Gross MOIC", "Proceeds ($mm)", "Share of proceeds"], rows: [
          ["Write-offs", fmt.num(nLoss, 1), fmt.num(nLoss * initialCheck, 1), "0.0x", "0.0", "0.0%"],
          ["Base outcomes", fmt.num(nBase, 1), fmt.num(investedBase, 1), fmt.x(baseM, 1), fmt.num(investedBase * baseM, 1), fmt.pct(r.gross > 0 ? (investedBase * baseM) / r.gross : 0)],
          ["Winners", fmt.num(nWin, 1), fmt.num(investedWin, 1), fmt.x(winM, 1), fmt.num(investedWin * winM, 1), fmt.pct(r.gross > 0 ? (investedWin * winM) / r.gross : 0)],
        ], totals: ["Total", fmt.num(N, 0), fmt.num(investable, 1), fmt.x(r.grossMoic, 2), fmt.num(r.gross, 1), "100.0%"], emphasisRow: 2 },
        { type: "table", title: "Fund cash flows (USD mm)", columns: ["Year", "Capital called", "Distributions to LPs", "Net", "Cumulative net"],
          rows: cf.map((c, k) => { const called = k < invP ? -size / invP : 0; const dist = c - called; return [`Y${k}`, fmt.num(called, 1), fmt.num(dist, 1), fmt.num(c, 1), fmt.num(jcurve[k].y, 1)]; }) },
        { type: "line", title: "J-curve: cumulative net cash flow to LPs (USD mm)", format: "money", series: [{ name: "Cumulative net", points: jcurve }] },
        { type: "sensitivity", title: "Net TVPI: winner MOIC × write-off rate", rowLabel: "Winner gross MOIC", colLabel: "Write-offs", rows: winGrid.map((w) => fmt.x(w, 1)), cols: lossGrid.map((l) => fmt.pct(l, 0)), values: grid, format: "x", baseRow: 2, baseCol: lossBaseCol },
        { type: "callout", tone: r.tvpi >= 2.5 ? "pos" : "warn", title: "Power-law check",
          text: `In a Pareto outcome set the single best company produces roughly 64% of the fund's return. At ${fmt.pct(ownExit)} ownership at exit, a ${fmt.x(target)} gross ${fmt.money(size)} fund therefore needs its best company to exit at about ${fmt.money(requiredWinner)}. Portfolio counts of 20-30 initial positions are the balanced range: under 15-20 is concentrated and over 40 is index-like. Reserves of 30-50% are typical, deployed into only the top handful of positions.` },
      ],
      caveats: [
        "Distributions are assumed to arrive a fixed number of years after each vintage year's deployment, with capital called evenly over the investment period; real calls are lumpy (20-30% per call is typical) and subscription lines can inflate IRR by 200-500 bps without changing cash returns.",
        "Carry is modelled as a whole-fund (European) waterfall: carried interest applies to proceeds above committed capital and, where a preferred return is entered, above that return compounded over the hold. Deal-by-deal (American) waterfalls pay earlier and need a clawback.",
        "Reserves are allocated to winners first, which is the optimistic case; in practice reserve drift into defensive bridges of the middle of the portfolio is the main leakage. Fees are charged on committed capital throughout rather than stepping to net invested capital.",
        "Benchmarks: 2016-vintage median TVPI ~1.8x with DPI still below 1x, 2018 median ~1.6x with DPI 0.15x, 2021 median 1.02x with DPI near zero at year five; top quartile for mature vintages is roughly 25%+ net IRR and 3x+ TVPI.",
      ],
    };
  },
};

/** SaaS operating metrics with quartile benchmarks by stage. */
const saasMetrics: ToolDef = {
  kind: "calc", id: "saas-metrics-calculator", title: "SaaS metrics calculator", tagline: "Burn multiple, runway, CAC payback, magic number, LTV/CAC and Rule of 40 in one pass.",
  description: "Computes the efficiency metrics investors underwrite from a handful of inputs: growth, burn multiple, runway, CAC payback on gross-margin-adjusted revenue, the magic number, contribution-margin LTV over CAC, Rule of 40 and the growth-weighted Rule of X, then scores each against published quartile benchmarks and the Bessemer growth bands for the ARR level.",
  roles: ["vc", "pe"], category: "Screening", icon: "Gauge", savesMinutes: 60, tags: ["SaaS", "burn multiple", "CAC payback", "Rule of 40"],
  fields: [
    { key: "arr", label: "ARR", type: "number", unit: "$mm", required: true, default: 5 },
    { key: "priorArr", label: "ARR 12 months ago", type: "number", unit: "$mm", required: true, default: 2.5 },
    { key: "netNewQ", label: "Net new ARR, last quarter", type: "number", unit: "$mm", default: 0.625 },
    { key: "sandmPriorQ", label: "S&M spend, prior quarter", type: "number", unit: "$mm", default: 1.25 },
    { key: "netBurn", label: "Net burn, monthly", type: "number", unit: "$mm", default: 0.35 },
    { key: "cash", label: "Cash", type: "number", unit: "$mm", default: 8 },
    { key: "grossMargin", label: "Gross margin", type: "number", unit: "%", default: 74 },
    { key: "cac", label: "Fully loaded CAC per new customer", type: "number", unit: "$mm", default: 0.03 },
    { key: "acv", label: "Average contract value", type: "number", unit: "$mm", default: 0.045 },
    { key: "churn", label: "Annual logo churn", type: "number", unit: "%", default: 15 },
    { key: "fcfMargin", label: "FCF margin", type: "number", unit: "%", default: -70 },
    { key: "buyer", label: "Buyer", type: "select", options: ["SMB", "Mid-market", "Enterprise"], default: "Mid-market" },
  ],
  example: { arr: 5, priorArr: 2.5, netNewQ: 0.625, sandmPriorQ: 1.25, netBurn: 0.35, cash: 8, grossMargin: 74, cac: 0.03, acv: 0.045, churn: 15, fcfMargin: -70, buyer: "Mid-market" },
  compute: (i: Inputs): WorkflowOutput => {
    const arr = num(i, "arr"), prior = num(i, "priorArr"), netNewQ = num(i, "netNewQ"), sandm = num(i, "sandmPriorQ");
    const burn = num(i, "netBurn"), cash = num(i, "cash"), gm = num(i, "grossMargin") / 100;
    const cac = num(i, "cac"), acv = num(i, "acv"), churn = num(i, "churn") / 100, fcf = num(i, "fcfMargin") / 100;
    const buyer = str(i, "buyer", "Mid-market");
    if (!(arr > 0) || prior <= 0) throw new Error("ARR and prior-year ARR must both be positive ($mm).");
    if (gm <= 0 || gm > 1) throw new Error("Gross margin must be between 0% and 100%.");
    const growth = arr / prior - 1;
    const netNewYr = arr - prior;
    const burnMultiple = netNewYr > 0 ? (burn * 12) / netNewYr : null;
    const runway = burn > 0 ? cash / burn : null;
    const cacPayback = cac > 0 && acv > 0 ? (cac / (acv * gm)) * 12 : null;
    const magic = sandm > 0 ? (netNewQ * 4) / sandm : null;
    const ltv = churn > 0 ? (acv * gm) / churn : null;
    const ltvCac = ltv !== null && cac > 0 ? ltv / cac : null;
    const ruleOf40 = growth * 100 + fcf * 100;
    const ruleOfX = 2 * growth * 100 + fcf * 100;
    const band = growthBand(arr);
    const paybackBench = buyer === "SMB" ? 12 : buyer === "Enterprise" ? 24 : 18;
    const score = (v: number | null, top: number, med: number, lowerBetter = false): number => {
      if (v === null) return 0;
      if (lowerBetter) return v <= top ? 4 : v <= med ? 3 : v <= med * 1.5 ? 2 : 1;
      return v >= top ? 4 : v >= med ? 3 : v >= med * 0.6 ? 2 : 1;
    };
    const rows: [string, string, string, string, string][] = [
      ["YoY ARR growth", fmt.pct(growth), fmt.pct(band.good, 0), fmt.pct(band.best, 0), `Bessemer good/better/best for ${band.band}: ${fmt.pct(band.good, 0)} / ${fmt.pct(band.better, 0)} / ${fmt.pct(band.best, 0)}`],
      ["Burn multiple", burnMultiple === null ? "n/a" : fmt.x(burnMultiple, 2), "1.2-1.8x", "<0.8x", "net burn / net new ARR; top quartile below 0.8x, median 1.2-1.8x"],
      ["Runway", runway === null ? "n/a" : `${fmt.num(runway, 0)} months`, "18 months", "24+ months", "cash / monthly net burn; raise with 9-12 months left"],
      ["CAC payback", cacPayback === null ? "n/a" : `${fmt.num(cacPayback, 1)} months`, `<${paybackBench}`, "7-15", `gross-margin-adjusted; SMB <12, mid-market <18, enterprise <24 (${buyer})`],
      ["Magic number", magic === null ? "n/a" : fmt.num(magic, 2), "0.5-0.7", ">0.9", "net new ARR x 4 / prior-quarter S&M"],
      ["LTV / CAC", ltvCac === null ? "n/a" : fmt.x(ltvCac, 1), "3.2x", "5.0x", "contribution-margin LTV over fully loaded CAC"],
      ["Rule of 40", fmt.num(ruleOf40, 0), "28-31", "~48", "growth % + FCF margin %; public median 28-31, top decile ~48"],
      ["Rule of X", fmt.num(ruleOfX, 0), "n/a", "n/a", "growth weighted 2x + FCF margin, for private companies"],
      ["Gross margin", fmt.pct(gm), "76%", "84%", "cloud average 65-70%, median 76%, top quartile 84%"],
    ];
    return {
      title: "SaaS metrics",
      summary: `${fmt.money(arr)} ARR growing ${fmt.pct(growth)} (${band.band}: Bessemer good is ${fmt.pct(band.good, 0)}), a burn multiple of ${burnMultiple === null ? "n/a" : fmt.x(burnMultiple, 2)} and ${runway === null ? "no burn" : `${fmt.num(runway, 0)} months of runway`}. CAC payback is ${cacPayback === null ? "n/a" : `${fmt.num(cacPayback, 1)} months`} against a ${paybackBench}-month ${buyer.toLowerCase()} benchmark, the magic number is ${magic === null ? "n/a" : fmt.num(magic, 2)}, LTV/CAC ${ltvCac === null ? "n/a" : fmt.x(ltvCac, 1)}, and Rule of 40 is ${fmt.num(ruleOf40, 0)}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "YoY growth", value: fmt.pct(growth), tone: growth >= band.better ? "pos" : growth >= band.good ? "neutral" : "warn" },
          { label: "Burn multiple", value: burnMultiple === null ? "n/a" : fmt.x(burnMultiple, 2), tone: burnMultiple !== null && burnMultiple <= 0.8 ? "pos" : burnMultiple !== null && burnMultiple <= 1.8 ? "neutral" : "warn" },
          { label: "Runway", value: runway === null ? "n/a" : `${fmt.num(runway, 0)} mo`, tone: runway !== null && runway >= 18 ? "pos" : runway !== null && runway >= 12 ? "neutral" : "warn" },
          { label: "CAC payback", value: cacPayback === null ? "n/a" : `${fmt.num(cacPayback, 1)} mo`, tone: cacPayback !== null && cacPayback <= paybackBench ? "pos" : "warn" },
          { label: "LTV / CAC", value: ltvCac === null ? "n/a" : fmt.x(ltvCac, 1), tone: ltvCac !== null && ltvCac >= 3.2 ? "pos" : "warn" },
          { label: "Rule of 40", value: fmt.num(ruleOf40, 0), tone: ruleOf40 >= 40 ? "pos" : ruleOf40 >= 20 ? "neutral" : "warn" },
        ] },
        { type: "table", title: "Metrics vs benchmarks", columns: ["Metric", "This company", "Median", "Top quartile", "Definition and source"], rows: rows.map((r) => [...r]) },
        { type: "bar", title: `Growth vs Bessemer bands for ${band.band}`, format: "pct", data: [
          { label: "This company", value: growth, emphasis: true }, { label: "Good", value: band.good }, { label: "Better", value: band.better }, { label: "Best", value: band.best },
        ], reference: { value: band.good, label: "Good" } },
        { type: "score", title: "Quartile scores (4 = top quartile)", items: [
          { label: "Growth", score: score(growth, band.better, band.good), max: 4, note: band.band },
          { label: "Capital efficiency", score: score(burnMultiple, 0.8, 1.8, true), max: 4, note: "burn multiple" },
          { label: "Sales efficiency", score: score(magic, 0.9, 0.6), max: 4, note: "magic number" },
          { label: "Payback", score: score(cacPayback, 15, paybackBench, true), max: 4, note: `${buyer} benchmark` },
          { label: "Unit economics", score: score(ltvCac, 5, 3.2), max: 4, note: "LTV / CAC" },
          { label: "Margin structure", score: score(gm, 0.84, 0.76), max: 4, note: "gross margin" },
        ] },
      ],
      caveats: [
        "Burn multiple uses annualised net burn over the last twelve months of net new ARR; a company with negative net new ARR has no meaningful burn multiple.",
        "CAC payback is gross-margin adjusted (CAC / (ACV x gross margin) x 12). LTV uses contribution-margin revenue divided by annual logo churn, which overstates LTV where churn is back-loaded or expansion is concentrated.",
        "Definitions differ by company: ARR should exclude one-time and services revenue and must never be a spiky month multiplied by twelve. Reconcile to invoices and bank data before underwriting.",
      ],
      nextSteps: ["Run the cohort analysis on the subscription export to verify retention", "Benchmark the whole profile against the stage bar with the SaaS metrics benchmark workflow"],
    };
  },
};

/** Syndicate / SPV economics: carry, fees and the split between the lead and the backers. */
const syndicateCarry: ToolDef = {
  kind: "calc", id: "angel-syndicate-carry", title: "Angel syndicate carry math", tagline: "What the lead earns, what the backers net, across the outcome range.",
  description: "Models the economics of a syndicate or SPV: setup and admin fees taken out of the raise, deployed capital, carry charged on the backers' profit (with an optional hurdle), and the resulting net multiple and IRR for backers against the lead's return on their own capital plus carry, across a grid of gross outcomes.",
  roles: ["vc"], specialties: ["Angel / syndicate", "Secondaries", "Pre-seed / seed"], category: "Portfolio", icon: "Coins", savesMinutes: 45, tags: ["syndicate", "SPV", "carry", "angel"],
  fields: [
    { key: "spvSize", label: "Total SPV size", type: "number", unit: "$mm", required: true, default: 1.5 },
    { key: "leadCommit", label: "Lead's own commitment", type: "number", unit: "$mm", default: 0.1 },
    { key: "carry", label: "Carry", type: "number", unit: "%", default: 20 },
    { key: "setupFee", label: "Setup / management fee", type: "number", unit: "% of the raise", default: 2 },
    { key: "adminFee", label: "Platform and admin costs", type: "number", unit: "$mm", default: 0.02 },
    { key: "moic", label: "Gross MOIC on deployed capital", type: "number", unit: "x", default: 5 },
    { key: "years", label: "Years to exit", type: "number", unit: "years", default: 6, min: 1, max: 15 },
    { key: "hurdle", label: "Preferred return", type: "number", unit: "%", default: 0 },
  ],
  example: { spvSize: 1.5, leadCommit: 0.1, carry: 20, setupFee: 2, adminFee: 0.02, moic: 5, years: 6, hurdle: 0 },
  compute: (i: Inputs): WorkflowOutput => {
    const spv = num(i, "spvSize"), lead = num(i, "leadCommit"), carryPct = num(i, "carry") / 100;
    const setup = num(i, "setupFee") / 100, admin = num(i, "adminFee"), moic = num(i, "moic"), years = num(i, "years", 6), hurdle = num(i, "hurdle") / 100;
    if (!(spv > 0)) throw new Error("SPV size must be positive ($mm).");
    if (lead < 0 || lead >= spv) throw new Error("The lead's commitment must be between zero and the SPV size.");
    if (carryPct < 0 || carryPct >= 1) throw new Error("Carry must be between 0% and 100%.");
    if (years <= 0) throw new Error("Years to exit must be positive.");
    const fees = spv * setup + admin;
    const deployed = spv - fees;
    if (deployed <= 0) throw new Error("Fees exceed the raise: lower the setup fee or the admin costs.");
    const backers = spv - lead;
    const scenario = (m: number) => {
      const proceeds = deployed * m;
      const perDollar = proceeds / spv;
      const backerProceeds = perDollar * backers;
      const pref = hurdle > 0 ? backers * (Math.pow(1 + hurdle, years) - 1) : 0;
      const carry = carryPct * Math.max(0, backerProceeds - backers - pref);
      const backerNet = backerProceeds - carry;
      const backerMoic = backers > 0 ? backerNet / backers : 0;
      const leadTotal = perDollar * lead + carry;
      return { m, proceeds, carry, backerNet, backerMoic, backerIrr: backerMoic > 0 ? Math.pow(backerMoic, 1 / years) - 1 : -1, leadTotal, leadMoic: lead > 0 ? leadTotal / lead : null };
    };
    const base = scenario(moic);
    const grid = [0, 1, 2, 3, 5, 10, 25].map(scenario);
    return {
      title: "Syndicate economics",
      summary: `A ${fmt.money(spv)} SPV loses ${fmt.money(fees)} to fees (${fmt.pct(fees / spv, 1)} of the raise), deploying ${fmt.money(deployed)}. At ${fmt.x(moic)} gross, backers put in ${fmt.money(backers)} and net ${fmt.money(base.backerNet)}, a ${fmt.x(base.backerMoic, 2)} net multiple and ${fmt.pct(base.backerIrr)} net IRR after ${fmt.money(base.carry)} of carry. The lead earns ${fmt.money(base.carry)} of carry plus ${fmt.money(base.leadTotal - base.carry)} on their own ${fmt.money(lead)}${base.leadMoic !== null ? `, a ${fmt.x(base.leadMoic, 1)} return on their own capital` : ""}.`,
      blocks: [
        { type: "kpis", items: [
          { label: "Deployed capital", value: fmt.money(deployed), hint: `${fmt.pct(fees / spv, 1)} of the raise goes to fees` },
          { label: "Carry to the lead", value: fmt.money(base.carry) },
          { label: "Backers' net multiple", value: fmt.x(base.backerMoic, 2), tone: base.backerMoic >= 3 ? "pos" : base.backerMoic >= 1 ? "neutral" : "neg" },
          { label: "Backers' net IRR", value: fmt.pct(base.backerIrr) },
          { label: "Lead's return on own capital", value: base.leadMoic === null ? "n/a" : fmt.x(base.leadMoic, 1) },
          { label: "Carry drag", value: fmt.pct(moic > 0 ? 1 - base.backerMoic / (base.proceeds / spv) : 0), hint: "net multiple vs gross-of-carry multiple per dollar contributed" },
        ] },
        { type: "table", title: "Outcome grid", columns: ["Gross MOIC", "Proceeds ($mm)", "Carry ($mm)", "Backers net ($mm)", "Backers net MOIC", "Backers net IRR", "Lead total ($mm)", "Lead MOIC on own capital"],
          rows: grid.map((g) => [fmt.x(g.m, 1), fmt.num(g.proceeds, 2), fmt.num(g.carry, 3), fmt.num(g.backerNet, 2), fmt.x(g.backerMoic, 2), g.backerMoic > 0 ? fmt.pct(g.backerIrr) : "-100%", fmt.num(g.leadTotal, 3), g.leadMoic === null ? "n/a" : fmt.x(g.leadMoic, 1)]),
          emphasisRow: grid.findIndex((g) => g.m === moic) >= 0 ? grid.findIndex((g) => g.m === moic) : 0 },
        { type: "bar", title: "Lead's total economics by outcome (USD mm)", format: "money", data: grid.map((g) => ({ label: fmt.x(g.m, 0), value: g.leadTotal, emphasis: g.m === moic })) },
        { type: "waterfall", title: `Where the money goes at ${fmt.x(moic)} gross (USD mm)`, format: "money", steps: [
          { label: "Raised", value: spv, total: true },
          { label: "Fees", value: -fees },
          { label: "Deployed", value: deployed, total: true },
          { label: "Gain on deployed", value: base.proceeds - deployed },
          { label: "Proceeds", value: base.proceeds, total: true },
          { label: "Carry to the lead", value: -base.carry },
          { label: "To backers and lead capital", value: -(base.proceeds - base.carry) },
        ] },
      ],
      caveats: [
        "Carry is charged only on the backers' profit, not on the lead's own capital, which is the market convention; leads commonly take 10-20% carry and sometimes a 1-2% fee, with platform administration handling formation, filings and K-1s.",
        "Fees are taken out of the raise before deployment, so backers' invested capital is less than their contribution: the net multiple is computed on the contribution, which is what a backer experiences.",
        "Net IRR is derived from the net multiple over the holding period as a single cash flow in and out; interim distributions, recycling and tax are not modelled.",
      ],
    };
  },
};

export const VC_PACK: ToolDef[] = [
  // Sourcing and screening
  thesisSourcingMap, formDMonitor, momentumScan, acceleratorFinder, deckScreen, startupDeepDive, marketMap, marketSizing,
  // Outreach and diligence
  founderOutreach, referencePlan, customerCalls, diligenceChecklist, cohortAnalysis, metricsBenchmark, investmentMemo, icPreRead, termSheetAnalyzer,
  // Pricing, portfolio and reporting
  roundComps, lateStageComps, secondaryPricing, cvcFit, boardPrep, lpLetter, markAssistant, operatorEquity,
  // Calculators
  capTable, safeConversion, dilutionPath, exitWaterfall, ventureMethod, proRata, fundModel, saasMetrics, syndicateCarry,
];
