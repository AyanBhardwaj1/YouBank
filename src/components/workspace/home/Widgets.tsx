"use client";

/**
 * Home's widgets (src/lib/desk/desk.ts WIDGETS). Each is self-contained: it fetches what it shows, says so
 * plainly when there is nothing or it could not load, and takes a `roomy` flag for the Home layout's larger
 * type and spacing. HomeDashboard decides which are on and in what order.
 */
import Link from "next/link";
import { useEffect, useState } from "react";
import { useWorkspace } from "../WorkspaceProvider";
import { ToolCard } from "@/components/workflows/ToolCard";
import { useCompanies } from "@/lib/client/companies";
import { Sparkline } from "@/components/charts/Sparkline";
import { Icon } from "@/components/ui/Icon";
import { HomeBrief, type BriefSeed } from "@/components/news/HomeBrief";
import { derive, fmtMoney, fmtPct, fmtX } from "@/lib/metrics";
import { changeTone, fmtChange } from "@/lib/market/units";
import { NOTES_MAX, WIDGET_LABEL, type WidgetId } from "@/lib/desk/desk";
import { InboxWidget } from "./Inbox";
import { useNow } from "@/components/ui/useNow";
import { ChecklistWidget } from "./Checklist";
import { WatchlistEditor } from "./WatchlistEditor";
import { CalcWidget, MarketsWidget, RecentWidget } from "./MoreWidgets";

export type HomeFacts = { directoryTotal: number | null; sheets: number; groups: number };
type Props = { roomy?: boolean };

const H = ({ children, right, roomy }: { children: React.ReactNode; right?: React.ReactNode; roomy?: boolean }) => (
  <div className="mb-2 flex items-baseline justify-between gap-2">
    <h2 className={roomy ? "text-[14px] font-semibold text-fg" : "text-[11px] uppercase tracking-wider text-muted"}>{children}</h2>
    {right}
  </div>
);
const box = (roomy?: boolean) => (roomy ? "home-card p-5" : "panel p-3");

/* ---------------- Waiting for you: the desk inbox (./Inbox.tsx) ---------------- */

/* ---------------- Coming up (the next 24 hours) ---------------- */

