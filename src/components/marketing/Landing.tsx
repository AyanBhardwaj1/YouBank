"use client";

import Link from "next/link";
import { useState } from "react";
import { ROLES, ROLE_IDS, type RoleId } from "@/lib/roles";
import { DEMO } from "@/lib/demo";
import { SignInButton } from "./SignInButton";
import { DemoTerminal } from "./DemoTerminal";
import { DemoComps } from "./DemoComps";
import { DemoAi } from "./DemoAi";
import { DemoDirectory } from "./DemoDirectory";
import { PLANS, usd, type PlanId } from "@/lib/billing/plans";
import { CREDIT_PACKS } from "@/lib/billing/packs";
import { Reveal, CountUp } from "@/components/motion/Reveal";
import { Icon } from "@/components/ui/Icon";
import { Logo, LogoMark } from "@/components/brand/Logo";
import { LegalLinks } from "./SiteChrome";

const ROLE_ICON: Record<RoleId, string> = { banker: "Landmark", pe: "Briefcase", vc: "Rocket", markets: "LineChart", corpfin: "Building2", consultant: "Compass", accountant: "Receipt", student: "GraduationCap" };

/** What a fund does all day, as one loop: hold a view, watch the world, decide, prove it. */
const LOOP = [
  { icon: "Crosshair", title: "Hold a view", body: "Write the thesis and the numbers that would prove it wrong. YouBank turns plain English into kill criteria it can check: revenue growth, margins, net debt, insider selling, a stop from entry." },
  { icon: "Satellite", title: "Watch the world", body: "Every criterion is checked against SEC XBRL filings and the price after each close, while Edge watches the assets themselves: satellite change, flaring, permits, hiring, earnings-call answers." },
  { icon: "Scale", title: "Decide", body: "Risk before the trade, an AI committee that argues both sides independently, and a list of exactly what needs you today: broken theses, passed catalysts, changes with no reason." },
  { icon: "ScrollText", title: "Prove it", body: "A decision journal the server writes, forecasts scored for calibration, process health graded apart from results, and a hash-chained ledger of every AI answer, ready for an LP or an examiner." },
];

/** The Book: the core of the fund desk. */
const BOOK = [
  { icon: "Crosshair", title: "Kill criteria, checked daily", body: "Each position carries the numbers that would prove its thesis wrong. After every US close they are re-read from XBRL company facts and the price, with the figure, the period, the source link and the headroom left." },
  { icon: "Activity", title: "Risk you can act on", body: "Beta-adjusted net, one-day VaR and expected shortfall, the names that are really one bet, and today's book replayed through COVID, 2022 and April 2025. Run a what-if before the trade." },
  { icon: "Bell", title: "Needs you, ranked", body: "Broken with nothing done since, catalysts that passed without a review, changes with no reason written down, theses nobody has looked at in 90 days. One list, on the Book, Home and your phone." },
  { icon: "Gauge", title: "Calibration, scored", body: "Put a probability on any thesis. YouBank resolves it from the daily checks and scores it with the Brier score, with a Platt correction once you have twenty: \u201cyour 80% has behaved like 64%\u201d. Forecasts cannot be backdated, farmed or quietly withdrawn." },
  { icon: "Users", title: "An AI investment committee", body: "A bull and a bear write sourced briefs apart, then three independent chairs are pooled in log-odds, starting from a volatility base rate. The chair's forecast is scored beside yours, so you learn whose calibration is better." },
  { icon: "NotebookPen", title: "Process health", body: "Goalposts moved while a thesis was failing, losers held longer than winners (the disposition effect), stale theses, catalyst hit rate, reasons recorded. Graded from your own records, never self-reported." },
];

/** Edge: the alternative-data and frontier-AI layer. */
const EDGE = [
  { icon: "Satellite", title: "Earth · satellites on the assets", body: "Sentinel-2 change detection for new pads, laterals and construction scars; Sentinel-1 radar that sees through cloud; NASA FIRMS heat for flaring; drilling permits near each plant; sites in 3D from aerial photos and USGS lidar." },
  { icon: "AudioLines", title: "Call Desk", body: "Every analyst question on an earnings call scored direct, partial or evasive with calibrated probabilities, and a ledger of each quantified promise management made, settled automatically when the filing lands." },
  { icon: "Radar", title: "Deal Radar", body: "A calibrated probability that a company agrees a sale or a material acquisition in the next 6 or 12 months, fused from weak public signals, with its own track record scored in public." },
  { icon: "Activity", title: "Alt-Data Pulse", body: "Free alternative data as time series per company: hiring by department and location, web and Wikipedia attention, measured against placebo rates so a blip is not a signal." },
  { icon: "Network", title: "Networks · GNN", body: "Suppliers, customers, owners and deal links as a graph, with predictions trained on it and a reason for each one. Draw any combination of companies and see the pro-forma footprint, overlaps and likely divestitures." },
  { icon: "FileSearch", title: "Documents with Calibrated Claims", body: "Cited answers across filings, call transcripts, your data room and the web. Every claim carries the probability its sources support it, and strict mode holds a stated, tested error rate." },
  { icon: "FlaskConical", title: "LBO Stress Lab and scenarios", body: "An LBO run over thousands of labelled synthetic macro and operating paths: the IRR fan, covenant-breach odds by year, the highest price that clears a hurdle, and the gentlest scenario that breaks the deal." },
  { icon: "Bot", title: "Thesis Agent", body: "State a thesis and an agent investigates it for days: it builds canvases, sets monitors, weighs the evidence for and against, and writes the memo, with every step kept." },
];

