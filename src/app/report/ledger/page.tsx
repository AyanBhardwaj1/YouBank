import Link from "next/link";
import { redirect } from "next/navigation";
import { PrintButton } from "@/components/book/PrintButton";
import { currentUser } from "@/lib/auth/user";
import { headLine } from "@/lib/ledger/chain";
import { governance, periodOf } from "@/lib/ledger/governance";
import { chainAnchors, checkAnchors, governanceRows, ledgerHead, ledgerSettings, verifyAll } from "@/lib/ledger/store";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI governance report", robots: { index: false } };

const KIND: Record<string, string> = { chat: "AI answers", workflow: "Workflows and tools", red_team: "Red teams", mcp: "AI-app calls (MCP)", signoff: "Reviews", note: "Recording notes" };
const pct = (x: number | null) => (x === null ? "n/a" : `${x.toFixed(x % 1 ? 1 : 0)}%`);
const day = (iso: string) => iso.slice(0, 16).replace("T", " ");

/**
 * The research ledger as a document for a compliance review or an LP's due-diligence questionnaire: for a
 * month (?month=2026-11) or the last 30 days, how much AI output there was and from what, how much cites
 * sources, what a person reviewed and rejected, when recording was off, and whether the chain and its
 * anchors still check, as of the moment the report was made. Metadata only: no prompts or answers.
 */
