import { actedText, brokenNow } from "@/lib/book/discipline";
import Link from "next/link";
import { redirect } from "next/navigation";
import { PrintButton } from "@/components/book/PrintButton";
import { currentUser } from "@/lib/auth/user";
import { DECISIONS } from "@/lib/book/committee";
import { evaluateBook, loadBook, loadBookHistory, loadJournal, loadProposals } from "@/lib/book/store";
import { verdictWord, weekBrief } from "@/lib/book/week";

export const dynamic = "force-dynamic";
export const metadata = { title: "The week in your book", robots: { index: false } };

const TONE = { intact: "text-pos", watch: "text-accent", broken: "text-neg", unknown: "text-muted" } as const;
function H({ children }: { children: React.ReactNode }) { return <h2 className="mt-5 text-[10px] uppercase tracking-wider text-muted">{children}</h2>; }
const pct = (x: number | null) => (x === null ? "" : ` (${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(1)}%)`);

/**
 * The last seven days of the Book on one page (src/lib/book/week.ts): verdict changes, resolved forecasts,
 * committee sittings, closes, the next two weeks' dates and proposals waiting. Printable.
 */
export default async function WeekPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const now = new Date();
  const [book, history, closed, proposals] = await Promise.all([loadBook(user.id), loadBookHistory(user.id).catch(() => ({})), loadJournal(user.id).catch(() => []), loadProposals(user.id).catch(() => [])]);
  const evals = await evaluateBook(book, now);
  const w = weekBrief({ now, book, evals, history, closed, proposals });
  const none = (t: string) => <p className="mt-0.5 text-muted">{t}</p>;
  return (
    <main className="min-h-dvh bg-bg text-fg print:bg-white print:text-black">
      <div className="mx-auto max-w-[820px] px-6 py-8 text-[12.5px] leading-relaxed print:max-w-none print:px-0 print:py-0">
        <div className="mb-6 flex items-center justify-between gap-3 print:hidden">
          <Link href="/app/book" className="text-[12px] text-muted hover:text-fg">← Back to the Book</Link>
          <PrintButton />
        </div>
        <header className="border-b border-line pb-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted">The week in your book · {w.from} to {w.to}</div>
          <h1 className="mt-1 text-[20px] font-semibold leading-snug">{w.headline}</h1>
        </header>

        <H>Verdicts that changed</H>
        {w.changes.length ? (
          <ul className="mt-0.5 space-y-1">{w.changes.map((c) => (
            <li key={c.positionId}><Link href={`/app/book?position=${encodeURIComponent(c.positionId)}`} className="font-semibold hover:underline">{c.ticker}</Link>: {verdictWord(c.from)}{c.path.slice(0, -1).map((v, k) => <span key={k}> → {verdictWord(v)}</span>)} → <span className={`font-semibold ${TONE[c.to]}`}>{verdictWord(c.to)}</span> on {c.on}. <span className="text-muted">{c.summary}</span></li>
          ))}</ul>
        ) : none("No thesis changed verdict this week.")}

        <H>Forecasts that resolved</H>
        {w.resolved.length ? (
          <ul className="mt-0.5 space-y-0.5">{w.resolved.map((r, i) => (
            <li key={i}><span className="font-semibold">{r.ticker}</span>: {Math.round(r.p * 100)}% to {r.by} ({r.source}) <span className={r.held ? "text-pos" : "text-neg"}>{r.held ? "held" : "missed"}</span> on {r.on}. <span className="text-muted">Brier {((r.p - (r.held ? 1 : 0)) ** 2).toFixed(2)}.</span></li>
          ))}</ul>
        ) : none("None resolved this week.")}

        <H>The AI committee</H>
        {w.committees.length ? (
          <ul className="mt-0.5 space-y-0.5">{w.committees.map((c) => (
            <li key={c.positionId}><span className="font-semibold">{c.ticker}</span>: {DECISIONS[c.decision]} ({c.on}){c.p !== null ? `, ${Math.round(c.p * 100)}% that no kill criterion fails in 90 days` : ""}.</li>
          ))}</ul>
        ) : none("It did not sit this week.")}

        <H>Closed</H>
        {w.closed.length ? <ul className="mt-0.5 space-y-0.5">{w.closed.map((c, i) => <li key={i}><span className="font-semibold">{c.ticker}</span>: {c.reason.toLowerCase()} on {c.on}{pct(c.ret)}.</li>)}</ul> : none("Nothing closed this week.")}

        <H>The next two weeks</H>
        {w.coming.length ? <ul className="mt-0.5 space-y-0.5">{w.coming.map((c, i) => <li key={i}><span className="num">{c.date}</span> · <span className="font-semibold">{c.ticker}</span> {c.label}{c.inDays === 0 ? " (today)" : ` (in ${c.inDays} day${c.inDays === 1 ? "" : "s"})`}</li>)}</ul> : none("No earnings or catalysts on the calendar.")}

        {w.notes.length > 0 && (<>
          <H>Your notes this week</H>
          <ul className="mt-0.5 space-y-0.5">{w.notes.map((n, k) => <li key={k}><span className="font-semibold">{n.ticker}</span> <span className="num text-muted">{n.on}</span>{n.with ? <span className="text-muted"> ({n.with})</span> : null}: {n.text}</li>)}</ul>
        </>)}

        {(() => {
          const xs = brokenNow(book, history, now);
          return xs.length ? (<>
            <H>Broken theses</H>
            <ul className="mt-0.5 space-y-0.5">{xs.map((b) => (
              <li key={b.positionId}><Link href={`/app/book?position=${encodeURIComponent(b.positionId)}`} className="font-semibold hover:underline">{b.ticker}</Link>: broken since {b.since}; {b.actedAfter === null ? <span className="font-semibold text-neg">nothing done since{b.days ? ` (${b.days} day${b.days === 1 ? "" : "s"})` : ""}</span> : actedText(b)}.</li>
            ))}</ul>
          </>) : null;
        })()}

        {w.unexplained.length > 0 && (<>
          <H>Changes without a reason</H>
          <p className="mt-0.5 text-muted">YouBank recorded what changed; a line on why makes the journal worth reading in the next letter or DDQ.</p>
          <ul className="mt-0.5 space-y-0.5">{w.unexplained.map((u) => (
            <li key={u.positionId}><Link href={`/app/book?position=${encodeURIComponent(u.positionId)}`} className="font-semibold hover:underline">{u.ticker}</Link>: {u.changes.slice(0, 2).join(" ")}{u.changes.length > 2 ? ` And ${u.changes.length - 2} more.` : ""}</li>
          ))}</ul>
        </>)}

        {w.proposals.length > 0 && (<>
          <H>Waiting for your review</H>
          <p className="mt-0.5">{w.proposals.map((p) => `${p.ticker} from ${p.from}`).join(" · ")}. <Link href="/app/book" className="text-accent hover:underline">Review them</Link>.</p>
        </>)}

        <footer className="mt-8 border-t border-line pt-3 text-[10.5px] text-muted">
          <p>From the Book&apos;s daily checks after each US close, its forecasts, the AI committee&apos;s sittings and the track record. Generated by YouBank on {now.toISOString().slice(0, 16).replace("T", " ")} UTC. For internal use; not investment advice.</p>
        </footer>
      </div>
    </main>
  );
}
