"use client";

/**
 * Ledger's navigation: coloured thumb tabs cut into the right edge of the book, one per pinned feature,
 * as an index is cut into an account book. The open one is the page's own paper colour and sticks out
 * furthest; the last tab opens everything else. Desktop only: on a phone the tab bar does this job.
 */
import Link from "next/link";
import { useNav } from "../NavContext";
import { usePinned } from "./shared";

/** Tabs have about 90px of spine: the long names get their everyday short form. */
const SHORT: Record<string, string> = { crm: "People", vc: "Private", collab: "Together", news: "News", settings: "Settings" };

export default function ThumbTabs() {
  const { items, current } = usePinned(4, 8);
  const nav = useNav();
  return (
    <nav aria-label="Pinned features" className="yb-thumbs">
      {items.map((f) => (
        <Link key={f.id} href={f.href} aria-current={current?.id === f.id ? "page" : undefined} className="yb-thumb" title={`${f.label}: ${f.blurb}`} aria-label={f.label}>{SHORT[f.id] ?? f.label}</Link>
      ))}
      <button type="button" className="yb-thumb" aria-expanded={nav.open} onClick={() => nav.setOpen(!nav.open)} title="All features and workflows">Index</button>
    </nav>
  );
}
