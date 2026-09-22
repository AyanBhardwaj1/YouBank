"use client";

import Link from "next/link";
import { useState } from "react";
import { ROLES, ROLE_IDS, type RoleId } from "@/lib/roles";
import { CATEGORIES } from "@/lib/workflows/categories";
import { DEMO } from "@/lib/demo";
import { SignInButton } from "./SignInButton";
import { DemoTerminal } from "./DemoTerminal";
import { DemoComps } from "./DemoComps";
import { DemoAi } from "./DemoAi";
import { DemoDirectory } from "./DemoDirectory";
import { ThemeShowcase } from "./ThemeShowcase";
import { Reveal, CountUp } from "@/components/motion/Reveal";
import { Icon } from "@/components/ui/Icon";
import { ThemeMenu } from "@/components/theme/ThemeMenu";
import { Logo, LogoMark } from "@/components/brand/Logo";

const ROLE_ICON: Record<RoleId, string> = { banker: "Landmark", pe: "Briefcase", vc: "Rocket", markets: "LineChart", corpfin: "Building2", consultant: "Compass", accountant: "Receipt", student: "GraduationCap" };

const PILLARS = [
  { icon: "Database", title: "The data layer, free and traceable", body: "Fundamentals parsed from SEC XBRL for every US registrant, last-twelve-months built the way an analyst builds it, filing text and exhibits searchable back to 2001, Form 4 insider activity, Form D private raises, and live prices. Every number on screen links to the filing it came from." },
  { icon: "Bot", title: "An assistant that does the work", body: "Not a chatbot bolted on. The model holds the same tools you do: pull financials, run comps, search filing text, read a merger agreement, compute with an exact calculator, research the web. It cites each figure and tells you when the data will not support the answer." },
  { icon: "Layout", title: "Your desk, your job", body: "Answer a short survey and the terminal rebuilds itself: the function keys, watchlists, panels, prompt library and tool shelf a restructuring banker needs are not the ones a Big 4 audit senior or a seed investor needs." },
];

const METHOD = [
  { k: "Fundamentals", v: "SEC XBRL company facts. LTM = fiscal year plus year-to-date less prior year-to-date, with the concept the filer actually used, restatements deduped by accession." },
  { k: "Filings", v: "EDGAR submissions and full-text search across every filing and exhibit since 2001: merger proxies, credit agreements, indentures, comment letters, 8-K item codes." },
  { k: "Private markets", v: "18,001 startups from Y Combinator, a16z, Thiel Fellows, Show HN, SEC Form D and AI web discovery, refreshed nightly." },
  { k: "Prices", v: "Live quotes, market cap and 52-week range from a market data API. Consensus estimates are not licensed, so NTM figures are entered by you and marked as manual." },
  { k: "Limits we state plainly", v: "Reported EBITDA is operating income plus D&A, not company-adjusted. Fiscal years are not calendarized. Filers who tag statements with custom extensions can have sparse facts. The assistant says so rather than guessing." },
];

