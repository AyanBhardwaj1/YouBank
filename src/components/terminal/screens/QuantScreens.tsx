"use client";

/**
 * The quant terminal functions: FACT, BTX, KELLY, TCA, INSC and DRILL, and PORT's risk-model tabs. Each is the
 * /app/quant screen in a panel, started from the command's arguments (src/lib/quant/terminal-args.ts).
 */
import Link from "next/link";
import type { ReactNode } from "react";
import { CostsTab } from "@/components/quant/CostsTab";
import { DrillsTab } from "@/components/quant/DrillsTab";
import { InsidersTab } from "@/components/quant/InsidersTab";
import { IntegrityTab } from "@/components/quant/IntegrityTab";
import { FactorsTab, RiskTab } from "@/components/quant/PortfolioTabs";
import { SizingTab } from "@/components/quant/SizingTab";
import { QuantConsent } from "@/components/quant/ui";
import { parseHoldingsText } from "@/lib/quant/holdings";
import { parseBtxArg, parseKellyArg, parseTcaArg } from "@/lib/quant/terminal-args";
import { DISCLOSURES } from "@/lib/quant/words";

function Shell({ tab, children }: { tab: string; children: ReactNode }) {
  return (
    <QuantConsent>
      <div className="h-full overflow-auto p-3 @container">
        {children}
        <p className="mt-3 text-[10.5px] text-muted">{DISCLOSURES.not_advice} <Link href={`/app/quant?tab=${tab}`} className="text-accent hover:underline">Open in Quant</Link></p>
      </div>
    </QuantConsent>
  );
}

/** "AAPL 40 MSFT 30" as the hub's holdings text ("AAPL 40, MSFT 30"). */
const holdingsText = (arg?: string, ticker?: string) => {
  const hs = arg ? parseHoldingsText(arg) : ticker ? [{ symbol: ticker, weight: 100 }] : [];
  return hs.length ? hs.map((h) => `${h.symbol} ${+h.weight.toFixed(4)}`).join(", ") : undefined;
};

export function FactScreen({ ticker, arg }: { ticker: string; arg?: string }) {
  const h = holdingsText(arg, ticker);
  return <Shell tab="factors"><FactorsTab initialHoldings={h} autoRun={!!h} /></Shell>;
}

export function BtxScreen({ arg }: { arg?: string }) {
  return <Shell tab="integrity"><IntegrityTab initialClaim={parseBtxArg(arg)} /></Shell>;
}

export function KellyScreen({ arg }: { arg?: string }) {
  return <Shell tab="sizing"><SizingTab initial={parseKellyArg(arg) ?? undefined} /></Shell>;
}

export function TcaScreen({ arg }: { arg?: string }) {
  const a = parseTcaArg(arg);
  return <Shell tab="costs"><CostsTab initialSymbol={a.symbol} initialNotional={a.notional} /></Shell>;
}

export function InscScreen({ ticker }: { ticker: string }) {
  return <Shell tab="insiders"><InsidersTab initialTicker={ticker || undefined} /></Shell>;
}

export function DrillScreen() {
  return <Shell tab="drills"><DrillsTab /></Shell>;
}

/** PORT's risk-model and factor tabs on the book typed into PORT. */
export function PortQuant({ view, text }: { view: "risk" | "factors"; text: string }) {
  const h = holdingsText(text);
  return <Shell tab={view}>{view === "risk" ? <RiskTab initialHoldings={h} autoRun={!!h} /> : <FactorsTab initialHoldings={h} autoRun={!!h} />}</Shell>;
}