type Meeting = { id: number; title: string; start: string; end: string; allDay: boolean; location: string; external?: boolean; videoUrl?: string; contacts?: { name: string; email: string }[]; deals?: { id: number; name: string }[]; attendees?: unknown[] };
/** A meeting link that is safe to open: http(s) only. */
const joinable = (u?: string) => (u && /^https:\/\/[^\s]+$/i.test(u) ? u : null);
export function AgendaWidget({ roomy }: Props) {
  const [m, setM] = useState<Meeting[] | null>(null);
  // The clock for "Join now" (from 15 minutes before until the end), refreshed every 30 s.
  const now = useNow();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    // Meetings under way too (Join matters most then), and again every five minutes while Home is open.
    const load = () => fetch("/api/calendar/upcoming?hours=24&limit=8&ongoing=1").then((r) => (r.ok ? r.json() : Promise.reject())).then((d: { meetings?: Meeting[] }) => { setM(d.meetings ?? []); setFailed(false); }).catch(() => setFailed(true));
    void load();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void load(); }, 300_000);
    return () => window.clearInterval(id);
  }, []);
  const time = (iso: string) => {
    const d = new Date(iso);
    const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return d.toDateString() === new Date().toDateString() ? t : `${d.toLocaleDateString("en-US", { weekday: "short" })} ${t}`;
  };
  return (
    <section className={box(roomy)}>
      <H roomy={roomy} right={<Link href="/app/calendar" className="text-[11px] text-muted hover:text-fg">calendar →</Link>}>{WIDGET_LABEL.agenda}</H>
      {!m && !failed && <div className="shimmer h-12 ctl" />}
      {(failed || m?.length === 0) && (
        <p className={`${roomy ? "text-[13px]" : "text-[11.5px]"} text-muted`}>
          {failed ? "Your calendar could not be read just now." : "Nothing in the next 24 hours."} <Link href="/app/calendar" className="text-fg hover:text-accent">Connect or open your calendar</Link>.
        </p>
      )}
      <ul className="space-y-1">
        {m?.map((x) => (
          <li key={x.id}>
            <Link href="/app/calendar?view=day" className={`flex items-baseline gap-3 ctl px-2 py-1.5 hover:bg-elevated ${roomy ? "text-[13px]" : "text-[12px]"}`}>
              <span className="num w-[5.5rem] shrink-0 text-muted">{x.allDay ? "all day" : time(x.start)}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate">{x.title || "Untitled"}</span>
                {(x.contacts?.length || x.deals?.length) ? (
                  <span className="block truncate text-[11px] text-muted">
                    {x.contacts?.length ? `with ${x.contacts[0].name || x.contacts[0].email}${x.contacts.length > 1 ? ` +${x.contacts.length - 1}` : ""}` : ""}
                    {x.contacts?.length && x.deals?.length ? " · " : ""}
                    {x.deals?.length ? x.deals.map((d) => d.name).slice(0, 2).join(", ") : ""}
                  </span>
                ) : null}
              </span>
              {x.external && <span className="shrink-0 rounded bg-info/10 px-1 text-[10px] text-info" title="Someone outside your firm is invited">external</span>}
            </Link>
            {joinable(x.videoUrl) && now !== null && Date.parse(x.start) - now < 15 * 60_000 && Date.parse(x.end) > now && (
              <a href={joinable(x.videoUrl)!} target="_blank" rel="noreferrer noopener" className="ctl ml-[5.5rem] mb-1 inline-flex items-center gap-1 bg-accent px-2 py-0.5 text-[11px] font-semibold text-accent-fg">Join now</a>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------- Notes ---------------- */

export function NotesWidget({ roomy }: Props) {
  const { desk, setDesk } = useWorkspace();
  const [text, setText] = useState(desk.notes);
  return (
    <section className={box(roomy)}>
      <H roomy={roomy} right={<span className="text-[10.5px] text-faint">saved on your account</span>}>{WIDGET_LABEL.notes}</H>
      <textarea value={text} maxLength={NOTES_MAX} rows={roomy ? 7 : 5} aria-label="Notes"
        onChange={(e) => { setText(e.target.value); setDesk({ notes: e.target.value }); }}
        placeholder="Calls to make, names to check, the thing you will forget by lunch…"
        className={`ctl w-full resize-y border border-line bg-transparent px-2.5 py-2 text-fg outline-none placeholder:text-faint focus:border-accent ${roomy ? "text-[13.5px] leading-relaxed" : "text-[12px]"}`} />
    </section>
  );
}

/* ---------------- Watchlist and movers ---------------- */

export function WatchlistWidget({ roomy }: Props) {
  const { config } = useWorkspace();
  const { data, errors, loading } = useCompanies(config.watchlist);
  const [order, setOrder] = useState<"yours" | "move" | "name">("yours");
  const loaded = config.watchlist.map((t) => data[t]).filter(Boolean);
  // Sorted for viewing only: "your order" is the list as arranged in Edit.
  const rows = order === "yours" ? loaded
    : order === "name" ? [...loaded].sort((a, b) => a.ticker.localeCompare(b.ticker))
    : [...loaded].sort((a, b) => Math.abs(b.price?.changePct ?? 0) - Math.abs(a.price?.changePct ?? 0));
  const sorter = loaded.length > 1 && (
    <button type="button" onClick={() => setOrder((o) => (o === "yours" ? "move" : o === "move" ? "name" : "yours"))} title="Sort the list"
      className="text-[11px] text-muted hover:text-fg">{order === "yours" ? "Your order" : order === "move" ? "Biggest move" : "A to Z"}</button>
  );
  const [editing, setEditing] = useState(false);
  const edit = <button type="button" onClick={() => setEditing((e) => !e)} aria-pressed={editing} className={`text-[11px] ${editing ? "text-accent" : "text-muted hover:text-fg"}`}>Edit</button>;
  const editor = editing && <div className="mb-2.5"><WatchlistEditor onDone={() => setEditing(false)} /></div>;
  if (roomy) {
    return (
      <section className={box(roomy)}>
        <H roomy right={<span className="flex items-baseline gap-3">{sorter}{edit}<Link href="/app/terminal" className="text-[11px] text-muted hover:text-fg">terminal →</Link></span>}>{WIDGET_LABEL.watchlist}</H>
        {editor}
        {rows.length === 0 && loading && <div className="shimmer h-24 ctl" />}
        {rows.length === 0 && !loading && <p className="text-[13px] text-muted">{config.watchlist.length === 0 ? "No names yet. Edit to add some." : `${Object.values(errors)[0] ?? "Prices could not be loaded right now."} Your names will fill in when they are back.`}</p>}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {rows.slice(0, 9).map((c) => {
            const chg = c.price?.changePct ?? null;
            return (
              <Link key={c.ticker} href={`/app/terminal?ticker=${c.ticker}`} className="lift ctl border border-line px-3 py-2.5 hover:border-accent/50">
                <div className="flex items-baseline justify-between"><span className="num text-[13px] font-semibold">{c.ticker}</span><span className={`num text-[12px] ${changeTone(chg)}`}>{fmtChange(chg)}</span></div>
                <div className="mt-0.5 truncate text-[11px] text-muted">{c.name}</div>
                {c.quarters.length > 1 && <div className="mt-1.5"><Sparkline values={c.quarters.map((q) => q.revenue)} width={110} height={20} stroke="var(--chart-1)" /></div>}
              </Link>
            );
          })}
        </div>
      </section>
    );
  }
  return (
    <section className="panel p-3">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-[11px] uppercase tracking-wider text-muted">Your watchlist</h2>
        <span className="flex items-baseline gap-3"><span className="text-[10.5px] text-muted">{loading && rows.length === 0 ? "loading from SEC and prices…" : rows.length === 0 ? `${config.watchlist.length} names` : `${rows.length} names · click to open`}</span>{sorter}{edit}</span>
      </div>
      {editor}
      <div className="table-scroll overflow-auto">
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
                  <td className={`num py-1.5 pr-3 text-right ${changeTone(chg)}`}>{fmtChange(chg)}</td>
                  <td className="num py-1.5 pr-3 text-right">{fmtX(d.evRevLtm)}</td>
                  <td className="num py-1.5 pr-3 text-right">{fmtPct(d.revenueGrowth)}</td>
                  <td className="num py-1.5 pr-3 text-right">{fmtPct(d.fcfMargin)}</td>
                  <td className="py-1 pr-1 text-right">{c.quarters.length > 1 && <span className="inline-block"><Sparkline values={c.quarters.map((q) => q.revenue)} width={60} height={16} stroke="var(--chart-1)" /></span>}</td>
                </tr>
              );
            })}
            {rows.length === 0 && loading && Array.from({ length: 4 }).map((_, i) => <tr key={i}><td colSpan={7} className="py-1"><span className="shimmer block h-4 ctl" /></td></tr>)}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={7} className="whitespace-normal py-3 text-[11.5px] text-muted">
                {config.watchlist.length === 0
                  ? <>No names yet. <button type="button" onClick={() => setEditing(true)} className="text-fg hover:text-accent">Add some</button>.</>
                  : <>{Object.values(errors)[0] ?? "Prices and filings could not be loaded right now."} Your watchlist ({config.watchlist.slice(0, 6).join(", ")}{config.watchlist.length > 6 ? "…" : ""}) will fill in when they are back.</>}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function MoversWidget({ roomy }: Props) {
  const { config } = useWorkspace();
  const { data } = useCompanies(config.watchlist);
  const movers = config.watchlist.map((t) => data[t]).filter(Boolean).sort((a, b) => Math.abs(b.price?.changePct ?? 0) - Math.abs(a.price?.changePct ?? 0)).slice(0, 3);
  if (!movers.length) return null;
  return (
    <section>
      <H roomy={roomy}>Movers worth a look</H>
      <div className="stagger grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {movers.map((c) => {
          const d = derive(c);
          const chg = c.price?.changePct ?? null;
          return (
            <Link key={c.ticker} href={`/app/terminal?ticker=${c.ticker}&fn=DES`} className={`lift p-3 ${roomy ? "home-card" : "panel"}`}>
              <div className="flex items-baseline justify-between"><span className="num text-[13px] font-semibold">{c.ticker}</span><span className={`num text-[11.5px] ${changeTone(chg)}`}>{fmtChange(chg, 2, true)}</span></div>
              <div className="mt-0.5 truncate text-[11px] text-muted">{c.name}</div>
              <div className="num mt-2 flex items-baseline gap-3 text-[11px]"><span>EV {d.ev !== null ? `$${fmtMoney(d.ev)}` : "n/a"}</span><span className="text-muted">{fmtX(d.evRevLtm)} rev</span></div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ---------------- Tools, the assistant, runs ---------------- */

export function StartWidget({ roomy }: Props) {
  const { tools: all, starred } = useWorkspace();
  // Starred tools first, then the ones picked for the role.
  const tools = [...starred.map((id) => all.find((t) => t.id === id)).filter((t): t is (typeof all)[number] => !!t), ...all.filter((t) => !starred.includes(t.id))];
  return (
    <section>
      <H roomy={roomy} right={<Link href="/app/tools" className="text-[11px] text-muted hover:text-fg">all tools →</Link>}>Start here</H>
      <div className="stagger grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {tools.slice(0, roomy ? 3 : 6).map((t) => <ToolCard key={t.id} t={t} />)}
      </div>
    </section>
  );
}

export function AskWidget({ roomy }: Props) {
  const { config } = useWorkspace();
  const first = config.watchlist[0] ?? "SNOW";
  return (
    <section className={box(roomy)}>
      <H roomy={roomy}>{WIDGET_LABEL.ask}</H>
      <div className="space-y-1.5">
        {config.suggestedPrompts(first).map((p) => (
          <Link key={p} href={`/app/terminal?ticker=${first}&fn=AI&arg=${encodeURIComponent(p)}`} className={`block ctl border border-line px-2.5 py-1.5 text-fg/90 transition hover:border-accent/50 hover:text-accent ${roomy ? "text-[13px]" : "text-[11.5px]"}`}>{p}</Link>
        ))}
      </div>
    </section>
  );
}

type Run = { id: number; toolId: string; title: string; createdAt: string };
export function RunsWidget({ roomy }: Props) {
  const [runs, setRuns] = useState<Run[] | null>(null);
  useEffect(() => { fetch("/api/tools/runs?limit=6").then((r) => r.json()).then((r) => setRuns(Array.isArray(r) ? r : [])).catch(() => setRuns([])); }, []);
  return (
    <section className={box(roomy)}>
      <H roomy={roomy} right={<Link href="/app/library" className="text-[11px] text-muted hover:text-fg">library →</Link>}>{roomy ? "Pick up where you left off" : "Recent runs"}</H>
      {runs === null && <div className="shimmer h-16 ctl" />}
      {runs?.length === 0 && <div className={`${roomy ? "text-[13px]" : "text-[11.5px]"} text-muted`}>Nothing yet. Runs and calculator results you save land here with their sources.</div>}
      <ul className="space-y-1">
        {runs?.map((r) => (
          <li key={r.id}>
            <Link href={`/app/tools/${r.toolId}?run=${r.id}`} className={`flex items-baseline gap-2 ctl px-1.5 py-1 hover:bg-elevated ${roomy ? "text-[13px]" : "text-[11.5px]"}`}>
              <span className="min-w-0 flex-1 truncate">{r.title || r.toolId}</span>
              <span className="num shrink-0 text-[10px] text-muted">{new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function PrivateWidget({ roomy, facts }: Props & { facts: HomeFacts }) {
  return (
    <Link href="/app/vc" className={`lift block p-3 ${roomy ? "home-card p-5" : "panel"}`}>
      <div className="flex items-center gap-2"><Icon name="Rocket" className="h-4 w-4 text-accent" /><h2 className="text-[12.5px] font-semibold">Private markets</h2></div>
      <p className="mt-1.5 text-[11.5px] text-muted">{facts.directoryTotal ? `${facts.directoryTotal.toLocaleString()} startups` : "The startup directory"} across Y Combinator, a16z, Thiel Fellows, Show HN, SEC Form D and web discovery, plus every private raise filed this month.</p>
      <span className="mt-2 inline-block text-[11.5px] text-accent">Open the directory →</span>
    </Link>
  );
}

export function SavedWidget({ roomy, facts }: Props & { facts: HomeFacts }) {
  return (
    <section className={`${box(roomy)} text-[11.5px]`}>
      <H roomy={roomy}>Your saved work</H>
      <dl className="space-y-1">
        <div className="flex justify-between"><dt className="text-muted">Comps sheets</dt><dd className="num">{facts.sheets}</dd></div>
        <div className="flex justify-between"><dt className="text-muted">Peer groups</dt><dd className="num">{facts.groups}</dd></div>
      </dl>
      <div className="mt-2 border-t border-line pt-2 text-[10.5px] text-muted">Fundamentals refresh every six hours; prices on every load. Nightly jobs re-sync the startup directory and new Form D filings.</div>
    </section>
  );
}

/* ---------------- The Book: which theses hold (src/lib/book) ---------------- */

type BookEval = { positionId: string; ticker: string; verdict: "intact" | "watch" | "broken" | "unknown"; summary: string; earnings?: { date: string; inDays: number; estimated: boolean } | null };
type BookRes = { evaluations: BookEval[]; summary: { positions: number; atRiskWeight: number; verdicts: Record<string, number> } };
const VERDICT_TONE: Record<BookEval["verdict"], string> = { broken: "bg-neg/15 text-neg", watch: "bg-accent-soft text-accent", unknown: "bg-elevated text-muted", intact: "bg-pos/15 text-pos" };
export function BookWidget({ roomy }: Props) {
  const [b, setB] = useState<BookRes | null | "error">(null);
  useEffect(() => { fetch("/api/book").then((r) => (r.ok ? r.json() : Promise.reject(r))).then(setB).catch(() => setB("error")); }, []);
  const t = roomy ? "text-[13px]" : "text-[11.5px]";
  return (
    <section className={box(roomy)}>
      <H roomy={roomy} right={<Link href="/app/book" className="text-[11px] text-muted hover:text-fg">book →</Link>}>The Book</H>
      {b === null && <div className="shimmer h-16 ctl" />}
      {b === "error" && <div className={`${t} text-muted`}>The book could not be checked just now.</div>}
      {b && b !== "error" && b.evaluations.length === 0 && <div className={`${t} text-muted`}>No positions yet. <Link href="/app/book" className="text-accent">Add one</Link> with the numbers that would prove its thesis wrong, and YouBank checks them against filings and the market.</div>}
      {b && b !== "error" && b.evaluations.length > 0 && (
        <>
          <div className={`mb-1.5 ${t} text-muted`}>{b.summary.verdicts.broken ? <span className="text-neg">{b.summary.verdicts.broken} broken</span> : "None broken"}{b.summary.verdicts.watch ? ` · ${b.summary.verdicts.watch} on watch` : ""}{b.summary.atRiskWeight ? ` · ${b.summary.atRiskWeight}% of NAV at risk` : ""}</div>
          {(() => {
            const soon = b.evaluations.filter((e) => e.earnings && e.earnings.inDays >= 0 && e.earnings.inDays <= 7).sort((x, y) => x.earnings!.inDays - y.earnings!.inDays);
            return soon.length ? <div className={`mb-1.5 ${t}`}><span className="text-muted">Reporting this week: </span>{soon.slice(0, 4).map((e) => `${e.ticker} ${e.earnings!.inDays === 0 ? "today" : e.earnings!.inDays === 1 ? "tomorrow" : `in ${e.earnings!.inDays}d`}`).join(" · ")}</div> : null;
          })()}
          <ul className="space-y-1">
            {b.evaluations.slice(0, 5).map((e) => (
              <li key={e.positionId}>
                <Link href="/app/book" className={`flex items-baseline gap-2 ctl px-1.5 py-1 hover:bg-elevated ${t}`}>
                  <span className="num w-12 shrink-0 font-semibold">{e.ticker}</span>
                  <span className={`ctl shrink-0 px-1 text-[10px] font-semibold uppercase ${VERDICT_TONE[e.verdict]}`}>{e.verdict === "unknown" ? "no data" : e.verdict}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{e.summary}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** One widget by id. */
export function Widget({ id, roomy, facts, brief }: { id: WidgetId; roomy?: boolean; facts: HomeFacts; brief?: BriefSeed }) {
  switch (id) {
    case "brief": return <HomeBrief seed={brief} />;
    case "agenda": return <AgendaWidget roomy={roomy} />;
    case "waiting": return <InboxWidget roomy={roomy} />;
    case "checklist": return <ChecklistWidget roomy={roomy} />;
    case "markets": return <MarketsWidget roomy={roomy} />;
    case "calc": return <CalcWidget roomy={roomy} />;
    case "recent": return <RecentWidget roomy={roomy} />;
    case "watchlist": return <WatchlistWidget roomy={roomy} />;
    case "movers": return <MoversWidget roomy={roomy} />;
    case "start": return <StartWidget roomy={roomy} />;
    case "ask": return <AskWidget roomy={roomy} />;
    case "runs": return <RunsWidget roomy={roomy} />;
    case "notes": return <NotesWidget roomy={roomy} />;
    case "private": return <PrivateWidget roomy={roomy} facts={facts} />;
    case "saved": return <SavedWidget roomy={roomy} facts={facts} />;
    case "book": return <BookWidget roomy={roomy} />;
  }
}