const FAQ = [
  { q: "Is this a Bloomberg replacement?", a: "No. Bloomberg's edge is licensed real-time market data, chat and fixed-income depth. YouBank's edge is the free regulatory corpus plus an assistant that produces the deliverable: the comps sheet, the memo, the capital structure, the footnote, the outreach email. Free while in beta." },
  { q: "Where do the numbers come from?", a: "SEC EDGAR and a price API, with the source link on every figure. Anything from the web is cited. If a number is derived, the method is stated next to it." },
  { q: "Can I use my own AI model?", a: "Yes. The workspace ships on GPT-6 Astra and you can switch model and reasoning depth per run, including the GPT-5.6 family, o-series reasoning models and Claude if you add a key." },
  { q: "What happens to my work?", a: "Saved to your account: peer groups, comps sheets, manual estimates, workflow runs with their sources, and your style and model preferences." },
  { q: "Do you need my company's data?", a: "Only when you want it. Public-data tools work with nothing from you. The planning, audit and diligence tools accept a pasted CSV or an uploaded export, and that data is used for the run and stored with it in your account." },
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
          <Link href="/" className="flex items-center gap-2">
            <Logo size={26} />
          </Link>
          <nav className="ml-4 hidden items-center gap-4 text-[12.5px] text-muted md:flex">
            <a href="#product" className="hover:text-fg">Product</a>
            <a href="#demos" className="hover:text-fg">Demos</a>
            <a href="#roles" className="hover:text-fg">Roles</a>
            <a href="#styles" className="hover:text-fg">Styles</a>
            <a href="#data" className="hover:text-fg">Data</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <ThemeMenu />
            <Link href="/sign-in" className="ctl border border-line px-3 py-1.5 text-[12.5px] text-muted transition hover:border-accent/50 hover:text-fg">Sign in</Link>
          </div>
        </div>
      </header>

      {/* hero */}
      <section className="mx-auto max-w-[1240px] px-5 pb-8 pt-12 lg:pt-16">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,46%)_minmax(0,54%)]">
          <div>
            <Reveal>
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-panel px-3 py-1 text-[11px] text-muted">
                <span className="pulse-ring h-1.5 w-1.5 rounded-full bg-accent" /> Free in beta · {toolCounts.total} tools across 8 careers
              </span>
            </Reveal>
            <Reveal delay={60}>
              <h1 className="mt-4 text-[38px] font-semibold leading-[1.06] tracking-tight sm:text-[46px]">
                The terminal that <span className="gradient-text">does the analyst work</span>, tailored to your job.
              </h1>
            </Reveal>
            <Reveal delay={120}>
              <p className="mt-4 max-w-[56ch] text-[14.5px] leading-relaxed text-muted">
                YouBank reads the same filings you do, then produces the thing you were going to spend the night building: the comps sheet, the capital structure, the quality-of-earnings flags, the investment memo, the audit memo, the outreach email. Every figure cites its filing.
              </p>
            </Reveal>
            <Reveal delay={180}>
              <div className="mt-7 flex flex-wrap items-center gap-3">
                <SignInButton label="Start free with Google" />
                <a href="#demos" className="ctl border border-line px-4 py-2.5 text-[13px] font-semibold text-fg transition hover:border-accent/60 hover:text-accent">See it work</a>
              </div>
              <p className="mt-3 text-[11px] text-muted">No credit card. Your work saves to your account.</p>
            </Reveal>
            <Reveal delay={240}>
              <dl className="mt-8 grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line pt-6 sm:grid-cols-4">
                {[
                  { n: toolCounts.ai, l: "AI workflows" },
                  { n: toolCounts.calc, l: "exact calculators" },
                  { n: DEMO.directoryTotal, l: "startups indexed" },
                  { n: 14, l: "UI styles" },
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

      {/* pillars */}
      <section id="product" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal><h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">What it is</h2></Reveal>
        <Reveal delay={60}><p className="mt-3 max-w-[70ch] text-[22px] font-semibold leading-snug tracking-tight">A financial database, a workspace, and a copilot that can actually finish the deliverable.</p></Reveal>
        <div className="mt-8 grid gap-3 md:grid-cols-3">
          {PILLARS.map((p, i) => (
            <Reveal key={p.title} delay={i * 80}>
              <div className="lift h-full panel p-5">
                <span className="grid h-9 w-9 place-items-center ctl bg-accent-soft text-accent"><Icon name={p.icon} className="h-5 w-5" /></span>
                <h3 className="mt-3 text-[15px] font-semibold">{p.title}</h3>
                <p className="mt-2 text-[12.5px] leading-relaxed text-muted">{p.body}</p>
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
                <div className="mt-4 border-t border-line pt-3 text-[11.5px] text-muted">Model is yours to pick: GPT-6 Astra by default, the GPT-5.6 family, reasoning models, or Claude with your own key. Reasoning depth is a dial per run.</div>
              </div>
            </div>
          )}
          {demo === "vc" && <div className="rise"><DemoDirectory /></div>}
        </div>
      </section>

      {/* roles */}
      <section id="roles" className="mx-auto max-w-[1240px] scroll-mt-20 px-5 py-14">
        <Reveal>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">Built per career</h2>
          <p className="mt-2 max-w-[62ch] text-[22px] font-semibold leading-snug tracking-tight">Eight careers researched in depth, then turned into tools.</p>
          <p className="mt-2 max-w-[80ch] text-[12.5px] text-muted">
            We went through what each seat actually produces, at each level: the deliverables, the data, the formulas, the pain. A restructuring banker gets recovery waterfalls, liability-management capacity and DIP comps. An audit senior gets materiality, sampling, journal-entry tests and disclosure benchmarking. Pick your seat to see the list.
          </p>
        </Reveal>
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ROLE_IDS.map((id, i) => {
            const r = ROLES[id];
            return (
              <Reveal key={id} delay={(i % 4) * 70}>
                <Link href={`/for/${id}`} className="lift group flex h-full flex-col panel p-4">
                  <span className="flex items-center gap-2">
                    <span className="grid h-8 w-8 place-items-center ctl bg-accent-soft text-accent"><Icon name={ROLE_ICON[id]} className="h-4 w-4" /></span>
                    <span className="text-[14px] font-semibold">{r.label}</span>
                  </span>
                  <span className="mt-2 text-[12px] text-muted">{r.blurb}</span>
                  <ul className="mt-3 space-y-1 text-[11.5px] text-fg/85">
                    {r.jobs.slice(0, 3).map((j) => <li key={j} className="flex gap-1.5"><span className="text-accent">•</span><span>{j}</span></li>)}
                  </ul>
                  <span className="mt-auto pt-3 text-[11.5px] text-accent opacity-0 transition group-hover:opacity-100">See the toolkit →</span>
                </Link>
              </Reveal>
            );
          })}
        </div>
      </section>

      {/* tool categories */}
      <section className="mx-auto max-w-[1240px] px-5 py-8">
        <Reveal>
          <div className="panel p-5">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-[15px] font-semibold">{toolCounts.total} tools, two kinds</h3>
              <span className="text-[11.5px] text-muted">{toolCounts.ai} AI workflows that research and draft · {toolCounts.calc} calculators that compute exactly</span>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {CATEGORIES.map((c) => <span key={c} className="rounded-full border border-line px-2.5 py-0.5 text-[11px] text-muted">{c}</span>)}
            </div>
            <p className="mt-3 max-w-[85ch] text-[12px] leading-relaxed text-muted">
              Workflows stream their tool calls and return structured output: headline numbers, tables, bridges, sensitivity grids, risk registers, checklists, timelines, question banks, drafted emails. Calculators run in the browser as you type, prefilled from the company you are looking at, and save to your library with the inputs that produced them.
            </p>
          </div>
        </Reveal>
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
            <h2 className="relative text-[26px] font-semibold tracking-tight">Tell it what you do. Get your desk.</h2>
            <p className="relative mx-auto mt-2 max-w-[60ch] text-[13px] text-muted">A two-minute survey sets the watchlists, function keys, prompt library and tools for your seat. Change it any time.</p>
            <div className="relative mt-6 flex justify-center"><SignInButton label="Continue with Google" /></div>
          </div>
        </Reveal>
      </section>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-[11px] text-muted">
          <span className="flex items-center gap-2"><LogoMark size={16} id="foot" /> YouBank</span>
          <span>Data: SEC EDGAR, Financial Modeling Prep, Y Combinator, a16z, Show HN, Wikipedia.</span>
          <span>Not investment advice. Figures are derived from public filings and may be restated.</span>
          <Link href="/sign-in" className="ml-auto hover:text-fg">Sign in →</Link>
        </div>
      </footer>
    </main>
  );
}
