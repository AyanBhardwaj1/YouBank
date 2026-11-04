import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { cache } from "react";
import { SiteFooter, SiteHeader } from "@/components/marketing/SiteChrome";
import { Icon } from "@/components/ui/Icon";
import { getPublicCompany, hasCompanyRecord } from "@/lib/company";
import { withinRate } from "@/lib/locks";
import { publicFacts, publicPeers, publicSummary, publicTicker, sitemapTickers } from "@/lib/public/company-page";
import { siteLink, siteUrl } from "@/lib/site";

/**
 * A public page per company (research item C3): who it is, its last twelve months from SEC XBRL, quarterly
 * revenue, recent filings and peers, with a way into the app for prices, comps and the AI. Rendered per
 * request (the root layout reads the style cookies) from the shared company record, which is itself
 * cached: six hours for filings and fundamentals, a minute in memory. Public SEC data only
 * (src/lib/public/company-page.ts).
 */

type Params = { params: Promise<{ ticker: string }> };

/**
 * A company with no stored record is built from the SEC on first view. Crawlers walking every ticker would
 * turn that into a flood of SEC requests, so public pages build at most 300 new records an hour across the
 * site (the sitemap's companies always); past that, an unbuilt company is a 404 until someone opens it in
 * the app or the hour turns.
 */
const BUILDS_PER_HOUR = 300;
const load = cache(async (raw: string) => {
  const t = publicTicker(raw);
  if (!t) return { t: null, c: null };
  if (!(await hasCompanyRecord(t)) && !sitemapTickers().includes(t) && !(await withinRate("public-company-build", BUILDS_PER_HOUR, 3_600_000))) return { t, c: null };
  return { t, c: await getPublicCompany(t).catch(() => null) };
});

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { t, c } = await load((await params).ticker);
  if (!t || !c) return { title: "Company", robots: { index: false } };
  return {
    title: `${c.name} (${c.ticker}): revenue, margins and SEC filings`,
    description: publicSummary(c).slice(0, 300),
    alternates: { canonical: `/c/${c.ticker}` },
    // A record without its fundamentals is not worth indexing until it has them.
    robots: c.ltm.revenue === null ? { index: false } : undefined,
    openGraph: { title: `${c.name} (${c.ticker}) on YouBank`, description: publicSummary(c).slice(0, 200), url: siteLink(`/c/${c.ticker}`) },
  };
}

