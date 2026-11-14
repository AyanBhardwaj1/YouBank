"use client";

/**
 * Blueprint's navigation: drawing-sheet tabs along the bottom, as a CAD program lays out its sheets. One
 * per pinned feature, numbered as sheets are; the open sheet is drawn solid in yellow, the rest dashed. The
 * last tab opens the sheet index (everything else). Desktop only: on a phone the tab bar does this job.
 */
import Link from "next/link";
import { useNav } from "../NavContext";
import { usePinned } from "./shared";

export default function SheetTabs() {
  const { items, current } = usePinned(4, 9);
  const nav = useNav();
  return (
    <nav aria-label="Pinned features" className="yb-sheets">
      {items.map((f, i) => (
        <Link key={f.id} href={f.href} aria-current={current?.id === f.id ? "page" : undefined} className="yb-sheet-tab" title={f.blurb}>
          <b>{String(i + 1).padStart(2, "0")}</b>{f.label}
        </Link>
      ))}
      <button type="button" className="yb-sheet-tab" aria-expanded={nav.open} onClick={() => nav.setOpen(!nav.open)}><b>+</b>Sheet index</button>
    </nav>
  );
}