const TERMINAL = [
  { icon: "Gauge", title: "Risk with its error bars", body: "GARCH volatility forecasts and a price cone, betas four ways with their standard errors (including Welch's), and value at risk three ways with a backtest that says whether it held." },
  { icon: "Shield", title: "Credit without a ratings licence", body: "An implied rating from Altman's Z'', Ohlson's O-score and Merton's distance to default, with historical default rates, for every US filer." },
  { icon: "LineChart", title: "Forecasts with honest intervals", body: "Revenue and the economy forecast with the methods that won the M4 competition, with bands sized by how wrong the method has actually been, set beside the Street." },
  { icon: "BarChart3", title: "Valuation as a range", body: "WACC from its parts and a Monte Carlo DCF with correlated inputs: P10, P50, P90 and what drives the spread, in the terminal or inside a Studio model." },
  { icon: "Landmark", title: "Rates and the economy", body: "The Treasury curve with its Nelson-Siegel factors, the New York Fed's recession probability, BLS inflation and jobs with the Sahm rule." },
  { icon: "Newspaper", title: "Filings, read for you", body: "What changed between the last two 10-Ks or 10-Qs, 8-K events decoded, insider trades, and full-text search across every EDGAR filing and exhibit since 2001." },
];

const SEGMENTS = [
  { icon: "Briefcase", title: "Small and emerging hedge funds", body: "A research desk, a risk system and the compliance record an allocator asks for, without the six-figure stack. Show process before you have a three-year track record." },
  { icon: "Building2", title: "Family offices and RIAs", body: "An investment committee with a scored second opinion, a journal of every decision and why, and reports an LP or a client can read." },
  { icon: "LineChart", title: "Professional investors", body: "PMs, analysts and traders who want primary-source numbers, alternative data and calibrated odds in the AI apps they already use." },
  { icon: "TrendingUp", title: "Serious individual investors", body: "Run your own portfolio like a fund: write the thesis, let YouBank check it every day, and find out whether your conviction is calibrated." },
];

/**
 * The public price cards, from the same PLANS the app bills with (src/lib/billing/plans.ts), so the site
 * and the plan page cannot disagree.
 */
const perMonth = (id: PlanId) => PLANS[id].monthlyUsd ?? PLANS[id].yearlyMonthlyUsd ?? 0;
const unitOf = (id: PlanId) => {
  const p = PLANS[id], seat = p.minSeats > 1 ? "per seat per month" : "per month";
  const how = p.monthlyUsd ? (p.yearlyMonthlyUsd ? `, or ${usd(p.yearlyMonthlyUsd)} billed yearly` : "") : ", billed yearly";
  return `${seat}${how}${p.minSeats > 1 ? `; ${p.minSeats === 3 ? "three" : p.minSeats === 5 ? "five" : p.minSeats} seats minimum` : ""}`;
};
const PRICE_CARDS = (["campus", "pro", "team", "enterprise"] as PlanId[]).map((id) => ({
  name: PLANS[id].name,
  price: perMonth(id) ? usd(perMonth(id)) : "Free",
  unit: id === "campus" ? "with a .edu address" : unitOf(id),
  points: [...PLANS[id].points, `AI allowance: ${usd(PLANS[id].ai.monthlyUsd)} a month${PLANS[id].minSeats > 1 ? " per seat" : ""}`],
  highlight: id === "pro",
}));

const METHOD = [
  { k: "Fundamentals", v: "SEC XBRL company facts. LTM = fiscal year plus year-to-date less prior year-to-date, with the concept the filer actually used, restatements deduped by accession." },
  { k: "Filings", v: "EDGAR submissions and full-text search across every filing and exhibit since 2001: 10-Ks, 10-Qs, 8-K item codes, Form 4 insider trades, merger proxies and comment letters." },
  { k: "Earth and alternative data", v: "Copernicus Sentinel-1 and Sentinel-2, NASA FIRMS VIIRS heat detections, NAIP aerial imagery, USGS lidar, EIA and HIFLD infrastructure, state drilling permits, job postings and web attention. Every card says its source and its confidence." },
  { k: "Prices", v: "Quotes, market cap and history from a market data API, not a real-time exchange feed. Consensus estimates are not licensed, so forward figures you enter are marked as yours." },
  { k: "Scoring", v: "Forecasts resolve automatically from the daily checks and are scored with the Brier score; probabilities are recalibrated with Platt scaling once a record is long enough. Deal Radar and Call Desk publish their own scored track records." },
  { k: "Limits we state plainly", v: "Reported EBITDA is operating income plus D&A, not company-adjusted. Base rates use trailing volatility with no drift. The ledger is tamper-evident, not WORM storage. YouBank places no trades and is not investment advice." },
];

