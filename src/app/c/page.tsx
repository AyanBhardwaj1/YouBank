import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { PEER_GROUPS } from "@/lib/static-data";

export const metadata: Metadata = {
  title: "Companies: revenue, margins and SEC filings",
  description: "Public companies by industry group, each with its last twelve months from SEC filings, quarterly revenue, recent 10-K, 10-Q and 8-K filings, and peers.",
  alternates: { canonical: "/c" },
};

/** The public company pages (/c/TICKER), by YouBank's saved peer groups. */
export default function CompaniesIndex() {
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <SiteHeader />
      <main className="mx-auto max-w-[1080px] px-5 py-10">
        <h1 className="text-[28px] font-semibold tracking-tight">Companies</h1>
        <p className="mt-1 max-w-[70ch] text-[13px] text-muted">Each page has the company&apos;s last twelve months from SEC filings, quarterly revenue, recent filings and peers. Prices, comps and the AI are in the app.</p>
        <div className="mt-8 grid gap-6 sm:grid-cols-2">
          {PEER_GROUPS.map((g) => (
            <section key={g.id} aria-labelledby={`g-${g.id}`} className="panel p-4">
              <h2 id={`g-${g.id}`} className="text-[14px] font-semibold">{g.name}</h2>
              <p className="mt-0.5 text-[12px] text-muted">{g.description}</p>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {g.members.map((m) => (
                  <li key={m.ticker}><Link href={`/c/${m.ticker}`} title={m.rationale} className="num ctl border border-line px-2.5 py-1 text-[12px] hover:border-accent/50 hover:text-accent">{m.ticker}</Link></li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
