import Link from "next/link";
import { LEGAL } from "@/lib/site";
import { SiteFooter, SiteHeader } from "./SiteChrome";

export type LegalSection = { heading: string; body: React.ReactNode };

/**
 * A legal page: a plain-language draft, clearly marked as not yet reviewed. Every page built on this shows
 * the banner until `reviewed` is set, which should happen only once counsel has approved the text.
 */
export function LegalPage({ title, updated, intro, sections, reviewed = false }: { title: string; updated: string; intro: React.ReactNode; sections: LegalSection[]; reviewed?: boolean }) {
  return (
    <main className="overflow-x-hidden">
      <SiteHeader />
      <article className="mx-auto max-w-[760px] px-5 pb-16 pt-10">
        {!reviewed && (
          <div role="note" className="ctl mb-6 border border-neg/40 bg-neg/5 px-4 py-3 text-[12.5px]">
            <strong>Draft: to be reviewed by counsel.</strong> This page is a placeholder written in plain language so billing can be set up. It has not been reviewed by a lawyer and will change before YouBank charges anyone.
          </div>
        )}
        <h1 className="text-[28px] font-semibold tracking-tight">{title}</h1>
        <p className="mt-1 text-[12px] text-muted">Last updated {updated}</p>
        <div className="mt-5 text-[13.5px] leading-relaxed">{intro}</div>
        {sections.map((s, i) => (
          <section key={s.heading} className="mt-7">
            <h2 className="text-[15px] font-semibold">{i + 1}. {s.heading}</h2>
            <div className="mt-2 space-y-2 text-[13px] leading-relaxed text-muted">{s.body}</div>
          </section>
        ))}
        <p className="mt-10 text-[12px] text-muted">
          See also: <Link href={LEGAL.terms} className="underline hover:text-fg">Terms of Service</Link>, <Link href={LEGAL.privacy} className="underline hover:text-fg">Privacy Policy</Link>, <Link href={LEGAL.refunds} className="underline hover:text-fg">Refund Policy</Link>, <Link href="/pricing" className="underline hover:text-fg">Pricing</Link>.
        </p>
      </article>
      <SiteFooter />
    </main>
  );
}
