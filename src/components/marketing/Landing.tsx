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
import { ThemeShowcase } from "./ThemeShowcase";
import { AdaptiveDemo } from "./AdaptiveDemo";
import { Reveal, CountUp } from "@/components/motion/Reveal";
import { Icon } from "@/components/ui/Icon";
import { ThemeMenu } from "@/components/theme/ThemeMenu";
import { Logo, LogoMark } from "@/components/brand/Logo";

const ROLE_ICON: Record<RoleId, string> = { banker: "Landmark", pe: "Briefcase", vc: "Rocket", markets: "LineChart", corpfin: "Building2", consultant: "Compass", accountant: "Receipt", student: "GraduationCap" };

/** Signal, analysis, action, memory: the loop the whole product is built around. */
const LOOP = [
  { icon: "Radar", title: "Signal", body: "New SEC Form D raises every business day, 8-K events decoded, insider trades, and funding news matched to the people in your inbox." },
  { icon: "FileSearch", title: "Analysis", body: "Comps, precedents, capital structure, memos and QoE flags built from XBRL and filing text in minutes. Every figure links to its filing." },
  { icon: "Mail", title: "Action", body: "An agent that tracks every thread, drafts the reply, runs outreach and keeps the pipeline current. It sends on its own only where you allow it." },
  { icon: "Sparkles", title: "Memory", body: "A playbook of your answers, lessons from your edits, and trust earned email by email. It needs less of you every week." },
];

const AGENT = [
  { icon: "Mail", title: "Tracks every email", body: "Connect Gmail, Google Workspace, iCloud, Yahoo, Zoho or Fastmail with an app password. It reads new mail every five minutes, files who wrote and what they want, and keeps a pipeline: lead, contacted, engaged, meeting, proposal, won." },
  { icon: "Bot", title: "Answers what it can", body: "Prospects, customers and your own coworkers get a reply drafted in your voice. You choose, per kind of email, whether it waits for you or goes on autopilot." },
  { icon: "MessageSquare", title: "Asks what it cannot, and remembers", body: "When a reply needs something only you know (a price, a date, a yes), it asks you one short question. Tick “remember” and the next person who asks gets the answer without bothering you." },
  { icon: "Target", title: "Runs outbound", body: "Build a list from 18,000+ startups or your own, qualify it against your ideal profile, and work through a personalised sequence that stops the moment someone replies or opts out." },
];

const STUDIO = [
  { icon: "Play", title: "Watch it build", body: "Ask for a valuation pack and watch the DCF, the comps and the pitch book fill in from SEC filings, a cell at a time, with the agent's cursor on screen. Stop it at any moment; undo any run in one click." },
  { icon: "Layers", title: "Model and deck, linked", body: "Tables, charts and figures on slides are links into the model. Change the WACC and every page moves with it; the tie-out flags any number on a slide that does not trace back to a cell." },
  { icon: "Landmark", title: "Models a VP would sign", body: "DCF, LBO with a real debt schedule and its circularity solved, trading comps, merger and cap table templates. Blue inputs, black formulas, green links, sourced historicals." },
  { icon: "ListChecks", title: "The checks you do by hand", body: "Every run ends with an audit: numbers typed into formulas, overwritten formulas, broken row patterns, errors, circular references. Banker formatting and data tables in one click." },
  { icon: "MessageSquare", title: "Page turns, turned", body: "Leave comments on cells and slides, or photograph the MD's marked-up printout and every pen mark becomes a comment on its cell or slide. The agent makes each change and resolves each comment, saying what it did." },
  { icon: "FileSpreadsheet", title: "Inside Excel and PowerPoint", body: "Install the add-in and the agent works in your own workbook: each cell lands in Excel as it writes, your edits sync back, and decks in PowerPoint refresh in place when the model moves." },
  { icon: "FileSearch", title: "Data room to model", body: "Drop in a CIM or audited accounts and its financial tables arrive as a sheet of inputs, every figure copied as printed and tagged with its page. Upload a seller's model and get an intake report first." },
  { icon: "CheckSquare", title: "Before it goes out", body: "A brand check for stale cover dates, missing source lines, text off the page and off-brand colours, with one-click fixes. Checkpoints show exactly what moved since the version the MD saw." },
];