const FAQ = [
  { q: "Is this a Bloomberg replacement?", a: "For a small fund or an individual investor, it replaces most of what you would use one for: fundamentals, filings, risk, news, analytics and the AI on top. It does not have what Bloomberg's price pays for: real-time multi-asset exchange data, deep fixed income and Instant Bloomberg chat. If you trade bonds all day, keep the terminal. If you run a concentrated equity book, YouBank covers the research and adds what no terminal does: your theses checked daily, scored forecasts and a record of process." },
  { q: "How does a kill criterion get checked?", a: "You state it as a line (\u201crevenue growth at least 20%\u201d, \u201cgross margin at least 70%\u201d, \u201cprice at least $150\u201d, \u201cnet insider selling under $5M\u201d). After every US close YouBank reads the latest figure from the company's XBRL filings or the price, compares it, and shows the figure, the period and a link to the filing. When one fails, the thesis reads broken and you hear about it." },
  { q: "What is calibration and why should I care?", a: "If you say 80% about ten things, about eight should happen. Most people are overconfident. YouBank lets you put a probability on each thesis, resolves it automatically, and scores it, so after a year you know what your 80% really means. The AI committee is scored the same way, beside you." },
  { q: "Can I use it from Claude or ChatGPT?", a: "Yes. YouBank is an MCP server, the protocol AI apps use for connectors: one URL, sign in with OAuth, and your AI app can read fundamentals, filings and your own book, run risk, check a draft for compliance and propose a position. Nothing enters the book until you approve it, and every call is kept in the research ledger." },
  { q: "Does it work on my phone?", a: "Yes. The web app is built for phones (install it to your home screen), with the Book, Needs you, alerts and the Edge feed. There is also a desktop app for Windows, macOS and Linux with a tray, native notifications and a local agent for your own files." },
  { q: "Will an allocator or examiner accept the record?", a: "The journal is written by the server and cannot be backdated; the ledger is hash-chained so any edit shows, and can be anchored outside YouBank every day. It is tamper-evident, not WORM storage, and the compliance pass is a first read, not counsel. Your compliance officer decides; YouBank gives them the evidence." },
  { q: "Where do the numbers come from?", a: "SEC EDGAR, a market data API, public satellite and government data, and the web, each cited at the figure. A derived number states its method. Check the figures that matter before they go out." },
  { q: "What does it cost?", a: `There is a Free plan, Campus is free with a .edu address, and Pro is ${usd(PLANS.pro.monthlyUsd ?? 0)} a month (${usd(PLANS.pro.yearlyMonthlyUsd ?? 0)} billed yearly). Each plan includes a monthly AI allowance; an AI credit pack (from $10) tops it up, and everything except the AI keeps working if it runs out.` },
];

