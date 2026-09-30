"use client";

/**
 * Scenarios · Synthetic data: market scenarios and stress tests, company what-ifs, synthetic tables and
 * filled gaps, and fictional practice data. Everything made here is labeled synthetic (or fictional)
 * with its recipe and seed, and every scenario is checked against real data for realism.
 */
import { useCallback, useState } from "react";
import { MarketTab } from "./MarketTab";
import { CompanyTab, PracticeTab, SavedList, TablesTab } from "./OtherTabs";

type Tab = "market" | "company" | "tables" | "practice" | "saved";
const TABS: { id: Tab; label: string }[] = [{ id: "market", label: "Market scenarios" }, { id: "company", label: "Company what-if" }, { id: "tables", label: "Synthetic tables" }, { id: "practice", label: "Practice data" }, { id: "saved", label: "Saved" }];

export function ScenariosView({ tickers }: { tickers: string[] }) {
  const [tab, setTab] = useState<Tab>("market");
  const [nonce, setNonce] = useState(0);
  const saved = useCallback(() => setNonce((n) => n + 1), []);
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-0.5 rounded-lg border border-line p-0.5" role="tablist" aria-label="Scenarios">
          {TABS.map((t) => <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={`rounded-md px-3 py-1 text-[12.5px] ${tab === t.id ? "bg-elevated text-fg" : "text-muted hover:text-fg"}`}>{t.label}</button>)}
        </div>
        <p className="text-[11.5px] text-muted">Synthetic data is labeled everywhere, with its recipe and seed.</p>
      </div>
      {tab === "market" && <MarketTab suggest={tickers.length ? tickers : ["ET", "KMI", "TRGP"]} onSaved={saved} />}
      {tab === "company" && <CompanyTab suggest={tickers.length ? tickers : ["ET", "KMI", "TRGP"]} onSaved={saved} />}
      {tab === "tables" && <TablesTab onSaved={saved} />}
      {tab === "practice" && <PracticeTab onSaved={saved} />}
      {tab === "saved" && <SavedList nonce={nonce} />}
    </div>
  );
}
