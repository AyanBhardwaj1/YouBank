"use client";

import Link from "next/link";
import type { ToolMeta } from "@/lib/workflows/catalog";
import { Icon } from "@/components/ui/Icon";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

/** A tool's card. Its own module, so a page showing a few cards does not bundle the whole catalog with the gallery. */
export function ToolCard({ t, href, compact = false }: { t: ToolMeta; href?: string; compact?: boolean }) {
  return (
    <div className="group/card relative flex">
      <Card t={t} href={href} compact={compact} />
      <StarButton id={t.id} title={t.title} className="absolute right-1.5 top-1.5" />
    </div>
  );
}

/** Star or unstar a tool: starred tools come first on Home and at the top of Tools. */
export function StarButton({ id, title, className = "" }: { id: string; title: string; className?: string }) {
  const { starred, toggleStarred } = useWorkspace();
  const on = starred.includes(id);
  return (
    <button type="button" onClick={() => toggleStarred(id)} aria-pressed={on} aria-label={on ? `Unstar ${title}` : `Star ${title}`} title={on ? "Starred" : "Star it"}
      className={`grid h-6 w-6 place-items-center rounded-full transition ${on ? "text-accent" : "text-faint opacity-0 hover:text-fg focus-visible:opacity-100 group-hover/card:opacity-100 max-md:opacity-60"} ${className}`}>
      <Icon name="Star" className={`h-3.5 w-3.5 ${on ? "fill-current" : ""}`} />
    </button>
  );
}

function Card({ t, href, compact }: { t: ToolMeta; href?: string; compact: boolean }) {
  return (
    <Link href={href ?? `/app/tools/${t.id}`} className={`lift group panel flex flex-1 flex-col ${compact ? "p-2.5" : "p-3.5"}`}>
      <div className="flex items-start gap-2.5">
        <span className={`grid shrink-0 place-items-center ctl ${t.kind === "ai" ? "bg-accent-soft text-accent" : "bg-info/10 text-info"} ${compact ? "h-7 w-7" : "h-9 w-9"}`}><Icon name={t.icon} className={compact ? "h-3.5 w-3.5" : "h-4.5 w-4.5"} /></span>
        <div className="min-w-0 flex-1 pr-5">
          <div className={`font-semibold leading-tight ${compact ? "text-[12px]" : "text-[13px]"}`}>{t.title}</div>
          <div className={`mt-0.5 text-muted ${compact ? "line-clamp-1 text-[10.5px]" : "line-clamp-2 text-[11.5px]"}`}>{t.tagline}</div>
        </div>
      </div>
      {!compact && (
        <div className="mt-3 flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted">
          <span className={`rounded px-1.5 py-px ${t.kind === "ai" ? "bg-accent-soft text-accent" : "bg-info/10 text-info"}`}>{t.kind === "ai" ? "AI" : "Calc"}</span>
          <span className="truncate">{t.category}</span>
          {t.savesMinutes ? <span className="ml-auto normal-case tracking-normal">~{t.savesMinutes >= 60 ? `${Math.round(t.savesMinutes / 60)}h` : `${t.savesMinutes}m`} saved</span> : null}
        </div>
      )}
    </Link>
  );
}
