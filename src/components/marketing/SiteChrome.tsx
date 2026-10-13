"use client";

/** The header and footer of the public pages that are not the landing page: pricing and the legal pages. */
import Link from "next/link";
import { Logo, LogoMark } from "@/components/brand/Logo";
import { ThemeMenu } from "@/components/theme/ThemeMenu";
import { LEGAL } from "@/lib/site";

export function SiteHeader() {
  return (
    <header className="glass sticky top-0 z-40 border-b border-line bg-bg/80">
      <div className="mx-auto flex max-w-[1240px] items-center gap-4 px-5 py-3">
        <Link href="/" className="flex items-center gap-2"><Logo size={26} /></Link>
        <nav className="ml-4 hidden items-center gap-4 text-[12.5px] text-muted sm:flex">
          <Link href="/" className="hover:text-fg">Product</Link>
          <Link href="/pricing" className="hover:text-fg">Pricing</Link>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeMenu />
          <Link href="/sign-in" className="ctl border border-line px-3 py-1.5 text-[12.5px] text-muted transition hover:border-accent/50 hover:text-fg">Sign in</Link>
        </div>
      </div>
    </header>
  );
}

/** The legal and pricing links every public page ends with. */
export function LegalLinks({ className = "" }: { className?: string }) {
  return (
    <nav aria-label="Legal" className={`flex flex-wrap items-center gap-x-4 gap-y-1 ${className}`}>
      <Link href="/pricing" className="hover:text-fg">Pricing</Link>
      <Link href={LEGAL.terms} className="hover:text-fg">Terms</Link>
      <Link href={LEGAL.privacy} className="hover:text-fg">Privacy</Link>
      <Link href={LEGAL.refunds} className="hover:text-fg">Refunds</Link>
    </nav>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-line">
      <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-[11px] text-muted">
        <span className="flex items-center gap-2"><LogoMark size={16} id="site-foot" /> YouBank</span>
        <span>Not investment advice. Prices in US dollars, before tax.</span>
        <LegalLinks className="ml-auto" />
      </div>
    </footer>
  );
}