export function Landing({ toolCounts }: { toolCounts: { total: number; ai: number; calc: number } }) {
  const [demo, setDemo] = useState<"comps" | "ai" | "vc">("comps");
  const sections: [string, string][] = [["#book", "The Book"], ["#edge", "Edge"], ["#proof", "Proof"], ["#mcp", "AI apps"], ["#terminal", "Terminal"], ["#demos", "Demos"], ["#pricing", "Pricing"], ["#data", "Data"]];
  return (
    <main className="overflow-x-hidden">
      {/* ambient background */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="drift absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full opacity-[0.16]" style={{ background: "radial-gradient(circle, var(--accent), transparent 65%)" }} />
        <div className="drift-slow absolute -right-32 top-24 h-[440px] w-[440px] rounded-full opacity-[0.12]" style={{ background: "radial-gradient(circle, var(--chart-1), transparent 65%)" }} />
        <div className="grid-bg absolute inset-0" />
      </div>

      <header className="glass sticky top-0 z-40 border-b border-line bg-bg/80">
        <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-5 py-3">
          <Link href="/" className="flex items-center gap-2"><Logo size={26} /></Link>
          <nav className="ml-4 hidden items-center gap-4 text-[12.5px] text-muted md:flex">
            {sections.map(([href, label]) => href === "#pricing" ? <Link key={href} href="/pricing" className="hover:text-fg">{label}</Link> : <a key={href} href={href} className="hover:text-fg">{label}</a>)}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link href="/sign-in" className="ctl border border-line px-3 py-1.5 text-[12.5px] text-muted transition hover:border-accent/50 hover:text-fg max-md:flex max-md:min-h-10 max-md:items-center">Sign in</Link>
          </div>
        </div>
        {/* Phones: the section links as one sideways-scrolling row under the bar, rather than hidden. */}
        <nav aria-label="Sections" className="no-scrollbar flex gap-1.5 overflow-x-auto px-5 pb-2.5 text-[12.5px] text-muted md:hidden">
          {sections.map(([href, label]) => (
            <a key={href} href={href} className="flex min-h-9 shrink-0 items-center rounded-full border border-line px-3.5 active:bg-elevated">{label}</a>
          ))}
        </nav>
      </header>

      {/* hero */}
      <section className="mx-auto max-w-[1240px] px-5 pb-8 pt-12 lg:pt-16">
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,46%)_minmax(0,54%)]">
          <div>
            <Reveal eager>
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[11px] text-muted">
                <span className="pulse-ring h-1.5 w-1.5 rounded-full bg-accent" /> For small funds and serious investors · free in beta
              </span>
            </Reveal>
            <Reveal eager delay={60}>
              <h1 className="mt-4 text-[40px] font-semibold leading-[1.04] tracking-tight sm:text-[52px]">
                Hedge-fund grade. <span className="gradient-text">Pocket-sized.</span>
              </h1>
            </Reveal>
            <Reveal eager delay={120}>
              <p className="mt-4 max-w-[60ch] text-[14.5px] leading-relaxed text-muted">
                Write the thesis and the numbers that would prove it wrong. YouBank checks them against SEC filings after every close, watches the assets from orbit, scores your conviction like a forecasting tournament, and keeps a tamper-evident record of every AI answer. The research desk, risk system and compliance file of a fund, for a fraction of one terminal seat.
              </p>
            </Reveal>
            <Reveal eager delay={180}>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <SignInButton label="Start free with Google" />
                <a href="#book" className="ctl border border-line px-4 py-2.5 text-[13px] font-semibold text-fg transition hover:border-accent/60 hover:text-accent">See how the Book works</a>
              </div>
              <p className="mt-3 text-[11px] text-muted">No credit card. Not investment advice; YouBank places no trades.</p>
            </Reveal>
            <Reveal eager delay={240}>
              <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-6 sm:grid-cols-4">
                {[
                  { n: toolCounts.total, l: "tools and workflows" },
                  { n: 35, l: "terminal functions" },
                  { n: 22, l: "tools for Claude and ChatGPT" },
                  { n: 13, l: "Edge views, orbit to earnings call" },
                ].map((s) => (
                  <div key={s.l}>
                    <dt className="num text-[22px] font-semibold leading-none text-accent"><CountUp value={s.n} /></dt>
                    <dd className="mt-1 text-[11px] text-muted">{s.l}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>
          <Reveal eager delay={120}><DemoTerminal /></Reveal>
        </div>
      </section>

      {/* value against a terminal */}
      <section id="value" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-8">
        <Reveal>
          <div className="panel grid gap-6 p-6 lg:grid-cols-[minmax(0,38%)_minmax(0,62%)]">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted">The price of an edge</p>
              <p className="mt-3 flex items-baseline gap-3"><span className="num text-[34px] font-semibold text-fg">{usd(PLANS.pro.yearlyMonthlyUsd ?? 0)}</span><span className="text-[12.5px] text-muted">a month, Pro, billed yearly</span></p>
              <p className="mt-1 flex items-baseline gap-3"><span className="num text-[20px] font-semibold text-muted line-through decoration-1">~$2,500</span><span className="text-[12.5px] text-muted">a month for one terminal seat<sup>1</sup></span></p>
              <p className="mt-3 text-[12px] leading-relaxed text-muted">What a terminal still does better: real-time multi-asset exchange data, deep fixed income and Instant Bloomberg chat. If that is your day, keep it. If you run a concentrated equity book, this is the rest of the desk, plus what no terminal does.</p>
            </div>
            <ul className="grid gap-2.5 text-[12.5px] sm:grid-cols-2">
              {[
                "Every thesis checked against SEC filings after every close",
                "Satellite, radar, flaring and permit change on the assets you own",
                "Calibrated odds: deal probability, call evasion, your own forecasts",
                "Risk, VaR, correlated bets and stress replays on your actual book",
                "An AI committee that argues both sides, scored beside you",
                "A journal and ledger an allocator or examiner can verify",
                "Inside Claude, ChatGPT and your own agents over MCP",
                "On your phone, in the browser and as a desktop app",
              ].map((x) => <li key={x} className="flex gap-2 leading-relaxed"><Icon name="Check" className="mt-0.5 h-4 w-4 shrink-0 text-pos" /><span>{x}</span></li>)}
            </ul>
          </div>
        </Reveal>
      </section>

      {/* the loop */}
      <section id="loop" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal><h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">How a fund runs on YouBank</h2></Reveal>
        <Reveal delay={60}><p className="mt-3 max-w-[70ch] text-[22px] font-semibold leading-snug tracking-tight">Hold a view, watch the world, decide, and prove it. One loop, on primary sources.</p></Reveal>
        <div className="mt-8 grid gap-3 md:grid-cols-4">
          {LOOP.map((p, i) => (
            <Reveal key={p.title} delay={i * 70}>
              <div className="lift relative h-full panel p-5">
                <span className="num absolute right-4 top-4 text-[11px] text-muted">0{i + 1}</span>
                <span className="grid h-9 w-9 place-items-center ctl bg-accent-soft text-accent"><Icon name={p.icon} className="h-5 w-5" /></span>
                <h3 className="mt-3 text-[15px] font-semibold">{p.title}</h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{p.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* the Book */}
      <section id="book" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <Reveal>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">The Book</h2>
              <p className="mt-2 text-[22px] font-semibold leading-snug tracking-tight">Every position held to the numbers that would prove it wrong.</p>
              <p className="mt-2 max-w-[62ch] text-[12.5px] text-muted">A thesis you cannot falsify is a feeling. The Book makes each one testable, checks it every day against the filings, and tells you the moment it breaks, before the price does.</p>
            </Reveal>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {BOOK.map((a, i) => (
                <Reveal key={a.title} delay={i * 60}>
                  <div className="h-full panel p-4">
                    <h3 className="flex items-center gap-2 text-[13.5px] font-semibold"><Icon name={a.icon} className="h-4 w-4 text-accent" />{a.title}</h3>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{a.body}</p>
                  </div>
                </Reveal>
              ))}
            </div>
          </div>
          <Reveal delay={100}>
            <div className="panel p-4 lg:sticky lg:top-24">
              <div className="flex items-center gap-2">
                <span className="num text-[14px] font-semibold">SNOW</span>
                <span className="ctl bg-pos/15 px-1.5 py-0.5 text-[10px] font-semibold text-pos">LONG</span>
                <span className="ctl bg-neg/15 px-1.5 py-0.5 text-[10px] font-semibold text-neg">Broken</span>
                <span className="ml-auto num text-[11px] text-muted">4.5% NAV · 70% to Feb</span>
              </div>
              <p className="mt-2 text-[12.5px]">Consumption growth re-accelerates as AI workloads land.</p>
              <table className="mt-3 w-full text-[11.5px]">
                <thead className="text-[10px] uppercase tracking-wider text-muted"><tr><th className="py-1 text-left font-medium">Kill criterion</th><th className="text-right font-medium">Now</th><th className="text-right font-medium">Room</th><th className="text-right font-medium">State</th></tr></thead>
                <tbody className="num">
                  <tr className="border-t border-line"><td className="py-1.5 font-sans">Revenue growth ≥ 20%</td><td className="text-right">24.7%</td><td className="text-right">+4.7 pts</td><td className="text-right text-pos">holds</td></tr>
                  <tr className="border-t border-line"><td className="py-1.5 font-sans">Gross margin ≥ 70%</td><td className="text-right">66.8%</td><td className="text-right text-neg">−3.2 pts</td><td className="text-right text-neg">failed</td></tr>
                  <tr className="border-t border-line"><td className="py-1.5 font-sans">Price ≥ $150</td><td className="text-right">$180.00</td><td className="text-right">+20.0%</td><td className="text-right text-pos">holds</td></tr>
                </tbody>
              </table>
              <p className="mt-2 text-[10.5px] text-muted">Source: SEC XBRL company facts, LTM to 2026-07-31 · price after the close</p>
              <div className="mt-3 space-y-2 text-[11.5px]">
                <div className="ctl border border-neg/40 bg-neg/5 p-2.5"><span className="font-semibold">Needs you:</span> broken for 5 days, nothing done since. Cut it, flip it, or write down why you hold.</div>
                <div className="ctl border border-line p-2.5"><span className="font-semibold">AI committee:</span> trim. Bear brief carried it on margin evidence; dissent: growth is still above 20%. Chairs split 2–1.</div>
                <div className="ctl border border-line p-2.5"><span className="font-semibold">Your calibration:</span> Brier 0.18 over 24 resolved forecasts, overconfident by 6 points. Your 80% has behaved like 72%.</div>
              </div>
              <p className="mt-3 text-[10.5px] text-muted">Illustrative: the layout and checks are the product&apos;s; the position is a sample.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Edge */}
      <section id="edge" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal>
          <h2 className="flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Edge <span className="ctl border border-accent/40 px-1.5 py-0.5 text-[9.5px] tracking-normal">beta</span></h2>
          <p className="mt-2 max-w-[72ch] text-[22px] font-semibold leading-snug tracking-tight">Alternative data and frontier AI, with the confidence written on every card.</p>
          <p className="mt-2 max-w-[85ch] text-[12.5px] leading-relaxed text-muted">The funds with the biggest budgets buy satellite feeds, transcript analytics and deal models. Edge builds them from public data and open models: what changed on the ground, what management dodged on the call, which companies are likely to transact, and an agent that investigates your thesis for days. A visual feed ranked by relevance, size of change, novelty and confidence.</p>
        </Reveal>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {EDGE.map((a, i) => (
            <Reveal key={a.title} delay={(i % 4) * 60}>
              <div className="lift h-full panel p-4">
                <h3 className="flex items-center gap-2 text-[13.5px] font-semibold"><Icon name={a.icon} className="h-4 w-4 text-accent" />{a.title}</h3>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{a.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <p className="mt-4 text-[11px] leading-relaxed text-muted">Models in the stack include Prithvi-EO-2.0 and SAM 2.1 for imagery, AlphaEarth embeddings for change, a calibrated evasion classifier for calls, graph networks for relationships, and labelled synthetic data for scenarios. Predictions carry calibrated probabilities and public, automatically scored track records, so you can see how often they are right.</p>
        </Reveal>
      </section>

      {/* proof of process */}
      <section id="proof" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Proof, not vibes</h2>
          <p className="mt-2 max-w-[70ch] text-[22px] font-semibold leading-snug tracking-tight">A track record of process, before you have three years of returns.</p>
          <p className="mt-2 max-w-[85ch] text-[12.5px] leading-relaxed text-muted">Allocators and the SEC&apos;s examiners now ask how decisions were made and how AI was governed. Results take years to mean anything; process can be shown from day one, if it was recorded when it happened.</p>
        </Reveal>
        <div className="mt-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { icon: "NotebookPen", t: "A decision journal", b: "Every change to weight, side, forecast, criteria or thesis is dated by the server with your reason. It cannot be backdated after the outcome is known, and it exports to CSV for the compliance file." },
            { icon: "ScrollText", t: "A research ledger", b: "Every AI answer and AI-app call kept with its prompt, model and sources, hash-chained so any edit shows, anchored outside YouBank daily. Reviewers sign off; a one-page governance report answers the DDQ." },
            { icon: "Gauge", t: "Scored forecasts", b: "Your forecasts, the committee's and your AI apps' side by side, Brier-scored and recalibrated. A forecast cannot be made on a thesis that already reads broken, so the score cannot be farmed." },
            { icon: "FileText", t: "Letters and DDQs, checked", b: "Draft the LP letter from the book in your own journal words, and answer an LP's AI questions from the ledger. A compliance pass flags promises, performance without a period and AI claims you can't back." },
          ].map((x, i) => (
            <Reveal key={x.t} delay={i * 60}>
              <div className="h-full panel p-4">
                <h3 className="flex items-center gap-2 text-[13.5px] font-semibold"><Icon name={x.icon} className="h-4 w-4 text-accent" />{x.t}</h3>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{x.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* MCP */}
      <section id="mcp" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Reveal>
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">In your AI apps</h2>
            <p className="mt-2 text-[22px] font-semibold leading-snug tracking-tight">Claude and ChatGPT, with a fund&apos;s data and a fund&apos;s discipline.</p>
            <p className="mt-2 max-w-[62ch] text-[12.5px] leading-relaxed text-muted">YouBank is an MCP server: add one URL as a connector, sign in, and your AI app can read fundamentals and filings, check your book, run risk and a what-if, review a draft for the Marketing Rule, and propose a position with its thesis and kill criteria. Every figure comes back cited; every call is in the ledger; nothing enters the book until you approve it.</p>
            <ul className="mt-4 grid gap-2 text-[12.5px] sm:grid-cols-2">
              {["22 tools and 9 prompts, from book review to a pre-mortem", "OAuth 2.1 sign-in, one URL, revocable keys", "A per-app allow-list and a pause switch", "Proposals land as a card you approve or dismiss"].map((x) => <li key={x} className="flex gap-2"><Icon name="Check" className="mt-0.5 h-4 w-4 shrink-0 text-pos" />{x}</li>)}
            </ul>
          </Reveal>
          <Reveal delay={100}>
            <div className="panel p-4 font-mono text-[11.5px] leading-relaxed">
              <p className="text-muted">you › what in my book needs me today, and is any forecast above its base rate?</p>
              <p className="mt-2 text-accent">› book_status</p>
              <p className="mt-1">needs_you: <span className="text-neg">SNOW broken 5 days, nothing done since</span>; CRWD broken today</p>
              <p>catalysts_to_review: COST Q1 earnings (2026-11-02)</p>
              <p>pm_forecast_above_base_rate: NVDA 85% vs a 61% volatility-only chance the price line holds; what do you expect that the model does not?</p>
              <p className="mt-2 text-accent">› book_risk what_if=+3% AMD</p>
              <p className="mt-1">VaR 95% 1.84% → 2.11% · AMD moves with NVDA (ρ 0.78): one bet, not two</p>
              <p className="mt-3 text-muted">Sources: [S1] SEC XBRL, SNOW 10-Q · [S2] prices after the close · logged to the research ledger</p>
              <p className="mt-2 font-sans text-[10.5px] text-muted">Illustrative: the tools and fields are the product&apos;s; the book is a sample.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* terminal */}
      <section id="terminal" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">The terminal</h2>
          <p className="mt-2 text-[22px] font-semibold leading-snug tracking-tight">Terminal-grade functions, with the models shown.</p>
          <p className="mt-2 max-w-[70ch] text-[12.5px] text-muted">More than thirty-five functions on familiar codes: <span className="num text-fg">GP BETA RISK WACC IRAT QUAL FCST EE ANR DVD GC ECO WEI EQS PORT</span>. Each screen shows its method and sources, and the assistant uses the same models, so an answer about risk or credit names the model behind every number.</p>
        </Reveal>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TERMINAL.map((a, i) => (
            <Reveal key={a.title} delay={i * 60}>
              <div className="h-full panel p-4">
                <h3 className="flex items-center gap-2 text-[13.5px] font-semibold"><Icon name={a.icon} className="h-4 w-4 text-accent" />{a.title}</h3>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{a.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* the rest of the desk */}
      <section id="more" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">The rest of the desk</h2>
          <p className="mt-2 max-w-[70ch] text-[22px] font-semibold leading-snug tracking-tight">Models, news, meetings and your inbox, wired into the same book.</p>
        </Reveal>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {[
            { icon: "FileSpreadsheet", t: "Studio", b: "DCF, LBO, comps and decks built live from SEC data while you watch, linked so a change in the model moves every slide, audited like a reviewer would, and synced with Excel and PowerPoint." },
            { icon: "Newspaper", t: "Newsroom", b: "Market news read for what it means to your positions, with the filings behind each story, audio briefs and a weekly read of your book." },
            { icon: "Headphones", t: "Meeting copilot", b: "Management calls and expert calls transcribed with the host's consent, notes and follow-ups filed against the company, suggestions live during the call." },
            { icon: "Mail", t: "Relationships agent", b: "Your inbox for LPs, brokers and counterparties: who wrote and what they want, replies drafted for you to send, and follow-ups that don't slip." },
            { icon: "Smartphone", t: "Phone and desktop", b: "Install the web app on your phone for the Book, alerts and the Edge feed. The desktop app adds a tray, native alerts, a quick-ask hotkey and a local agent for your own files." },
          ].map((x, i) => (
            <Reveal key={x.t} delay={i * 60}>
              <div className="h-full panel p-4">
                <h3 className="flex items-center gap-2 text-[13.5px] font-semibold"><Icon name={x.icon} className="h-4 w-4 text-accent" />{x.t}</h3>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{x.b}</p>
              </div>
            </Reveal>
          ))}
        </div>
      </section>

      {/* demos */}
      <section id="demos" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Live demos</h2>
              <p className="mt-2 max-w-[60ch] text-[22px] font-semibold leading-snug tracking-tight">Real data, real output. Nothing here is a screenshot.</p>
              <p className="mt-2 text-[12px] text-muted">Built from a frozen snapshot of the production database, {DEMO.asOf}. Signed in, these run live.</p>
            </div>
            <div className="flex overflow-hidden ctl border border-line text-[12px]">
              {([["comps", "Trading comps"], ["ai", "AI with citations"], ["vc", "Private markets"]] as const).map(([k, label]) => (
                <button key={k} type="button" onClick={() => setDemo(k)} className={`px-3 py-2 transition ${demo === k ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{label}</button>
              ))}
            </div>
          </div>
        </Reveal>
        <div className="mt-6">
          {demo === "comps" && <div className="rise"><DemoComps /></div>}
          {demo === "ai" && (
            <div className="rise grid gap-3 lg:grid-cols-[1fr_320px]">
              <DemoAi height={380} />
              <div className="panel p-4">
                <h3 className="text-[13px] font-semibold">How it answers</h3>
                <ol className="mt-3 space-y-2.5 text-[12px] text-muted">
                  {[
                    "Chooses tools, not vibes: XBRL facts, the comps engine, filing text, full-text search, the web.",
                    "Computes with an exact calculator so multiples and IRRs are not guessed.",
                    "Checks each figure against the source it cites, and links to the filing.",
                    "States the limits: fiscal-year mismatches, reported versus adjusted EBITDA, missing estimates.",
                  ].map((t, i) => (
                    <li key={i} className="flex gap-2"><span className="num grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[10px] font-semibold text-accent">{i + 1}</span><span>{t}</span></li>
                  ))}
                </ol>
              </div>
            </div>
          )}
          {demo === "vc" && <div className="rise"><DemoDirectory /></div>}
        </div>
      </section>

      {/* who it is for */}
      <section id="roles" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Who it is for</h2>
          <p className="mt-2 max-w-[70ch] text-[22px] font-semibold leading-snug tracking-tight">The tools of a large fund, priced for everyone who is not one.</p>
          <p className="mt-2 max-w-[90ch] text-[12px] text-muted">
            A general AI assistant will write you a thesis for $20 a month, but not check it every day against the filings, score whether you were right, or keep the record. The platforms that bring the data sell annual contracts in the thousands to tens of thousands of dollars a seat.<sup>2</sup> YouBank is for the funds and investors in between.
          </p>
        </Reveal>
        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {SEGMENTS.map((s, i) => (
            <Reveal key={s.title} delay={(i % 4) * 70}>
              <div className="h-full panel p-4">
                <span className="grid h-8 w-8 place-items-center ctl bg-accent-soft text-accent"><Icon name={s.icon} className="h-4 w-4" /></span>
                <h3 className="mt-2.5 text-[13.5px] font-semibold">{s.title}</h3>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{s.body}</p>
              </div>
            </Reveal>
          ))}
        </div>
        <Reveal>
          <p className="mt-8 text-[12.5px] font-semibold">Also built for eight careers in finance, each with its own toolkit</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {ROLE_IDS.map((id) => (
              <Link key={id} href={`/for/${id}`} className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-muted transition hover:border-accent/50 hover:text-fg">
                <Icon name={ROLE_ICON[id]} className="h-3.5 w-3.5" />{ROLES[id].label}
              </Link>
            ))}
          </div>
          <p className="mt-2 text-[11.5px] text-muted">{toolCounts.ai} AI workflows that research and draft, and {toolCounts.calc} calculators that compute exactly.</p>
        </Reveal>
      </section>

      {/* pricing */}
      <section id="pricing" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Pricing</h2>
          <p className="mt-2 text-[22px] font-semibold leading-snug tracking-tight">Start free. A fraction of a terminal when you are ready.</p>
          <p className="mt-2 max-w-[80ch] text-[12.5px] text-muted">Every plan has the terminal and the public data. Paid plans add a larger monthly AI allowance and the premium features; the allowance is what keeps prices honest, because model time is most of what YouBank costs to run. Prices are in US dollars, before tax. Beta accounts will be told well before anything is billed.</p>
        </Reveal>
        <div className="mt-7 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {PRICE_CARDS.map((p, i) => (
            <Reveal key={p.name} delay={i * 60}>
              <div className={`flex h-full flex-col panel p-5 ${p.highlight ? "glow border-accent/50" : ""}`}>
                <h3 className="text-[14px] font-semibold">{p.name}</h3>
                <p className="mt-2"><span className="text-[26px] font-semibold">{p.price}</span></p>
                <p className="text-[11px] text-muted">{p.unit}</p>
                <ul className="mt-4 space-y-1.5 text-[12px]">
                  {p.points.map((x) => <li key={x} className="flex gap-1.5"><Icon name="Check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{x}</li>)}
                </ul>
              </div>
            </Reveal>
          ))}
        </div>
        <p className="mt-4 text-[12px] text-muted">AI credit packs from {usd(CREDIT_PACKS[0].priceUsd)} top up any plan. <Link href="/pricing" className="text-accent hover:underline">Compare every plan, the packs and the FAQ →</Link></p>
      </section>

      {/* data & method */}
      <section id="data" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <div className="grid gap-8 lg:grid-cols-2">
          <Reveal>
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Data and method</h2>
            <p className="mt-2 text-[22px] font-semibold leading-snug tracking-tight">Auditable by design.</p>
            <dl className="mt-5 space-y-3">
              {METHOD.map((m) => (
                <div key={m.k} className="border-t border-line pt-3">
                  <dt className="text-[12.5px] font-semibold">{m.k}</dt>
                  <dd className="mt-1 text-[12px] leading-relaxed text-muted">{m.v}</dd>
                </div>
              ))}
            </dl>
          </Reveal>
          <Reveal delay={80}>
            <div className="space-y-3">
              {FAQ.map((f) => (
                <details key={f.q} className="lift panel px-4 py-3">
                  <summary className="cursor-pointer text-[13px] font-semibold marker:text-accent">{f.q}</summary>
                  <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{f.a}</p>
                </details>
              ))}
            </div>
          </Reveal>
        </div>
      </section>

      {/* final CTA */}
      <section className="mx-auto max-w-[1240px] px-5 pb-16 pt-6">
        <Reveal>
          <div className="glow relative overflow-hidden panel p-8 text-center">
            <div aria-hidden className="pointer-events-none absolute inset-0 opacity-[0.10]" style={{ background: "radial-gradient(600px 240px at 50% 0%, var(--accent), transparent 70%)" }} />
            <h2 className="relative text-[26px] font-semibold tracking-tight">Run your book like a fund.</h2>
            <p className="relative mx-auto mt-2 max-w-[62ch] text-[13px] text-muted">Load the sample book in one click and watch a thesis break, or write your first one in plain English. Two minutes to your own desk.</p>
            <div className="relative mt-6 flex justify-center"><SignInButton label="Continue with Google" /></div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-3 px-5 py-6 text-[11px] text-muted">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="flex items-center gap-2"><LogoMark size={16} id="foot" /> YouBank</span>
            <span>Data: SEC EDGAR, Financial Modeling Prep, Copernicus Sentinel, NASA FIRMS, USGS, EIA.</span>
            <span>Not investment advice. YouBank places no trades. Figures are derived from public filings and may be restated.</span>
            <LegalLinks className="ml-auto" />
            <Link href="/download" className="hover:text-fg">Desktop app</Link>
            <Link href="/sign-in" className="hover:text-fg">Sign in →</Link>
          </div>
          <p className="text-[10.5px] leading-relaxed">
            <sup>1</sup> Bloomberg does not publish its price; press and buyer reports put a single Terminal subscription at roughly $30,000 a year or more (2025–2026). Pro is {usd((PLANS.pro.yearlyMonthlyUsd ?? 0) * 12)} a year billed yearly.{" "}
            <sup>2</sup> Sacra&apos;s estimate for Rogo is about $3,300 per seat a year; Vendr buyer data put AlphaSense&apos;s median contract at $18,375 a year (February 2026). Retail research terminals publish $25–$120 a month (TIKR, Koyfin, September 2026).
          </p>
        </div>
      </footer>
    </main>
  );
}
