"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWorkspace } from "./WorkspaceProvider";
import { ROLES } from "@/lib/roles";
import { toolsFor } from "@/lib/workflows/registry";
import { ToolCard } from "@/components/workflows/ToolsGallery";
import { useCompanies } from "@/lib/client/companies";
import { Sparkline } from "@/components/charts/Sparkline";
import { Icon } from "@/components/ui/Icon";
import { Reveal } from "@/components/motion/Reveal";
import { derive, fmtMoney, fmtPct, fmtX } from "@/lib/metrics";

type Run = { id: number; toolId: string; title: string; model: string; status: string; createdAt: string; durationMs: number };

const greeting = () => { const h = new Date().getHours(); return h < 5 ? "Late night" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening"; };

export function HomeDashboard({ facts }: { facts: { directoryTotal: number | null; sheets: number; groups: number } }) {
  const { profile, config } = useWorkspace();
  const tools = toolsFor(profile);
  const [runs, setRuns] = useState<Run[] | null>(null);
  const { data, loading } = useCompanies(config.watchlist);
  const rows = config.watchlist.map((t) => data[t]).filter(Boolean);
  const movers = [...rows].sort((a, b) => Math.abs(b.price?.changePct ?? 0) - Math.abs(a.price?.changePct ?? 0)).slice(0, 6);
  const first = config.watchlist[0] ?? "SNOW";

  useEffect(() => { fetch("/api/tools/runs?limit=6").then((r) => r.json()).then((r) => setRuns(Array.isArray(r) ? r : [])).catch(() => setRuns([])); }, []);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1280px] px-5 py-6">
        <Reveal>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-semibold tracking-tight">{greeting()}{profile.name ? `, ${profile.name.split(" ")[0]}` : ""}.</h1>
              <p className="mt-1 text-[12.5px] text-muted">{ROLES[profile.role].label}{profile.specialty ? ` · ${profile.specialty}` : ""}{profile.firmName ? ` · ${profile.firmName}` : ""}{profile.seniority ? ` · ${profile.seniority}` : ""} · <Link href="/app/profile" className="hover:text-fg">change</Link></p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link href={`/app/terminal?ticker=${first}`} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-fg transition hover:brightness-110"><Icon name="Terminal" className="h-3.5 w-3.5" /> Open the terminal</Link>
              <Link href="/app/tools" className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12.5px] text-fg transition hover:border-accent/50 hover:text-accent"><Icon name="Wand2" className="h-3.5 w-3.5" /> {tools.length} tools</Link>
              <Link href={`/app/terminal?ticker=${first}&fn=AI`} className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12.5px] text-fg transition hover:border-accent/50 hover:text-accent"><Icon name="Sparkles" className="h-3.5 w-3.5" /> Ask the assistant</Link>
            </div>
          </div>
        </Reveal>

        <div className="mt-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="space-y-4">
            <Reveal>
              <section>
                <div className="mb-2 flex items-baseline justify-between"><h2 className="text-[11px] uppercase tracking-wider text-muted">Start here</h2><Link href="/app/tools" className="text-[11px] text-muted hover:text-fg">all tools →</Link></div>
                <div className="stagger grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {tools.slice(0, 6).map((t) => <ToolCard key={t.id} t={t} />)}
                </div>
              </section>
            </Reveal>

            <Reveal>
              <section className="panel p-3">
                <div className="mb-2 flex items-baseline justify-between">
                  <h2 className="text-[11px] uppercase tracking-wider text-muted">Your watchlist</h2>
                  <span className="text-[10.5px] text-muted">{loading && rows.length === 0 ? "loading from SEC and prices…" : `${rows.length} names · click to open`}</span>
                </div>
                <div className="overflow-auto">
                  <table className="w-full whitespace-nowrap text-[11.5px]">
                    <thead className="text-[10px] uppercase tracking-wider text-muted"><tr className="border-b border-line"><th className="py-1 text-left font-normal">Ticker</th><th className="py-1 pr-3 text-right font-normal">Price</th><th className="py-1 pr-3 text-right font-normal">Today</th><th className="py-1 pr-3 text-right font-normal">EV/Rev</th><th className="py-1 pr-3 text-right font-normal">Growth</th><th className="py-1 pr-3 text-right font-normal">FCF margin</th><th className="py-1 pr-1 text-right font-normal">Revenue trend</th></tr></thead>
                    <tbody>
                      {rows.map((c) => {
                        const d = derive(c);
                        const chg = c.price?.changePct ?? null;
                        return (
                          <tr key={c.ticker} className="border-b border-line/50 hover:bg-elevated/60">
                            <td className="py-1.5"><Link href={`/app/terminal?ticker=${c.ticker}`} className="num font-semibold hover:text-accent">{c.ticker}</Link> <span className="hidden max-w-[150px] truncate text-[10.5px] text-muted xl:inline">{c.name.replace(/,? (Inc|Corp|Holdings|plc)\.?$/i, "")}</span></td>
                            <td className="num py-1.5 pr-3 text-right">{c.price ? c.price.last.toFixed(2) : "—"}</td>
                            <td className={`num py-1.5 pr-3 text-right ${chg === null ? "" : chg >= 0 ? "text-pos" : "text-neg"}`}>{chg === null ? "—" : `${chg >= 0 ? "+" : ""}${chg.toFixed(2)}%`}</td>
                            <td className="num py-1.5 pr-3 text-right">{fmtX(d.evRevLtm)}</td>
                            <td className="num py-1.5 pr-3 text-right">{fmtPct(d.revenueGrowth)}</td>
                            <td className="num py-1.5 pr-3 text-right">{fmtPct(d.fcfMargin)}</td>
                            <td className="py-1 pr-1 text-right">{c.quarters.length > 1 && <span className="inline-block"><Sparkline values={c.quarters.map((q) => q.revenue)} width={60} height={16} stroke="var(--chart-1)" /></span>}</td>
                          </tr>
                        );
                      })}
                      {rows.length === 0 && Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={7} className="py-1"><span className="shimmer block h-4 ctl" /></td></tr>)}
                    </tbody>
                  </table>
                </div>
              </section>
            </Reveal>

            {movers.length > 0 && (
              <Reveal>
                <section>
                  <h2 className="mb-2 text-[11px] uppercase tracking-wider text-muted">Movers worth a look</h2>
                  <div className="stagger grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {movers.slice(0, 3).map((c) => {
                      const d = derive(c);
                      const chg = c.price?.changePct ?? 0;
                      return (
                        <Link key={c.ticker} href={`/app/terminal?ticker=${c.ticker}&fn=DES`} className="lift panel p-3">
                          <div className="flex items-baseline justify-between"><span className="num text-[13px] font-semibold">{c.ticker}</span><span className={`num text-[11.5px] ${chg >= 0 ? "text-pos" : "text-neg"}`}>{chg >= 0 ? "▲" : "▼"} {Math.abs(chg).toFixed(2)}%</span></div>
                          <div className="mt-0.5 truncate text-[11px] text-muted">{c.name}</div>
                          <div className="num mt-2 flex items-baseline gap-3 text-[11px]"><span>EV {d.ev !== null ? `$${fmtMoney(d.ev)}` : "n/a"}</span><span className="text-muted">{fmtX(d.evRevLtm)} rev</span></div>
                        </Link>
                      );
                    })}
                  </div>
                </section>
              </Reveal>
            )}
          </div>

          <div className="space-y-4">
            <Reveal delay={60}>
              <section className="panel p-3">
                <h2 className="mb-2 text-[11px] uppercase tracking-wider text-muted">Ask the assistant</h2>
                <div className="space-y-1.5">
                  {config.suggestedPrompts(first).map((p) => (
                    <Link key={p} href={`/app/terminal?ticker=${first}&fn=AI`} className="block ctl border border-line px-2.5 py-1.5 text-[11.5px] text-fg/90 transition hover:border-accent/50 hover:text-accent">{p}</Link>
                  ))}
                </div>
              </section>
            </Reveal>

            <Reveal delay={100}>
              <section className="panel p-3">
                <div className="mb-2 flex items-baseline justify-between"><h2 className="text-[11px] uppercase tracking-wider text-muted">Recent runs</h2><Link href="/app/library" className="text-[11px] text-muted hover:text-fg">library →</Link></div>
                {runs === null && <div className="shimmer h-16 ctl" />}
                {runs?.length === 0 && <div className="text-[11.5px] text-muted">Nothing yet. Runs and calculator results you save land here with their sources.</div>}
                <ul className="space-y-1">
                  {runs?.map((r) => (
                    <li key={r.id}>
                      <Link href={`/app/tools/${r.toolId}?run=${r.id}`} className="flex items-baseline gap-2 ctl px-1.5 py-1 text-[11.5px] hover:bg-elevated">
                        <span className="min-w-0 flex-1 truncate">{r.title || r.toolId}</span>
                        <span className="num shrink-0 text-[10px] text-muted">{new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            </Reveal>

            {(profile.role === "vc" || profile.role === "pe") && (
              <Reveal delay={140}>
                <Link href="/app/vc" className="lift block panel p-3">
                  <div className="flex items-center gap-2"><Icon name="Rocket" className="h-4 w-4 text-accent" /><h2 className="text-[12.5px] font-semibold">Private markets</h2></div>
                  <p className="mt-1.5 text-[11.5px] text-muted">{facts.directoryTotal ? `${facts.directoryTotal.toLocaleString()} startups` : "The startup directory"} across Y Combinator, a16z, Thiel Fellows, Show HN, SEC Form D and web discovery, plus every private raise filed this month.</p>
                  <span className="mt-2 inline-block text-[11.5px] text-accent">Open the directory →</span>
                </Link>
              </Reveal>
            )}

            <Reveal delay={180}>
              <section className="panel p-3 text-[11.5px]">
                <h2 className="mb-2 text-[11px] uppercase tracking-wider text-muted">Your saved work</h2>
                <dl className="space-y-1">
                  <div className="flex justify-between"><dt className="text-muted">Comps sheets</dt><dd className="num">{facts.sheets}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted">Peer groups</dt><dd className="num">{facts.groups}</dd></div>
                </dl>
                <div className="mt-2 border-t border-line pt-2 text-[10.5px] text-muted">Fundamentals refresh every six hours; prices on every load. Nightly jobs re-sync the startup directory and new Form D filings.</div>
              </section>
            </Reveal>
          </div>
        </div>
      </div>
    </div>
  );
}