const TERMINAL = [
  { icon: "Gauge", title: "Risk with its error bars", body: "GARCH volatility forecasts and a price cone, betas four ways with their standard errors (including Welch's, the best predictor of future beta), and value at risk three ways with a backtest that says whether it held." },
  { icon: "Shield", title: "Credit without a ratings licence", body: "An implied rating from Altman's Z'', Ohlson's O-score and Merton's distance to default, with historical default rates, for every US filer. Where a model does not fit a company, it is left out and the screen says why." },
  { icon: "LineChart", title: "Forecasts with honest intervals", body: "Revenue and the economy forecast with the methods that won the M4 competition, and bands sized by how wrong the method has actually been, with the coverage shown. Set beside the Street's consensus." },
  { icon: "BarChart3", title: "Valuation as a range", body: "WACC from its parts with a Monte Carlo range, and a Monte Carlo DCF with correlated inputs, in the terminal, the tool library and inside any Studio model: P10, P50, P90 and what drives the spread." },
  { icon: "Landmark", title: "Rates and the economy", body: "The Treasury curve with its Nelson-Siegel factors and the New York Fed's recession probability; BLS inflation and jobs with model outlooks and the Sahm rule. Markets boards read each move in its own volatility." },
  { icon: "GraduationCap", title: "It learns what you know", body: "Knowledge tracing follows how well you know each function: hints fade as you master them, and the next functions unlock when you are ready. Ask for a quick quiz, or an AI read of any screen." },
];

const GUARDRAILS = [
  "Autopilot is off until you switch it on, and each kind of email has its own setting: off, ask me, or autopilot.",
  "It never sends what it is unsure of, anything sensitive, anything with a blank to fill, or anything that needs your input. It says why.",
  "It never sends a link, email address or account number you have not given it yourself, so an inbound email cannot steer it.",
  "Automatic emails wait out a hold you can cancel, go only in your sending hours, and stop at a daily limit. About 1 in 5 still comes to you as a spot check.",
  "It never answers newsletters, auto-replies or no-reply addresses, and before sending it re-reads the live thread: if you already replied from your phone, its draft is withdrawn.",
  "Campaigns skip EU and Canadian recipients unless you confirm consent, and nobody gets more than one first cold email through YouBank a month.",
  "Every email goes from your own mailbox. Regulated mode turns autopilot off entirely, and the audit log exports every draft, who sent it and how much it was edited.",
  "Your data trains no model. What the engine learns is statistics and plain-language lessons in your account, which you can read and retire.",
];

const SEGMENTS = [
  { icon: "Handshake", title: "Boutique advisors and placement agents", body: "Comps, buyer lists and teasers without a Capital IQ budget, and an outreach desk that keeps every mandate moving." },
  { icon: "Briefcase", title: "Emerging VC and PE managers", body: "Form D and funding signals on the companies you track, cited diligence, and a pipeline that files itself from your inbox." },
  { icon: "Rocket", title: "Founders raising or selling", body: "Cold outreach, investor and customer follow-up, and replies to your own team, with autopilot where you have earned it." },
  { icon: "GraduationCap", title: "Students recruiting into finance", body: "Real comps and DCFs on real filings, deal walk-throughs from 8-Ks, and the same desk you will use on the job." },
];

/** Planned plans, from the pricing research. Nothing is billed during the beta. */
const PLANS = [
  { name: "Campus", price: "Free", unit: "with a .edu address", points: ["The full terminal and data", "AI workflows with a monthly allowance", "Recruiting pack: practice comps, deal walk-throughs"] },
  { name: "Pro", price: "$39", unit: "per month, or $29 billed yearly", points: ["Everything in Campus, higher limits", "Relationships agent and one mailbox", "Nurture, signals and compose"], highlight: false },
  { name: "Deal Team", price: "$149", unit: "per seat per month, three seats minimum", points: ["Autopilot and campaigns", "The adaptive engine across the team", "Shared workspaces and live collaboration"], highlight: true },
  { name: "Enterprise", price: "From $249", unit: "per seat per month, yearly", points: ["Regulated mode and audit exports", "SSO, admin controls, data residency options", "Bring your own data licences"] },
];

