"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ROLES, ROLE_IDS, type RoleId } from "@/lib/roles";
import { SignInButton } from "./SignInButton";
import { DemoTerminal } from "./DemoTerminal";
import { DemoAi } from "./DemoAi";
import { Reveal } from "@/components/motion/Reveal";
import { Icon } from "@/components/ui/Icon";
import { ThemeMenu } from "@/components/theme/ThemeMenu";
import { Logo } from "@/components/brand/Logo";

export type ToolSummary = { id: string; title: string; tagline: string; kind: "ai" | "calc"; category: string; icon: string; specialties: string[] | null; savesMinutes: number | null };

/** Research-backed detail shown per role: what the day looks like and what the tools replace. */
const DETAIL: Record<RoleId, { day: { level: string; work: string }[]; replaces: string[]; data: string[] }> = {
  banker: {
    day: [
      { level: "Analyst", work: "Comps and precedents, page turns on the pitch book, profile pages, weekly market update, data-room and diligence trackers, model mechanics." },
      { level: "Associate", work: "Owns the model: merger consequences, LBO, sum-of-parts. Reviews the analyst's pages, drafts the CIM and management presentation, runs the process letters." },
      { level: "VP and above", work: "Storyline and positioning, buyer lists and ability-to-pay, fairness materials, negotiation support, client conversations." },
    ],
    replaces: [
      "A comps sheet built by hand from a data terminal, then footnoted by hand",
      "Hunting precedent transactions and their multiples through merger proxies one by one",
      "Reading a debt footnote and a credit agreement to rebuild a capital structure",
      "Assembling the weekly sector update and the earnings-day comps refresh",
      "Writing the first draft of the profile page, the CIM section, the lender presentation",
    ],
    data: ["SEC XBRL fundamentals with the filer's own concepts", "DEFM14A, S-4, SC TO-T and 8-K merger disclosure via full-text search", "Credit agreements and indentures as EX-10 and EX-4 exhibits", "Form 4 insider activity and 13D positions", "Live prices, market caps and 52-week ranges"],
  },
  pe: {
    day: [
      { level: "Associate", work: "Screens the funnel, reads CIMs, builds the LBO, coordinates quality-of-earnings, drafts the IC memo, tracks portfolio KPIs." },
      { level: "VP / Principal", work: "Owns diligence workstreams and the lender process, negotiates the SPA schedule of exceptions, runs the 100-day plan with management." },
      { level: "Partner", work: "Originates, prices, and decides. Needs the one-page version with the downside quantified." },
    ],
    replaces: [
      "First-read memos from a CIM, with the red flags already listed",
      "LBO returns with attribution across EBITDA growth, multiple expansion and deleveraging",
      "Add-back testing against a defensible allowed-versus-disallowed taxonomy",
      "Net working capital peg from monthly balances, with the seasonality visible",
      "Take-private precedents with premiums and sponsor names pulled from proxies",
    ],
    data: ["Public comps as the pricing anchor for private targets", "DEFM14A and SC 13E-3 take-private terms", "Covenant and leverage data from credit agreements", "Your own CIM excerpts, QoE databooks and portfolio KPI exports"],
  },
  vc: {
    day: [
      { level: "Analyst / Associate", work: "Sourcing lists, first calls, market maps, memo drafts, portfolio data collection. Triages hundreds of decks a month." },
      { level: "Principal", work: "Owns theses and diligence: customer calls, cohort and unit economics, competitive mapping, term-sheet mechanics." },
      { level: "Partner / GP", work: "Decides, negotiates, supports founders, and answers to LPs with DPI and TVPI." },
    ],
    replaces: [
      "Building a market map by hand across YC, a16z, Product Hunt and LinkedIn",
      "Checking whether a company has actually raised, and from whom",
      "Cap table and dilution math in a spreadsheet that breaks on the next SAFE",
      "Exit waterfalls with stacked preferences and participation caps",
      "Writing the cold email that a founder will actually answer",
    ],
    data: ["18,001 startups from YC, a16z, Thiel Fellows, Show HN, Form D and web discovery", "SEC Form D raises with amounts, dates and named officers", "Recent IPO comps as the late-stage valuation anchor", "Web research with citations for anything private"],
  },
  markets: {
    day: [
      { level: "Associate / Analyst", work: "Maintains the model, writes the earnings preview and recap, tracks the catalyst calendar, does the channel work." },
      { level: "Senior analyst", work: "Owns the thesis and the variant view, sizes the position, defends it in the morning meeting." },
      { level: "PM / CIO", work: "Risk, exposure and sizing across the book. Wants the downside case first." },
    ],
    replaces: [
      "Rebuilding the quarterly model from the 10-Q every three months",
      "Reading the merger agreement to price an arb spread and its outside date",
      "Tracking insider buys, 13D filings and short interest across a watchlist",
      "Mapping a capital structure and comparing relative value across tranches",
      "Writing the position note in the format your PM expects",
    ],
    data: ["XBRL quarterly series for any concept the filer tags", "8-K item codes including 1.03 bankruptcy, 2.04 acceleration, 4.02 non-reliance", "Form 4 insider transactions parsed to the line", "Merger agreements, proxies and indentures as exhibits"],
  },
  corpfin: {
    day: [
      { level: "Analyst / Senior analyst", work: "Budget versus actual, the variance pack, the reforecast, the board slides, the cash forecast." },
      { level: "Manager / Director", work: "Owns the driver model and the planning calendar, the covenant certificate, the hedge program, the target screen." },
      { level: "VP / CFO", work: "Capital allocation, guidance, the earnings call, and the board's questions." },
    ],
    replaces: [
      "Benchmarking against peers by opening ten 10-Qs",
      "Writing variance commentary that reconciles price, volume and mix exactly",
      "Rolling the 13-week cash forecast and explaining last week's miss",
      "Prepping the earnings Q&A by reading what peers were asked",
      "Recomputing the covenant certificate from the credit agreement definition",
    ],
    data: ["Peer XBRL facts for margins, working capital and leverage", "Guidance language from 8-K Item 2.02 and the 10-Q", "Your GL, budget and treasury exports, pasted or uploaded", "13F and 13D holdings for shareholder analysis"],
  },
  consultant: {
    day: [
      { level: "Analyst / Consultant", work: "Research, expert calls, the market model, the competitor profiles, the exhibits." },
      { level: "Engagement manager", work: "Owns the storyline and the workplan, the client-ready deck, the tie-outs." },
      { level: "Partner", work: "Sells the work, tests the logic, presents to the steering committee." },
    ],
    replaces: [
      "Sizing a market twice and reconciling top-down against bottom-up",
      "Profiling six competitors from their filings for a Monday deck",
      "Testing an EBITDA add-back list against precedent treatment",
      "Building the 13-week cash flow for a turnaround's first week",
      "Ghost-decking a storyline with action titles and the evidence needed per slide",
    ],
    data: ["SEC filings for competitor economics, segments and strategy", "XBRL benchmarks for SG&A, R&D and margin structure", "Government and industry statistics for sizing anchors", "Your interview notes, survey exports and client data"],
  },
  accountant: {
    day: [
      { level: "Staff / Senior", work: "Workpapers, tie-outs, sampling, confirmations, journal-entry testing, flux commentary, the provision schedules." },
      { level: "Manager", work: "Risk assessment, technical memos, the disclosure checklist, review notes, client conversations." },
      { level: "Partner / Director", work: "Signs off. Wants the judgment documented and benchmarked against practice." },
    ],
    replaces: [
      "Writing an ASC 606 or 842 memo from scratch with the codification open",
      "Benchmarking a disclosure by reading peer 10-Ks side by side",
      "Searching for SEC comment letters on a topic and summarizing the staff's view",
      "Materiality and sampling computations in a spreadsheet template",
      "Journal-entry testing rules run by hand over an export",
    ],
    data: ["XBRL facts and footnote text for every registrant", "SEC comment letters (UPLOAD and CORRESP) by topic", "Critical audit matters across a peer set", "Your trial balance, JE population and bank data"],
  },
  student: {
    day: [
      { level: "Sophomore / Junior", work: "Coffee chats, resume, technicals, a stock pitch, and a recruiting calendar that starts earlier every year." },
      { level: "Senior / MBA", work: "Superdays, case interviews, modeling tests, and on-cycle private equity processes that move in days." },
    ],
    replaces: [
      "Guessing at technical answers from a PDF of 400 questions",
      "Building a stock pitch with no data source",
      "Practicing a paper LBO with no one to grade it",
      "Tracking deadlines and networking follow-ups in a spreadsheet",
    ],
    data: ["Real filings and real prices to learn on", "Recent public deals to walk through in interviews", "Recruiting timelines by track", "Model answers graded against the standard"],
  },
};

