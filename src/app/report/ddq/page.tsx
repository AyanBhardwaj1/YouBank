import Link from "next/link";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { LetterEditor } from "@/components/book/LetterEditor";
import { currentUser } from "@/lib/auth/user";
import { calibrationOf } from "@/lib/book/journal";
import { loadBook, loadBookHistory, loadJournal } from "@/lib/book/store";
import { ddqMarkdown, draftDdq } from "@/lib/ledger/ddq";
import { governance, periodOf } from "@/lib/ledger/governance";
import { chainAnchors, checkAnchors, governanceRows, ledgerSettings, verifyAll } from "@/lib/ledger/store";
import { listKeys } from "@/lib/mcp/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI due-diligence answers", robots: { index: false } };

/**
 * The AI section of an LP's due-diligence questionnaire, drafted from the research ledger, the AI-app keys
 * and the track record (src/lib/ledger/ddq.ts), editable, with the same compliance pass as the LP letter.
 * For a month (?month=2026-11) or the last 30 days. Nothing is sent anywhere.
 */
export default async function DdqPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user || !db) redirect("/sign-in");
  const { month } = await searchParams;
  const now = new Date();
  const period = periodOf(typeof month === "string" ? month : undefined, now);
  const [settings, rows, verification, onChain, keys, book, closed, history, profile] = await Promise.all([
    ledgerSettings(user.id).catch(() => null), governanceRows(user.id, period.from, period.to).catch(() => null),
    verifyAll(user.id).catch(() => null), chainAnchors(user.id).catch(() => []), listKeys(user.id).catch(() => []),
    loadBook(user.id).catch(() => []), loadJournal(user.id).catch(() => []), loadBookHistory(user.id).catch(() => ({})),
    db.select({ firmName: schema.profiles.firmName }).from(schema.profiles).where(eq(schema.profiles.userId, user.id)).then((r) => r[0]),
  ]);
  const saved = settings?.lastAnchor ? await checkAnchors(user.id, [{ seq: settings.lastAnchor.seq, hash: settings.lastAnchor.hash, source: "the daily email" }]).catch(() => []) : [];
  const anchors = [...saved, ...onChain];
  const g = rows ? governance(rows.rows, period.from, period.to, rows.later) : null;
  const ledgerOn = !!settings?.on;
  const firm = profile?.firmName ?? "";
  const items = draftDdq({
    firm, period: period.label, now, g,
    ledger: { on: ledgerOn, since: settings?.since ?? null, chainOk: verification ? verification.ok : null, checked: verification?.checked ?? null, anchors: anchors.length, anchorsMatch: anchors.filter((a) => a.state === "matches").length },
    apps: keys.map((k) => ({ name: k.name, paused: k.policy.paused, book: k.policy.book, propose: k.policy.propose, lastUsedAt: k.lastUsedAt })),
    calibration: calibrationOf(book, history, closed, now), committees: book.filter((p) => p.committee).length,
  });
  const draft = ddqMarkdown(items, firm, period.label, now);
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return (
    <main className="min-h-dvh bg-bg text-fg">
      <div className="mx-auto max-w-[1200px] px-6 py-8 text-[12.5px]">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <Link href="/report/ledger" className="text-[12px] text-muted hover:text-fg">← The AI governance report</Link>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <Link href="/report/ddq" className={`ctl px-2 py-1 ${typeof month !== "string" ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>Last 30 days</Link>
            {months.map((m) => <Link key={m} href={`/report/ddq?month=${m}`} className={`ctl px-2 py-1 ${month === m ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{m}</Link>)}
          </div>
        </div>
        <header className="mb-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted">Due diligence · {period.label}</div>
          <h1 className="mt-1 text-[22px] font-semibold">The AI questions an LP will ask, answered from your record</h1>
          <p className="text-muted">Nine questions LPs and consultants ask about AI, each answered from the research ledger, your AI-app permissions and the track record. Bracketed text is what only the firm can say. Nothing here is sent anywhere.</p>
          {!ledgerOn && <p className="mt-1 font-semibold text-accent">The research ledger is off, so most answers have nothing to stand on. <Link href="/app/settings?tab=ledger" className="underline">Turn it on</Link> and they fill in from the next AI output.</p>}
        </header>
        <LetterEditor draft={draft} ledgerOn={ledgerOn} storageKey={`yb-ddq-${user.id}-${period.label}`} label="Due-diligence answers" />
      </div>
    </main>
  );
}