export default async function CompanyPage({ params }: Params) {
  const raw = (await params).ticker;
  const { t, c } = await load(raw);
  if (!t || !c) notFound();
  if (raw !== c.ticker) permanentRedirect(`/c/${c.ticker}`);
  const facts = publicFacts(c);
  const peers = publicPeers(c.ticker);
  const open = (path: string) => `/sign-in?next=${encodeURIComponent(path)}`;
  const asks = [`What drove ${c.ticker}'s revenue growth over the last four quarters?`, `How do ${c.ticker}'s margins compare with its peers?`, `What changed in ${c.ticker}'s latest 10-K risk factors?`];
  const jsonLd = {
    "@context": "https://schema.org", "@type": "Corporation", name: c.name, tickerSymbol: c.ticker,
    ...(c.website ? { url: c.website } : {}), ...(c.hq ? { address: c.hq } : {}),
    identifier: c.cik ? { "@type": "PropertyValue", propertyID: "SEC CIK", value: c.cik } : undefined,
    subjectOf: { "@type": "WebPage", url: siteLink(`/c/${c.ticker}`), publisher: { "@type": "Organization", name: "YouBank", url: siteUrl() } },
  };
  return (
    <div className="min-h-dvh bg-bg text-fg">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c") }} />
      <SiteHeader />
      <main className="mx-auto max-w-[1080px] px-5 py-10">
        <nav className="text-[11.5px] text-muted" aria-label="Breadcrumb"><Link href="/" className="hover:text-fg">YouBank</Link> · Companies · {c.ticker}</nav>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[30px] font-semibold tracking-tight">{c.name} <span className="num text-muted">{c.ticker}</span></h1>
            <p className="mt-1 text-[13px] text-muted">{[c.exchange, c.sicLabel, c.hq, c.fye ? `fiscal year ends ${c.fye}` : ""].filter(Boolean).join(" · ")}</p>
          </div>
          <Link href={open(`/app/terminal?ticker=${c.ticker}`)} className="ctl flex items-center gap-1.5 bg-accent px-4 py-2 text-[13px] font-semibold text-accent-fg"><Icon name="Terminal" className="h-4 w-4" />Open {c.ticker} in YouBank</Link>
        </div>

        <section className="mt-8" aria-labelledby="ltm">
          <h2 id="ltm" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Last twelve months{c.ltm.periodEnd ? ` to ${c.ltm.periodEnd}` : ""}</h2>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
            {facts.map((f) => (
              <div key={f.label} className="panel p-3"><div className="text-[11px] text-muted">{f.label}</div><div className="num mt-1 text-[18px] font-semibold">{f.value}</div></div>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-muted">From SEC XBRL company facts{c.sources.factsUrl ? <> (<a href={c.sources.factsUrl} rel="nofollow noopener" target="_blank" className="hover:text-fg hover:underline">source</a>)</> : null}. Prices, market value and multiples are in the app.</p>
        </section>

        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          {c.quarters.length > 0 && (
            <section aria-labelledby="quarters">
              <h2 id="quarters" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Quarterly revenue</h2>
              <table className="mt-3 w-full text-[12.5px]">
                <tbody>
                  {c.quarters.slice(-8).reverse().map((q) => (
                    <tr key={q.end} className="border-b border-line/60"><td className="py-1.5 text-muted">{q.label}</td><td className="num py-1.5 text-right">${Math.round(q.revenue).toLocaleString("en-US")}M</td></tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
          {c.filings.length > 0 && (
            <section aria-labelledby="filings">
              <h2 id="filings" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Recent SEC filings</h2>
              <ul className="mt-3 space-y-1 text-[12.5px]">
                {c.filings.slice(0, 8).map((f) => (
                  <li key={`${f.form}-${f.filed}-${f.url}`} className="flex gap-3 border-b border-line/60 py-1.5">
                    <span className="num w-14 shrink-0 font-semibold">{f.form}</span>
                    <a href={f.url} rel="nofollow noopener" target="_blank" className="min-w-0 flex-1 truncate hover:text-accent">{f.title || `${f.form} filed ${f.filed}`}</a>
                    <span className="num shrink-0 text-muted">{f.filed}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        <section className="mt-8 panel p-5" aria-labelledby="ask">
          <h2 id="ask" className="text-[15px] font-semibold">Ask about {c.ticker}, with every figure cited</h2>
          <p className="mt-1 text-[12.5px] text-muted">YouBank reads the same filings and checks each number in its answer against the source it cites.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {asks.map((q) => <Link key={q} href={open(`/app/terminal?ticker=${c.ticker}&fn=AI&arg=${encodeURIComponent(q)}`)} className="rounded-full border border-line bg-bg px-3 py-1.5 text-[12px] hover:border-accent/50 hover:text-accent">{q}</Link>)}
          </div>
        </section>

        {peers.length > 0 && (
          <section className="mt-8" aria-labelledby="peers">
            <h2 id="peers" className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent">Peers</h2>
            <div className="mt-3 flex flex-wrap gap-2">
              {peers.map((p) => <Link key={p} href={`/c/${p}`} className="num ctl border border-line px-3 py-1.5 text-[12.5px] hover:border-accent/50 hover:text-accent">{p}</Link>)}
              <Link href={open(`/app/terminal?ticker=${c.ticker}&fn=COMPS`)} className="ctl px-3 py-1.5 text-[12.5px] text-muted hover:text-fg">Trading comps in the app →</Link>
            </div>
          </section>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
