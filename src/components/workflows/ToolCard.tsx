"use client";

import Link from "next/link";
import type { ToolMeta } from "@/lib/workflows/catalog";
import { Icon } from "@/components/ui/Icon";

/** A tool's card. Its own module, so a page showing a few cards does not bundle the whole catalog with the gallery. */
export function ToolCard({ t, href, compact = false }: { t: ToolMeta; href?: string; compact?: boolean }) {
  return (
    <Link href={href ?? `/app/tools/${t.id}`} className={`lift group panel flex flex-col ${compact ? "p-2.5" : "p-3.5"}`}>
      <div className="flex items-start gap-2.5">
        <span className={`grid shrink-0 place-items-center ctl ${t.kind === "ai" ? "bg-accent-soft text-accent" : "bg-info/10 text-info"} ${compact ? "h-7 w-7" : "h-9 w-9"}`}><Icon name={t.icon} className={compact ? "h-3.5 w-3.5" : "h-4.5 w-4.5"} /></span>
        <div className="min-w-0 flex-1">
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