const METHOD = [
  { k: "Fundamentals", v: "SEC XBRL company facts. LTM = fiscal year plus year-to-date less prior year-to-date, with the concept the filer actually used, restatements deduped by accession." },
  { k: "Filings", v: "EDGAR submissions and full-text search across every filing and exhibit since 2001: merger proxies, credit agreements, indentures, comment letters, 8-K item codes." },
  { k: "Private markets", v: `${DEMO.directoryTotal.toLocaleString()} startups from Y Combinator, a16z, Thiel Fellows, Show HN, SEC Form D and AI web discovery, refreshed nightly.` },
  { k: "Prices", v: "Quotes, market cap and 52-week range from a market data API. Consensus estimates are not licensed, so NTM figures are entered by you and marked as manual." },
  { k: "The adaptive engine", v: "Per-account statistics you can inspect: how often you send each kind of draft unchanged (certified on your own decisions with exact Beta bounds), Thompson sampling over outreach choices rewarded by human replies, and plain-language lessons from your edits. No model is trained on your data." },
  { k: "Limits we state plainly", v: "Reported EBITDA is operating income plus D&A, not company-adjusted. Fiscal years are not calendarized. The agent's confidence is its own estimate, which is why autopilot also has to earn your trust." },
];

const FAQ = [
  { q: "Will it send emails without me?", a: "Only if you switch autopilot on, only for the kinds of email you choose, and only when a draft passes every check: high confidence, nothing sensitive, nothing it needs to ask you, inside your hours and daily limit. Until then every email waits for you to press Send." },
  { q: "How does it learn?", a: "From what you do. Each draft you send unchanged or edit, and each automatic send you stop, updates how far it can be trusted with that kind of email; autopilot is offered only once it is 90% confident at most 1 in 10 would need your edits. Edits become lessons, your own past emails set the tone, and replies to outreach tell it which openings and send times work. All of it is visible and reversible in the app." },
  { q: "Is it suitable for a FINRA-registered firm?", a: "Regulated mode is built for it: autopilot cannot be switched on, every email is sent by a person from their own mailbox (so the firm's archive captures it), and every AI draft can be exported for supervision. Your compliance team decides; we give them the controls and the log." },
  { q: "Can it build my models and decks?", a: "Yes, in Studio. Describe what you need, or start from a DCF, LBO, comps, merger or cap table template filled from SEC filings, and watch the agent build the workbook and the slides. Slides stay linked to the model, every run is audited and can be undone, and it all exports to Excel and PowerPoint. You can also upload your own workbook." },
  { q: "Does it work in my own Excel and PowerPoint?", a: "Yes. Install the YouBank add-in (Excel and PowerPoint on the web, Windows or Mac, with Microsoft 365 or Office 2021 and later) and connect it with a code. Link a workbook and the agent writes into it cell by cell while you watch; your edits sync back to YouBank; decks in PowerPoint refresh from the model. An IT admin can deploy it to a whole team." },
  { q: "Where do the numbers come from?", a: "SEC EDGAR and a price API, with the source link on every figure. Anything from the web is cited. If a number is derived, the method is stated next to it." },
  { q: "Is this a Bloomberg replacement?", a: "No. Bloomberg's edge is licensed real-time market data, chat and fixed-income depth. YouBank's edge is the free regulatory corpus plus an agent that produces the deliverable and does the follow-through." },
  { q: "What does it cost?", a: "Free while in beta. The plans below are what we intend to charge afterwards; nothing is billed today." },
];

