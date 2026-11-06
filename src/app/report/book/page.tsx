import { eq } from "drizzle-orm";
import Link from "next/link";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { PrintButton } from "@/components/book/PrintButton";
import { currentUser } from "@/lib/auth/user";
import { summarize, type Evaluation, type Position } from "@/lib/book/position";
import { evaluateBook, loadBook } from "@/lib/book/store";
import { headLine } from "@/lib/ledger/chain";
import { normalizeBookState, streakOf } from "@/lib/book/alerts";
import { filingLine } from "@/lib/book/filings";
import { ledgerHead } from "@/lib/ledger/store";
import { riskOf } from "@/lib/book/risk-store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Book report", robots: { index: false } };

const VERDICT: Record<Evaluation["verdict"], string> = { intact: "Intact", watch: "On watch", broken: "Broken", unknown: "No data" };
const TONE: Record<Evaluation["verdict"], string> = { intact: "text-pos", watch: "text-accent", broken: "text-neg", unknown: "text-muted" };
const pct = (x: number | null) => (x === null ? "n/a" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);
const nav = (x: number) => `${x.toFixed(x % 1 ? 1 : 0)}%`;
/** A red team's text, as plain prose for print: markdown marks and citations out, cut at a sentence. */
function gist(md: string, n = 700): string {
  const t = md.replace(/\[S\d+\]/g, "").replace(/[#*_`>|]/g, "").replace(/\n{2,}/g, "\n").replace(/[ \t]+/g, " ").trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(". ") + 1, n - 120))} …`;
}

/**
 * The Book as a document for an investment committee or an LP letter: exposure, then every position (most
 * urgent first) with its thesis, each kill criterion with the figure, its period and source, catalysts and
 * the red team's case, dated. Laid out for print (and "Save as PDF"); outside the app shell so nothing
 * else prints. Only the person's own book.
 */
export default async function BookReport() {
  const user = await currentUser();
  if (!user || !db) redirect("/sign-in");
  const now = new Date();
  const [book, profile, head] = await Promise.all([
    loadBook(user.id),
    db.select({ firmName: schema.profiles.firmName, name: schema.profiles.name, extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, user.id)).then((r) => r[0]),
    ledgerHead(user.id).catch(() => null),
  ]);
  // Risk is best effort: without prices (a feed down) the report still prints, without that section.
  const [evals, risk] = await Promise.all([evaluateBook(book, now), riskOf(book, now).catch(() => null)]);
  const s = summarize(evals);
  const byId = new Map<string, Position>(book.map((p) => [p.id, p]));
  const history = normalizeBookState((profile?.extra as Record<string, unknown> | undefined)?.bookState).history;
  const who = profile?.firmName || profile?.name || user.name || user.email;
  const date = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  return (
    <main className="min-h-dvh bg-bg text-fg print:bg-white print:text-black">
      <div className="mx-auto max-w-[900px] px-6 py-8 text-[12.5px] leading-relaxed print:max-w-none print:px-0 print:py-0">
        <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
          <Link href="/app/book" className="text-[12px] text-muted hover:text-fg">← Back to the Book</Link>
          <PrintButton />
        </div>
        <header className="border-b border-line pb-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Book review · {who}</div>
          <h1 className="mt-1 text-[22px] font-semibold">Positions and their theses</h1>
          <p className="text-muted">As of {date}, {now.toISOString().slice(11, 16)} UTC. Every kill criterion is checked against the company&apos;s SEC XBRL filings or the price feed named beside it.</p>
        </header>

        {!evals.length ? <p className="mt-6 text-muted">The book is empty.</p> : (
          <>
            <section className="mt-5 grid grid-cols-3 gap-3 sm:grid-cols-6 print:grid-cols-6" aria-label="Exposure">
              {[["Positions", String(s.positions)], ["Gross", nav(s.gross)], ["Net", nav(s.net)], ["Long / short", `${nav(s.long)} / ${nav(s.short)}`], ["At risk", nav(s.atRiskWeight)], ["P&L since entry", s.pnlContribution === null ? "n/a" : `${s.pnlContribution >= 0 ? "+" : ""}${s.pnlContribution.toFixed(2)}% NAV`]].map(([k, v]) => (
                <div key={k}><div className="text-[10px] uppercase tracking-wider text-muted">{k}</div><div className="num text-[15px] font-semibold">{v}</div></div>
              ))}
            </section>
            <p className="mt-2 text-[11.5px] text-muted">{s.verdicts.broken} broken · {s.verdicts.watch} on watch · {s.verdicts.intact} intact{s.verdicts.unknown ? ` · ${s.verdicts.unknown} without data` : ""}. Weights are % of NAV as entered; &ldquo;at risk&rdquo; is the weight in positions whose thesis is broken or on watch.</p>

            {s.byIndustry.filter((x) => x.gross > 0).length > 1 && (
              <p className="mt-2 text-[11.5px] text-muted">By industry (% of NAV): {s.byIndustry.filter((x) => x.gross > 0).map((x) => `${x.industry} ${x.long ? `+${nav(x.long)}` : ""}${x.short ? ` −${nav(x.short)}` : ""} (net ${nav(x.net)})`).join(" · ")}.</p>
            )}
            {risk && risk.betaNet !== null && (
              <section className="mt-4 break-inside-avoid-page" aria-label="Risk">
                <h2 className="text-[10px] uppercase tracking-wider text-muted">Risk (historical, today&apos;s weights, % of NAV)</h2>
                <p className="mt-0.5">Beta-adjusted net {risk.betaNet >= 0 ? "+" : ""}{risk.betaNet.toFixed(1)}% · volatility {risk.vol?.toFixed(1)}% a year · one-day 95% VaR {risk.var95?.toFixed(2)}% · expected shortfall {risk.es95?.toFixed(2)}%. {(() => { const x = risk.shocks.find((y) => y.move === -10)?.pnl ?? 0; return `By beta, an S&P 500 fall of 10% ${x < 0 ? "costs" : x > 0 ? "gains" : "changes"} about ${Math.abs(x).toFixed(2)}% of NAV.`; })()}</p>
                <p className="mt-0.5 text-muted">Replays: {risk.scenarios.map((x) => `${x.label} ${x.pnl === null ? "n/a" : `${x.pnl >= 0 ? "+" : ""}${x.pnl.toFixed(2)}%`}${x.market !== null ? ` (S&P ${x.market >= 0 ? "+" : ""}${x.market.toFixed(1)}%)` : ""}${x.missing.length ? `, without ${x.missing.join(", ")}` : ""}`).join(" · ")}.</p>
                {risk.pairs.some((x) => x.kind === "stacked") && <p className="mt-0.5 text-muted">Moving together: {risk.pairs.filter((x) => x.kind === "stacked").map((x) => `${x.a} and ${x.b} (correlation ${x.rho.toFixed(2)}, ${nav(x.weight)} of NAV)`).join("; ")}.</p>}
                <p className="mt-0.5 text-[10.5px] text-muted">{risk.window ? `Daily closes ${risk.window.from} to ${risk.window.to}` : "Daily closes"}{risk.sources.length ? ` (${risk.sources.join(", ")})` : ""}; benchmark SPY.{risk.excluded.length ? ` Left out: ${risk.excluded.map((x) => `${x.ticker} (${x.reason})`).join(", ")}.` : ""}</p>
              </section>
            )}
            <div className="mt-4 overflow-x-auto print:overflow-visible"><table className="w-full min-w-[520px] border-collapse text-[11.5px] [&_td]:pr-3 [&_th]:pr-3">
              <thead><tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-1">Position</th><th>Side</th><th className="text-right">Weight</th><th className="text-right">Price</th><th className="text-right">Since entry</th><th className="pl-3">Thesis</th></tr></thead>
              <tbody>{evals.map((e) => (
                <tr key={e.positionId} className="border-b border-line/50 align-top">
                  <td className="py-1 font-semibold">{e.ticker}</td><td className="capitalize">{e.direction}</td>
                  <td className="num text-right">{e.weight !== null ? nav(e.weight) : "—"}</td><td className="num text-right">{e.price !== null ? `$${e.price.toFixed(2)}` : "—"}</td>
                  <td className="num text-right">{pct(e.pnl)}</td><td className={`pl-3 font-semibold ${TONE[e.verdict]}`}>{VERDICT[e.verdict]}</td>
                </tr>
              ))}</tbody>
            </table></div>

            {evals.map((e) => {
              const p = byId.get(e.positionId);
              return (
                <section key={e.positionId} className="mt-6 break-inside-avoid-page border-t border-line pt-4">
                  <div className="flex flex-wrap items-baseline gap-x-3">
                    <h2 className="text-[15px] font-semibold">{e.ticker} <span className="font-normal text-muted">{e.name}</span></h2>
                    <span className="text-muted">{e.direction === "long" ? "Long" : "Short"}{e.weight !== null ? `, ${nav(e.weight)} of NAV` : ""}{p?.entry ? `, entry $${p.entry}` : ""}</span>
                    <span className={`ml-auto font-semibold ${TONE[e.verdict]}`}>{VERDICT[e.verdict]}{e.score !== null ? ` · ${e.score}/100` : ""}{(() => { const st = streakOf(history[e.positionId] ?? [], now); return st && st.verdict === e.verdict && st.days > 0 ? ` · since ${st.since}` : ""; })()}</span>
                  </div>
                  <p className="mt-1 text-[13px]">{p?.thesis}</p>
                  {!!p?.pillars.length && <ul className="mt-1 list-disc pl-5 text-muted">{p.pillars.map((x) => <li key={x}>{x}</li>)}</ul>}
                  <p className="mt-1.5 italic text-muted">{e.summary}</p>
                  {e.checks.length > 0 && (
                    <div className="mt-2 overflow-x-auto print:overflow-visible"><table className="w-full min-w-[560px] border-collapse text-[11px]">
                      <thead><tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-0.5">Kill criterion</th><th>Now</th><th>Needs</th><th>Room</th><th>State</th><th>Source</th></tr></thead>
                      <tbody>{e.checks.map((c) => (
                        <tr key={c.criterion.id} className="border-b border-line/40 align-top">
                          <td className="py-0.5 pr-2">{c.label}</td><td className="num pr-2">{c.shown}</td><td className="pr-2">{c.target}</td><td className="num pr-2">{c.headroom?.shown ?? "—"}</td>
                          <td className={`pr-2 font-semibold ${c.state === "fail" ? "text-neg" : c.state === "near" ? "text-accent" : c.state === "pass" ? "text-pos" : "text-muted"}`}>{c.state === "pass" ? "holds" : c.state === "near" ? "close" : c.state === "fail" ? "failed" : "no data"}</td>
                          <td className="text-muted">{c.evidence ? <><a href={c.evidence.url} className="underline decoration-dotted">{c.evidence.source}</a>, {c.evidence.period}</> : "—"}</td>
                        </tr>
                      ))}</tbody>
                    </table></div>
                  )}
                  {e.filing && <p className="mt-1.5"><span className="text-muted">New {e.filing.form} ({e.filing.filed}):</span> {filingLine(e.filing)}</p>}
                  {!!e.nextPrint?.length && <p className="mt-1.5"><span className="text-muted">Next report must show:</span> {e.nextPrint.map((b) => b.line).join(" ")}</p>}
                  {(e.catalysts.length > 0 || e.earnings) && <p className="mt-1.5"><span className="text-muted">Catalysts:</span> {[...(e.earnings ? [`Earnings${e.earnings.estimated ? " (estimated)" : ""} (${e.earnings.date})`] : []), ...e.catalysts.map((c) => `${c.label} (${c.date})`)].join("; ")}</p>}
                  {p?.redTeam && (
                    <div className="mt-2 border-l-2 border-line pl-3">
                      <div className="text-[10px] uppercase tracking-wider text-muted">The case against (red team, {p.redTeam.at.slice(0, 10)})</div>
                      <p className="whitespace-pre-line text-[11.5px]">{gist(p.redTeam.text)}</p>
                    </div>
                  )}
                </section>
              );
            })}
          </>
        )}

        <footer className="mt-8 border-t border-line pt-3 text-[10.5px] text-muted">
          <p>Fundamentals: SEC XBRL company facts, last twelve months to the period shown. Prices: the feed named beside each figure, at the time shown; a stale price is marked. Generated by YouBank on {now.toISOString().slice(0, 16).replace("T", " ")} UTC. For internal discussion; not investment advice.</p>
          {head && <p className="num mt-1 break-all">Research ledger head: {headLine(user.email, head)}</p>}
        </footer>
      </div>
    </main>
  );
}
