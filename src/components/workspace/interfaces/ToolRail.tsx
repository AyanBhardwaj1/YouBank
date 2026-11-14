"use client";

/**
 * Canvas's navigation: a floating tool rail down the left edge, as a design tool has. The pinned features
 * are its tools (names in tooltips on hover and focus), then everything else (the sidebar) and search.
 * Desktop only: on a phone the tab bar does this job.
 */
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { useNav } from "../NavContext";
import { openPalette } from "../CommandPalette";
import { usePinned } from "./shared";

export default function ToolRail() {
  const { items, current } = usePinned(4, 9);
  const nav = useNav();
  return (
    <nav aria-label="Pinned features" className="yb-tools">
      {items.map((f) => (
        <Link key={f.id} href={f.href} aria-current={current?.id === f.id ? "page" : undefined} aria-label={f.label} className="yb-tool">
          <Icon name={f.icon} className="h-[18px] w-[18px]" />
          <span className="yb-tool-tip" aria-hidden>{f.label}</span>
        </Link>
      ))}
      <hr />
      <button type="button" className="yb-tool" aria-expanded={nav.open} aria-label="All features and workflows" onClick={() => nav.setOpen(!nav.open)}>
        <Icon name="LayoutGrid" className="h-[18px] w-[18px]" />
        <span className="yb-tool-tip" aria-hidden>Everything<kbd>⌘\</kbd></span>
      </button>
      <button type="button" className="yb-tool" aria-label="Search, go to, or ask" onClick={openPalette}>
        <Icon name="Search" className="h-[18px] w-[18px]" />
        <span className="yb-tool-tip" aria-hidden>Search<kbd>⌘K</kbd></span>
      </button>
    </nav>
  );
}