export function Landing({ toolCounts }: { toolCounts: { total: number; ai: number; calc: number } }) {
  const [demo, setDemo] = useState<"comps" | "ai" | "vc">("comps");
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
            <a href="#loop" className="hover:text-fg">Product</a>
            <a href="#agent" className="hover:text-fg">Agent</a>
            <a href="#terminal" className="hover:text-fg">Terminal</a>
            <a href="#studio" className="hover:text-fg">Studio</a>
            <a href="#engine" className="hover:text-fg">Adaptive engine</a>
            <a href="#demos" className="hover:text-fg">Demos</a>
            <a href="#pricing" className="hover:text-fg">Pricing</a>
            <a href="#data" className="hover:text-fg">Data</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeMenu />
            <Link href="/sign-in" className="ctl border border-line px-3 py-1.5 text-[12.5px] text-muted transition hover:border-accent/50 hover:text-fg max-md:flex max-md:min-h-10 max-md:items-center">Sign in</Link>
          </div>
        </div>
        {/* Phones: the section links as one sideways-scrolling row under the bar, rather than hidden. */}
        <nav aria-label="Sections" className="no-scrollbar flex gap-1.5 overflow-x-auto px-5 pb-2.5 text-[12.5px] text-muted md:hidden">
          {[["#loop", "Product"], ["#agent", "Agent"], ["#terminal", "Terminal"], ["#studio", "Studio"], ["#engine", "Adaptive engine"], ["#demos", "Demos"], ["#pricing", "Pricing"], ["#data", "Data"]].map(([href, label]) => (
            <a key={href} href={href} className="flex min-h-9 shrink-0 items-center rounded-full border border-line px-3.5 active:bg-elevated">{label}</a>
          ))}
        </nav>
      </header>

      {/* hero */}
      <section className="mx-auto max-w-[1240px] px-5 pb-8 pt-12 lg:pt-16">
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-[minmax(0,46%)_minmax(0,54%)]">
          <div>
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[11px] text-muted">
                <span className="pulse-ring h-1.5 w-1.5 rounded-full bg-accent" /> New: an email agent that earns autopilot · free in beta
              </span>
            </Reveal>
            <Reveal delay={60}>
              <h1 className="mt-4 text-[38px] font-semibold leading-[1.06] tracking-tight sm:text-[46px]">
                The AI deal desk that <span className="gradient-text">does the work, and learns how you do it</span>.
              </h1>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-4 max-w-[58ch] text-[14.5px] leading-relaxed text-muted">
                Cited analysis from SEC filings, and an agent that tracks every email, answers what it can, asks you what it cannot, and earns the right to send on its own. For boutique advisors, emerging managers, founders, and the students who will join them.
              </p>
            </Reveal>
            <Reveal delay={180}>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <SignInButton label="Start free with Google" />
                <a href="#engine" className="ctl border border-line px-4 py-2.5 text-[13px] font-semibold text-fg transition hover:border-accent/60 hover:text-accent">Try the adaptive engine</a>
              </div>
              <p className="mt-3 text-[11px] text-muted">No credit card. Nothing is sent from your mailbox unless you switch that on.</p>
            </Reveal>
            <Reveal delay={240}>
              <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-6 sm:grid-cols-4">
                {[
                  { n: toolCounts.total, l: "tools across 8 careers" },
                  { n: DEMO.directoryTotal, l: "startups indexed" },
                  { n: toolCounts.ai, l: "AI workflows" },
                  { n: 3, l: "learning loops per account" },
                ].map((s) => (
                  <div key={s.l}>
                    <dt className="num text-[22px] font-semibold leading-none text-accent"><CountUp value={s.n} /></dt>
                    <dd className="mt-1 text-[11px] text-muted">{s.l}</dd>
                  </div>
                ))}
              </dl>
            </Reveal>
          </div>
          <Reveal delay={120}><DemoTerminal /></Reveal>
        </div>
      </section>

      {/* the loop */}
      <section id="loop" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal><h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">How it works</h2></Reveal>
        <Reveal delay={60}><p className="mt-3 max-w-[70ch] text-[22px] font-semibold leading-snug tracking-tight">One loop, from the filing to the follow-up: signal, analysis, action, memory.</p></Reveal>
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

      {/* the agent */}
      <section id="agent" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <Reveal>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">The relationships agent</h2>
              <p className="mt-2 text-[22px] font-semibold leading-snug tracking-tight">Your inbox, handled the way you would handle it.</p>
              <p className="mt-2 max-w-[62ch] text-[12.5px] text-muted">A founder sending cold emails, answering prospects and replying to the team. An investor screening pitches. The agent works in your mode, your voice and your rules.</p>
            </Reveal>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {AGENT.map((a, i) => (
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
            <div className="panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">Your queue, this morning</p>
              <div className="mt-3 space-y-2.5 text-[12px]">
                <div className="ctl border border-accent/40 bg-accent-soft/40 p-3">
                  <p className="font-semibold">The agent needs your input</p>
                  <p className="mt-1">What pricing should we quote for 10 entities on NetSuite?</p>
                  <p className="mt-1 text-[11px] text-muted">Your answer finishes the reply to Dana, and is remembered for the next person who asks.</p>
                </div>
                <div className="ctl border border-accent/40 p-3">
                  <p className="flex items-center gap-2"><span className="ctl bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">Reply to coworker</span><span className="ctl bg-pos/15 px-1.5 py-0.5 text-[10px] text-pos">high confidence</span></p>
                  <p className="mt-1.5">Tell them we integrate natively with NetSuite and QuickBooks Online…</p>
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-accent"><Icon name="Timer" className="h-3 w-3" /> Autopilot sends this in 4 min unless you stop it.</p>
                </div>
                <div className="ctl border border-line p-3">
                  <p className="flex items-center gap-2"><span className="ctl bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold text-accent">Reply</span><span className="ctl bg-info/15 px-1.5 py-0.5 text-[10px] text-info">medium confidence</span></p>
                  <p className="mt-1.5 text-[11px] text-info">Autopilot left this for you: The agent&apos;s confidence is medium, not high; It touches money, terms, legal or something sensitive.</p>
                </div>
                <div className="ctl border border-pos/40 bg-pos/5 p-3 text-[11.5px]">
                  Replies to coworkers: 24 of your last 24 went out exactly as written. We are 90% confident at most 10% would need your edits. Put them on autopilot?
                </div>
              </div>
            </div>
          </Reveal>
        </div>
      </section>

      {/* studio */}
      <section id="studio" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div>
            <Reveal>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Studio</h2>
              <p className="mt-2 text-[22px] font-semibold leading-snug tracking-tight">The model and the deck, built live while you watch.</p>
              <p className="mt-2 max-w-[62ch] text-[12.5px] text-muted">Analysts spend their nights spreading comps, rebuilding models, pasting tables into slides and tying out every number. Studio does that work in a live workbook and deck that stay linked, and checks it the way a reviewer would.</p>
            </Reveal>
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              {STUDIO.map((a, i) => (
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
            <div className="panel p-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted">&ldquo;Build a valuation pack for Snowflake with a deck&rdquo;</p>
              <ol className="mt-3 space-y-2 border-l border-line pl-3 text-[12px]">
                {[
                  ["Building the model from SEC data", "DCF, comps and a summary sheet, from XBRL company facts"],
                  ["Writing cells", "DCF!C5:G20: revenue, margins, free cash flow"],
                  ["Computing a data table", "Implied price across WACC and terminal growth"],
                  ["Adding slides", "Overview, comps, DCF, football field, sensitivity"],
                  ["Auditing the model", "No errors; no numbers typed into formulas"],
                  ["Tying out the deck", "Every figure on every slide traces to a cell"],
                ].map(([t, d], i) => (
                  <li key={t} className="flex gap-2"><Icon name="Check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pos" /><span><span className="font-semibold">{t}</span><span className="text-muted"> · {d}</span>{i === 1 && <span className="ml-1.5 ctl bg-accent/80 px-1 text-[9.5px] font-bold text-bg">Agent</span>}</span></li>
                ))}
              </ol>
              <p className="mt-4 text-[11px] text-muted">Every change is logged with its undo. Work in the browser, or inside Excel and PowerPoint with the add-in; files export with formulas and native charts intact.</p>
            </div>
          </Reveal>
        </div>
      </section>

      {/* terminal */}
      <section id="terminal" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">The terminal</h2>
          <p className="mt-2 text-[22px] font-semibold leading-snug tracking-tight">Terminal-grade functions, with the models shown.</p>
          <p className="mt-2 max-w-[70ch] text-[12.5px] text-muted">More than thirty-five functions on familiar codes: <span className="num text-fg">GP BETA RISK WACC IRAT QUAL FCST EE ANR DVD GC ECO WEI EQS PORT</span>. Each analytics screen shows its method and sources, and the assistant uses the same models, so an answer about risk or credit names the model behind every number.</p>
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

      {/* adaptive engine */}
      <section id="engine" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">The adaptive engine</h2>
          <p className="mt-2 max-w-[70ch] text-[22px] font-semibold leading-snug tracking-tight">Autonomy is earned, not assumed. Try it: this runs the product&apos;s own code.</p>
          <p className="mt-2 max-w-[85ch] text-[12.5px] leading-relaxed text-muted">
            A language model&apos;s confidence in itself is not evidence. YouBank decides what to automate from what you do: every draft you send unchanged or edit, and every reply your outreach earns. Three learning loops, each with its uncertainty shown rather than hidden.
          </p>
        </Reveal>
        <div className="mt-7"><AdaptiveDemo /></div>
        <Reveal>
          <div className="mt-6 grid gap-3 md:grid-cols-3">
            {[
              { t: "Earned autonomy", b: "Your own decisions, per kind of email, certified with exact bounds: autopilot is offered once the engine is 90% confident at most 10% would need edits. Spot checks keep it learning; stopped sends, a rising edit rate or time hand it back." },
              { t: "Outreach experiments", b: "Thompson sampling over opening angles and send times, rewarded by human replies and penalised by opt-outs, learning from day one by counting unanswered sends as partial misses. One decision in ten explores at random, and every choice is logged." },
              { t: "Lessons from edits", b: "Durable preferences inferred from what you change, applied once seen twice or confirmed, plus your own most similar emails as examples of tone. Lessons shape wording only; they never authorise a fact or relax a rule." },
            ].map((x) => (
              <div key={x.t} className="panel p-4">
                <h3 className="text-[13px] font-semibold">{x.t}</h3>
                <p className="mt-1.5 text-[12px] leading-relaxed text-muted">{x.b}</p>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10.5px] leading-relaxed text-muted">
            Methods: W. R. Thompson, Biometrika (1933); O. Chapelle and L. Li, NeurIPS (2011); D. Russo et al., “A Tutorial on Thompson Sampling” (2018); C. Vernade, O. Cappé and V. Perchet, UAI (2017), arXiv:1706.09186, for delayed rewards; A. Angelopoulos et al., “Learn then Test”, Annals of Applied Statistics (2025), arXiv:2110.01052, for certified error rates; G. Gao et al., PRELUDE/CIPHER, NeurIPS (2024), arXiv:2404.15269, and PROSE, ICML (2025), arXiv:2505.23815, for learning from edits.
          </p>
        </Reveal>
      </section>

      {/* guardrails */}
      <section className="mx-auto max-w-[1240px] px-5 py-10">
        <Reveal>
          <div className="panel grid gap-6 p-6 lg:grid-cols-[minmax(0,34%)_minmax(0,66%)]">
            <div>
              <span className="grid h-9 w-9 place-items-center ctl bg-accent-soft text-accent"><Icon name="Shield" className="h-5 w-5" /></span>
              <h2 className="mt-3 text-[20px] font-semibold tracking-tight">Guardrails before autonomy</h2>
              <p className="mt-2 text-[12.5px] leading-relaxed text-muted">An email sent in your name cannot be taken back, so everything doubtful comes to you with the reason written down. Mailbox passwords and tokens are encrypted with AES-256-GCM; disconnecting deletes them.</p>
            </div>
            <ul className="grid gap-2.5 sm:grid-cols-2">
              {GUARDRAILS.map((g) => (
                <li key={g} className="flex gap-2 text-[12.5px] leading-relaxed"><Icon name="Check" className="mt-0.5 h-4 w-4 shrink-0 text-pos" /><span>{g}</span></li>
              ))}
            </ul>
          </div>
        </Reveal>
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
              {([["comps", "Trading comps"], ["ai", "AI with citations"], ["vc", "Startup directory"]] as const).map(([k, label]) => (
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
                    "Chooses tools, not vibes: XBRL facts, the comps engine, filing text, full-text search, Form D, the web.",
                    "Computes with an exact calculator so multiples and IRRs are not guessed.",
                    "Cites every figure with a source id you can click through to the filing.",
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
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Built for the long tail of dealmakers</h2>
          <p className="mt-2 max-w-[70ch] text-[22px] font-semibold leading-snug tracking-tight">Enterprise-grade analysis and follow-through, priced for the firms that cannot justify an enterprise seat.</p>
          <p className="mt-2 max-w-[90ch] text-[12px] text-muted">
            A general AI assistant will build a DCF for $20 a month, but not from verified data, and not the follow-through: on September 2026&apos;s Excel modelling benchmark, frontier models passed only 64% of numerical checks.<sup>1</sup> The platforms that bring the data sell annual contracts in the thousands to tens of thousands of dollars.<sup>2</sup> YouBank is cited, filing-backed work plus the agent that acts on it, for the teams in between.
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
          <p className="mt-8 text-[12.5px] font-semibold">Eight careers, each with its own researched toolkit</p>
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
          <p className="mt-2 text-[22px] font-semibold leading-snug tracking-tight">Free while in beta.</p>
          <p className="mt-2 max-w-[80ch] text-[12.5px] text-muted">These are the plans we intend to offer after the beta. Nothing is billed today, and beta accounts will be told well before anything changes.</p>
        </Reveal>
        <div className="mt-7 grid gap-3 md:grid-cols-2 lg:grid-cols-4">
          {PLANS.map((p, i) => (
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
      </section>

      {/* styles */}
      <section id="styles" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Make it yours</h2>
          <p className="mt-2 max-w-[62ch] text-[22px] font-semibold leading-snug tracking-tight">Fourteen styles, from amber-on-black terminal to soft daylight.</p>
          <p className="mt-2 max-w-[80ch] text-[12.5px] text-muted">Density, corner radius, glass and glow all change with the style, not just the colors. Try one now: this page will change with you.</p>
        </Reveal>
        <div className="mt-7"><ThemeShowcase /></div>
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
            <h2 className="relative text-[26px] font-semibold tracking-tight">Tell it what you do. It learns the rest.</h2>
            <p className="relative mx-auto mt-2 max-w-[62ch] text-[13px] text-muted">A two-minute survey sets your desk. Connect a mailbox when you are ready, and give the agent as much or as little autonomy as it has earned.</p>
            <div className="relative mt-6 flex justify-center"><SignInButton label="Continue with Google" /></div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-col gap-3 px-5 py-6 text-[11px] text-muted">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <span className="flex items-center gap-2"><LogoMark size={16} id="foot" /> YouBank</span>
            <span>Data: SEC EDGAR, Financial Modeling Prep, Y Combinator, a16z, Show HN, Wikipedia.</span>
            <span>Not investment advice. Figures are derived from public filings and may be restated.</span>
            <Link href="/sign-in" className="ml-auto hover:text-fg">Sign in →</Link>
          </div>
          <p className="text-[10.5px] leading-relaxed">
            <sup>1</sup> Vals AI, Excel Modeling Benchmark (LBO, DCF, M&amp;A and three-statement models), updated 22 September 2026, vals.ai/benchmarks/emb. Wall Street Prep&apos;s 2026 test of AI modelling tools reached a similar verdict: the best tool still underperformed a junior analyst.{" "}
            <sup>2</sup> Sacra&apos;s estimate for Rogo is about $3,300 per seat a year; Vendr buyer data put AlphaSense&apos;s median contract at $18,375 a year (February 2026). Retail research terminals publish $25–$120 a month (TIKR, Koyfin, September 2026).
          </p>
        </div>
      </footer>
    </main>
  );
}
