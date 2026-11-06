import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { LetterEditor } from "@/components/book/LetterEditor";
import { currentUser } from "@/lib/auth/user";
import { calibrationOf, scorecard } from "@/lib/book/journal";
import { draftLetter, factsFrom } from "@/lib/book/letter";
import { summarize } from "@/lib/book/position";
import { headline } from "@/lib/book/risk";
import { cachedRisk } from "@/lib/book/risk-store";
import { evaluateBook, loadBook, loadBookHistory, loadJournal } from "@/lib/book/store";
import { governance, periodOf } from "@/lib/ledger/governance";
import { governanceRows, ledgerSettings } from "@/lib/ledger/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "LP letter", robots: { index: false } };

/**
 * A draft LP letter from the Book (src/lib/book/letter.ts): the book, theses under pressure, what closed and
 * why, the track record, calibration, risk and how AI was used, with a compliance pass that reads every
 * edit. Only the person's own book; nothing is sent.
 */
export default async function LetterPage() {
  const user = await currentUser();
  if (!user || !db) redirect("/sign-in");
  const now = new Date();
  const q = Math.floor(now.getUTCMonth() / 3) + 1;
  const period = `Q${q} ${now.getUTCFullYear()}`;
  const last30 = periodOf(undefined, now);
  const [book, closed, history, settings, rows, profile] = await Promise.all([
    loadBook(user.id), loadJournal(user.id).catch(() => []), loadBookHistory(user.id).catch(() => ({})), ledgerSettings(user.id).catch(() => null),
    governanceRows(user.id, last30.from, last30.to).catch(() => null),
    db.select({ firmName: schema.profiles.firmName }).from(schema.profiles).where(eq(schema.profiles.userId, user.id)).then((r) => r[0]),
  ]);
  // For the figure check: every holding's main metrics, not only those its kill criteria name (company data is cached).
  const PROBE = ["revenue_growth", "gross_margin", "operating_margin", "fcf_margin"] as const;
  const probe = book.map((p) => ({ ...p, criteria: PROBE.map((metric, k) => ({ id: `fact-${k}`, metric, op: ">=" as const, value: 0 })) }));
  const [evals, risk, factEvals] = await Promise.all([evaluateBook(book, now), cachedRisk(book, now).catch(() => null), evaluateBook(probe, now).catch(() => [])]);
  const g = rows ? governance(rows.rows, last30.from, last30.to, rows.later) : null;
  const ledgerOn = !!settings?.on;
  const draft = draftLetter({
    firm: profile?.firmName ?? "", period, now, evals, summary: summarize(evals), closed, record: scorecard(closed), calibration: calibrationOf(book, history, closed, now),
    risk: risk ? headline(risk) : null,
    ai: g ? { outputs: g.ai, reviewedShare: g.reviewedShare, verifiedShare: g.figures.verifiedShare, ledgerOn } : null,
  });
  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto max-w-[1200px] px-6 py-8 text-[12.5px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link href="/app/book" className="text-[12px] text-muted hover:text-fg">← Back to the Book</Link>
          <span className="text-[11px] text-muted">Nothing here is sent anywhere. The draft stays in this browser until you reset it.</span>
        </div>
        <header className="mb-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted">LP letter · {period}</div>
          <h1 className="mt-1 text-[22px] font-semibold">A draft from your book, to rewrite in your own voice</h1>
          <p className="text-muted">Written from the Book, the track record, calibration, risk and the research ledger as of {now.toISOString().slice(0, 10)}. Bracketed lines are yours to fill in.</p>
        </header>
        <LetterEditor draft={draft} ledgerOn={ledgerOn} facts={factsFrom(factEvals)} record={g ? { reviewedShare: g.reviewedShare, verifiedShare: g.figures.verifiedShare, outputs: g.ai } : null} storageKey={`yb-letter-${user.id}-${period}`} />
      </div>
    </main>
  );
}