export function RolePage({ role, tools }: { role: RoleId; tools: ToolSummary[] }) {
  const r = ROLES[role];
  const d = DETAIL[role];
  const [spec, setSpec] = useState<string>("");
  const filtered = useMemo(() => (spec ? tools.filter((t) => t.specialties?.includes(spec)) : tools), [tools, spec]);
  const byCategory = useMemo(() => {
    const m = new Map<string, ToolSummary[]>();
    for (const t of filtered) m.set(t.category, [...(m.get(t.category) ?? []), t]);
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length);
  }, [filtered]);
  const minutes = tools.reduce((a, t) => a + (t.savesMinutes ?? 0), 0);

  return (
    <main className="overflow-x-hidden">
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="drift absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full opacity-[0.14]" style={{ background: "radial-gradient(circle, var(--accent), transparent 65%)" }} />
        <div className="grid-bg absolute inset-0" />
      </div>

      <header className="glass sticky top-0 z-40 border-b border-line bg-bg/80">
        <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-5 py-3">
          <Link href="/" className="flex items-center gap-2"><Logo size={26} id="role-lock" /></Link>
          <nav className="ml-3 hidden items-center gap-1 overflow-x-auto text-[12px] md:flex">
            {ROLE_IDS.map((id) => (
              <Link key={id} href={`/for/${id}`} className={`ctl px-2 py-1 ${id === role ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{ROLES[id].short}</Link>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2"><ThemeMenu /><Link href="/sign-in" className="ctl border border-line px-3 py-1.5 text-[12.5px] text-muted hover:border-accent/50 hover:text-fg">Sign in</Link></div>
        </div>
      </header>

      <section className="mx-auto max-w-[1240px] px-5 pb-8 pt-12">
        <div className="grid items-start gap-10 lg:grid-cols-[minmax(0,48%)_minmax(0,52%)]">
          <div>
            <Reveal><span className="text-[11px] uppercase tracking-[0.2em] text-accent">For {r.label.toLowerCase()}s</span></Reveal>
            <Reveal delay={60}><h1 className="mt-3 text-[34px] font-semibold leading-[1.08] tracking-tight sm:text-[40px]">{r.blurb}</h1></Reveal>
            <Reveal delay={120}><p className="mt-4 max-w-[58ch] text-[14px] leading-relaxed text-muted">{r.pitch}</p></Reveal>
            <Reveal delay={180}>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <SignInButton label={`Start as ${r.label.toLowerCase()}`} />
                <Link href="/" className="ctl border border-line px-4 py-2.5 text-[13px] text-muted hover:border-accent/50 hover:text-fg">All roles</Link>
              </div>
            </Reveal>
            <Reveal delay={240}>
              <dl className="mt-7 grid grid-cols-3 gap-4 border-t border-line pt-5 text-center sm:text-left">
                <div><dt className="num text-[20px] font-semibold text-accent">{tools.length}</dt><dd className="text-[11px] text-muted">tools for this seat</dd></div>
                <div><dt className="num text-[20px] font-semibold text-accent">{r.specialties.length}</dt><dd className="text-[11px] text-muted">specialties covered</dd></div>
                <div><dt className="num text-[20px] font-semibold text-accent">{Math.round(minutes / 60)}h</dt><dd className="text-[11px] text-muted">of analyst time per full pass</dd></div>
              </dl>
            </Reveal>
          </div>
          <Reveal delay={120}>{role === "vc" || role === "student" ? <DemoAi height={420} /> : <DemoTerminal />}</Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-5 py-12">
        <div className="grid gap-8 lg:grid-cols-2">
          <Reveal>
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">The day, by level</h2>
            <div className="mt-4 space-y-3">
              {d.day.map((x) => (
                <div key={x.level} className="border-t border-line pt-3">
                  <div className="text-[12.5px] font-semibold">{x.level}</div>
                  <p className="mt-1 text-[12px] leading-relaxed text-muted">{x.work}</p>
                </div>
              ))}
            </div>
          </Reveal>
          <Reveal delay={80}>
            <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">What it takes off your plate</h2>
            <ul className="mt-4 space-y-2">
              {d.replaces.map((x) => (
                <li key={x} className="flex gap-2 text-[12.5px] leading-relaxed"><Icon name="Check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pos" /><span>{x}</span></li>
              ))}
            </ul>
            <h3 className="mt-6 text-[11px] uppercase tracking-wider text-muted">Data behind it</h3>
            <ul className="mt-2 space-y-1">
              {d.data.map((x) => <li key={x} className="flex gap-2 text-[11.5px] text-muted"><span className="text-accent">•</span><span>{x}</span></li>)}
            </ul>
          </Reveal>
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-5 py-12">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h2 className="text-[13px] font-semibold uppercase tracking-[0.18em] text-accent">The toolkit</h2>
              <p className="mt-2 text-[20px] font-semibold tracking-tight">{filtered.length} tools{spec ? ` for ${spec}` : ` for ${r.label.toLowerCase()}s`}</p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={() => setSpec("")} className={`rounded-full border px-2.5 py-0.5 text-[11px] ${!spec ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>All</button>
              {r.specialties.map((s) => {
                const n = tools.filter((t) => t.specialties?.includes(s)).length;
                return <button key={s} type="button" onClick={() => setSpec(spec === s ? "" : s)} disabled={n === 0} className={`rounded-full border px-2.5 py-0.5 text-[11px] disabled:opacity-40 ${spec === s ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{s}{n ? <span className="num ml-1 opacity-60">{n}</span> : null}</button>;
              })}
            </div>
          </div>
        </Reveal>
        <div className="mt-6 space-y-6">
          {byCategory.map(([cat, list], ci) => (
            <Reveal key={cat} delay={Math.min(ci, 5) * 50}>
              <div>
                <div className="mb-2 flex items-baseline gap-2"><h3 className="text-[12.5px] font-semibold">{cat}</h3><span className="num text-[10.5px] text-muted">{list.length}</span></div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {list.map((t) => (
                    <div key={t.id} className="lift panel flex items-start gap-2.5 p-3">
                      <span className={`grid h-7 w-7 shrink-0 place-items-center ctl ${t.kind === "ai" ? "bg-accent-soft text-accent" : "bg-info/10 text-info"}`}><Icon name={t.icon} className="h-3.5 w-3.5" /></span>
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-semibold leading-tight">{t.title}</div>
                        <div className="mt-0.5 text-[11px] leading-snug text-muted">{t.tagline}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          ))}
          {filtered.length === 0 && <div className="panel p-6 text-center text-[12px] text-muted">Tools for this specialty are on the way. Every role also gets the shared toolkit.</div>}
        </div>
      </section>

      <section className="mx-auto max-w-[1240px] px-5 pb-16 pt-4">
        <Reveal>
          <div className="glow panel p-8 text-center">
            <h2 className="text-[24px] font-semibold tracking-tight">Set up your {r.label.toLowerCase()} desk</h2>
            <p className="mx-auto mt-2 max-w-[56ch] text-[13px] text-muted">The survey asks your group, level and sectors, then wires the watchlists, function keys and tools to match.</p>
            <div className="mt-6 flex justify-center"><SignInButton label="Continue with Google" /></div>
          </div>
        </Reveal>
      </section>
    </main>
  );
}