export default async function LedgerReport({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const { month } = await searchParams;
  const now = new Date();
  const period = periodOf(typeof month === "string" ? month : undefined, now);
  const settings = await ledgerSettings(user.id).catch(() => null);
  const data = await governanceRows(user.id, period.from, period.to).catch(() => null);
  const [verification, head, onChain] = await Promise.all([verifyAll(user.id).catch(() => null), ledgerHead(user.id).catch(() => null), chainAnchors(user.id).catch(() => [])]);
  const saved = settings?.lastAnchor ? await checkAnchors(user.id, [{ seq: settings.lastAnchor.seq, hash: settings.lastAnchor.hash, source: `the daily email of ${day(settings.lastAnchor.at)} UTC` }]).catch(() => []) : [];
  const anchors = [...saved, ...onChain];
  const g = data ? governance(data.rows, period.from, period.to, data.later) : null;
  const months = Array.from({ length: 6 }, (_, i) => { const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)); return d.toISOString().slice(0, 7); });
  return (
    <main className="min-h-dvh bg-bg text-fg print:bg-white print:text-black">
      <div className="mx-auto max-w-[900px] px-6 py-8 text-[12.5px] leading-relaxed print:max-w-none print:px-0 print:py-0">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 print:hidden">
          <Link href="/app/settings?tab=ledger" className="text-[12px] text-muted hover:text-fg">← Back to the research ledger</Link>
          <div className="flex flex-wrap items-center gap-1.5 text-[12px]">
            <Link href="/report/ledger" className={`ctl px-2 py-1 ${typeof month !== "string" ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>Last 30 days</Link>
            {months.map((m) => <Link key={m} href={`/report/ledger?month=${m}`} className={`ctl px-2 py-1 ${month === m ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>{m}</Link>)}
            <PrintButton />
          </div>
        </div>
        <header className="border-b border-line pb-4">
          <div className="text-[11px] uppercase tracking-[0.12em] text-muted">AI governance report · {user.name || user.email}</div>
          <h1 className="mt-1 text-[22px] font-semibold">{period.label}</h1>
          <p className="text-muted">{day(period.from)} to {day(new Date(Date.parse(period.to) - 1).toISOString())} UTC, from the research ledger. Made {day(now.toISOString())} UTC. Counts and reviews only: the prompts and answers are in the ledger&apos;s export.</p>
        </header>

        {!data || !g ? <p className="mt-6 text-muted">The research ledger is not available on this server yet.</p> : (<>
          <section className="mt-5" aria-label="Integrity">
            <h2 className="text-[10px] uppercase tracking-wider text-muted">Integrity</h2>
            <p className={`mt-0.5 font-semibold ${verification?.ok ? "text-pos" : "text-neg"}`}>{verification ? (verification.ok ? `The chain checks: all ${verification.checked} entries, recomputed now, link to the one before.` : `The chain does not check: ${verification.problem}`) : "The chain could not be checked just now."}</p>
            {anchors.length > 0 ? (
              <ul className="mt-1 space-y-0.5">{anchors.map((a, i) => <li key={i} className={a.state === "matches" ? "" : "text-neg"}>Anchor in {a.source}: {a.detail}</li>)}</ul>
            ) : <p className="mt-1 text-muted">No anchor is kept outside YouBank yet (Settings → Research ledger: the daily email, a saved head line or Base).</p>}
            {settings && <p className="mt-1 text-muted">Recording is {settings.on ? `on${settings.since ? ` since ${day(settings.since)} UTC` : ""}` : "off"}{g.pauses.length ? `; in this period it was ${g.pauses.map((p) => `${p.on ? "turned on" : "turned off"} ${day(p.at)} UTC`).join(", ")}` : "; it was not turned off in this period"}.</p>}
          </section>

          <section className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5 print:grid-cols-5" aria-label="Summary">
            {[["AI outputs", String(g.ai)], ["With sources", pct(g.sourcedShare)], ["Reviewed by a person", pct(g.reviewedShare)], ["Rejected", String(g.reviews.rejected)], ["Days with activity", String(g.activeDays)]].map(([k, v]) => (
              <div key={k}><div className="text-[10px] uppercase tracking-wider text-muted">{k}</div><div className="num text-[15px] font-semibold">{v}</div></div>
            ))}
          </section>

          <div className="mt-5 grid gap-5 sm:grid-cols-2 print:grid-cols-2">
            <section aria-label="By kind">
              <h2 className="text-[10px] uppercase tracking-wider text-muted">What was recorded</h2>
              <table className="mt-1 w-full text-[12px]"><tbody>{g.byKind.map((k) => <tr key={k.kind} className="border-b border-line/50"><td className="py-0.5">{KIND[k.kind] ?? k.kind}</td><td className="num text-right">{k.n}</td></tr>)}</tbody></table>
              {!g.byKind.length && <p className="text-muted">Nothing in this period.</p>}
            </section>
            <section aria-label="By model">
              <h2 className="text-[10px] uppercase tracking-wider text-muted">Models</h2>
              <table className="mt-1 w-full text-[12px]"><tbody>{g.byModel.map((m) => <tr key={m.model} className="border-b border-line/50"><td className="py-0.5 break-all">{m.model}</td><td className="num text-right">{m.n}</td></tr>)}</tbody></table>
              {!g.byModel.length && <p className="text-muted">No model named in this period (AI-app calls run on the app&apos;s own model).</p>}
            </section>
            <section aria-label="AI apps">
              <h2 className="text-[10px] uppercase tracking-wider text-muted">AI apps connected over MCP</h2>
              <table className="mt-1 w-full text-[12px]"><tbody>{g.byApp.map((a) => <tr key={a.app} className="border-b border-line/50"><td className="py-0.5">{a.app}</td><td className="num text-right">{a.n}</td></tr>)}</tbody></table>
              {!g.byApp.length && <p className="text-muted">No AI-app calls in this period.</p>}
              {(g.proposals > 0 || g.errors > 0) && <p className="mt-1 text-muted">{g.proposals} position{g.proposals === 1 ? "" : "s"} proposed for review (none added without a person){g.errors ? `; ${g.errors} call${g.errors === 1 ? "" : "s"} ended in an error` : ""}.</p>}
            </section>
            <section aria-label="Tools">
              <h2 className="text-[10px] uppercase tracking-wider text-muted">Tools those apps used</h2>
              <table className="mt-1 w-full text-[12px]"><tbody>{g.byTool.map((t) => <tr key={t.tool} className="border-b border-line/50"><td className="py-0.5 font-mono text-[11.5px]">{t.tool}</td><td className="num text-right">{t.n}</td></tr>)}</tbody></table>
              {!g.byTool.length && <p className="text-muted">None.</p>}
            </section>
          </div>

          <section className="mt-5" aria-label="Reviews">
            <h2 className="text-[10px] uppercase tracking-wider text-muted">Human review</h2>
            <p className="mt-0.5">{g.reviews.approved} approved · {g.reviews.rejected} rejected · {g.reviews.noted} noted. {g.ai ? `${pct(g.reviewedShare)} of this period's ${g.ai} AI outputs were reviewed; ${g.unsourced} cited no source.` : ""}</p>
            {g.rejected.length > 0 && (
              <table className="mt-1 w-full text-[11.5px]">
                <thead><tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-muted"><th className="py-0.5">Entry</th><th>What</th><th>Reviewer</th><th>Why</th></tr></thead>
                <tbody>{g.rejected.map((r) => <tr key={r.seq} className="border-b border-line/40 align-top"><td className="num py-0.5 pr-2">{r.ref ?? "?"}</td><td className="pr-2">{r.subject}</td><td className="pr-2">{r.reviewer}</td><td className="text-muted">{r.note || "—"}</td></tr>)}</tbody>
              </table>
            )}
          </section>
        </>)}

        <footer className="mt-8 border-t border-line pt-3 text-[10.5px] text-muted">
          <p>Each ledger entry&apos;s SHA-256 hash covers its content and the hash before it, so editing, removing or reordering any entry breaks the chain from there. An anchor kept outside YouBank also catches a consistent rewrite of the whole chain. The ledger is tamper-evident; it is not WORM storage. Generated by YouBank; for internal and due-diligence use.</p>
          {head && <p className="num mt-1 break-all">Head now: {headLine(user.email, head)}</p>}
        </footer>
      </div>
    </main>
  );
}
