"use client";

/**
 * A finding opened in place inside a Terminal monitor (SAT, FLR, EVTS): the full Edge card, with its
 * images (through edgeImageSrc, in the card itself), the reasoning and the audit trail, read from
 * /api/edge/card. Opening it in Edge's feed or on its map is one click away.
 */
import { ExternalLink } from "lucide-react";
import { useApi } from "@/components/news/client";
import { EdgeCardView } from "@/components/edge/Cards";
import type { EdgeCard, ProformaVisual } from "@/components/edge/client";
import { radarUrl, whatIfUrl } from "@/lib/edge/links";
import type { Run } from "./edge-kit";

const openTab = (url: string) => window.open(url, "_blank", "noopener");

export function EdgeCardDrill({ id, onRun }: { id: number; onRun: Run }) {
  const q = useApi<{ card: EdgeCard }>(`/api/edge/card?id=${id}`);
  if (!q.data) return <div className="p-3 text-[11px] text-muted">{q.error ? `The finding did not load: ${q.error}` : <span className="inline-flex items-center gap-2"><span className="h-2 w-2 animate-pulse rounded-full bg-accent" />Opening the finding…</span>}</div>;
  const card = q.data.card;
  return (
    <div className="max-w-[760px] space-y-1.5 p-2.5">
      <EdgeCardView card={card} index={0}
        onOpenDeal={(c) => openTab(whatIfUrl((c.visual as ProformaVisual).parties.map((p) => p.tickers[0] ?? p.label), (c.visual as ProformaVisual).place))}
        onOpenRadar={() => openTab(radarUrl(card.tickers[0] ?? ""))}
        onOpenNetworks={(t) => onRun({ ticker: t, fn: "NET", via: "click" })} />
      <a href={`/app/edge?view=feed#edge-card-${card.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[10.5px] text-accent hover:underline">Open in Edge<ExternalLink className="h-3 w-3" /></a>
    </div>
  );
}
