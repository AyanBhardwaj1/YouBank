"use client";

/**
 * /app/crypto: crypto research, deal intelligence, a read-only portfolio and on-chain records in one
 * place. The research tabs are the terminal's crypto screens (CRYP, TOKEN, DEFI…), so the two never
 * drift apart; the portfolio, notarizing, the mining map and Dune live here.
 */
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { PremiumBadge } from "@/components/billing/Premium";
import type { Command } from "@/lib/functions";
import { useSubNav } from "@/lib/subnav";

const Loading = () => <div className="flex flex-col gap-3 p-3" aria-busy="true"><div className="shimmer h-14 ctl" /><div className="shimmer h-56 ctl" /></div>;
const screen = (name: "CrypScreen" | "TokenScreen" | "DefiScreen" | "StblScreen" | "YldScreen" | "BtcnScreen" | "RaiseScreen" | "UnlkScreen" | "TrsyScreen" | "RwaScreen") =>
  dynamic(() => import("@/components/terminal/screens/CryptoScreens").then((m) => m[name]), { loading: Loading });
const CrypScreen = screen("CrypScreen"), TokenScreen = screen("TokenScreen"), DefiScreen = screen("DefiScreen"), StblScreen = screen("StblScreen"), YldScreen = screen("YldScreen");
const BtcnScreen = screen("BtcnScreen"), RaiseScreen = screen("RaiseScreen"), UnlkScreen = screen("UnlkScreen"), TrsyScreen = screen("TrsyScreen"), RwaScreen = screen("RwaScreen");
const Portfolio = dynamic(() => import("./Portfolio").then((m) => m.Portfolio), { loading: Loading });
const Notarize = dynamic(() => import("./Notarize").then((m) => m.Notarize), { loading: Loading });
const DunePanel = dynamic(() => import("./DunePanel").then((m) => m.DunePanel), { loading: Loading });
const SitesMap = dynamic(() => import("./SitesMap"), { ssr: false, loading: Loading });

export const CRYPTO_TABS = [
  { id: "markets", label: "Markets", icon: "Coins", fn: "CRYP" },
  { id: "token", label: "Token", icon: "Search", fn: "TOKEN" },
  { id: "defi", label: "DeFi", icon: "Layers", fn: "DEFI" },
  { id: "stablecoins", label: "Stablecoins", icon: "DollarSign", fn: "STBL" },
  { id: "yields", label: "Yields", icon: "Percent", fn: "YLD" },
  { id: "bitcoin", label: "Bitcoin", icon: "Cpu", fn: "BTCN" },
  { id: "rounds", label: "Rounds", icon: "Rocket", fn: "RAISE" },
  { id: "unlocks", label: "Unlocks", icon: "Hourglass", fn: "UNLK" },
  { id: "treasuries", label: "Treasuries", icon: "Building2", fn: "TRSY" },
  { id: "rwa", label: "Tokenized assets", icon: "Landmark", fn: "RWA" },
  { id: "portfolio", label: "Portfolio", icon: "Wallet" },
  { id: "watchlist", label: "Watchlist", icon: "Eye" },
  { id: "notarize", label: "Notarize", icon: "ScrollText" },
  { id: "map", label: "Mining map", icon: "Map" },
  { id: "dune", label: "Dune", icon: "Database", premium: "crypto.dune" },
] as const;
type TabId = (typeof CRYPTO_TABS)[number]["id"];
const isTab = (v: string | undefined): v is TabId => CRYPTO_TABS.some((t) => t.id === v);

export function CryptoWorkspace({ initialTab, initialToken }: { initialTab?: string; initialToken?: string }) {
  const router = useRouter();
  const [tab, setTab] = useState<TabId>(isTab(initialTab) ? initialTab : initialToken ? "token" : "markets");
  const [token, setToken] = useState(initialToken ?? "");
  useSubNav("/app/crypto", (v) => { if (isTab(v)) setTab(v); });

  // Screens ask to open things as terminal commands; here they become tabs, or the terminal for a company.
  const onRun = (c: Command) => {
    if (c.fn === "TOKEN") { setToken(c.arg ?? ""); setTab("token"); return; }
    const t = CRYPTO_TABS.find((x) => "fn" in x && x.fn === c.fn);
    if (t) { setTab(t.id); return; }
    const q = new URLSearchParams({ fn: c.fn, ...(c.ticker ? { ticker: c.ticker } : {}), ...(c.arg ? { arg: c.arg } : {}) });
    router.push(`/app/terminal?${q}`);
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-line bg-panel px-4 pt-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h1 className="flex items-center gap-2 text-[18px] font-semibold tracking-tight"><Icon name="Coins" className="h-5 w-5 text-accent" />Crypto</h1>
            <p className="mt-0.5 max-w-[80ch] text-[12px] text-muted">Tokens, DeFi and Bitcoin from free public data, crypto deals and company treasuries, a read-only portfolio, and notarizing documents on Base with your own wallet. Nothing here holds keys, trades or moves funds.</p>
          </div>
          <span className="text-[10.5px] text-faint">Also in the terminal: CRYP, TOKEN, DEFI, STBL, YLD, BTCN, RAISE, UNLK, TRSY, RWA, WALLET</span>
        </div>
        <nav className="-mb-px mt-2 flex gap-0.5 overflow-x-auto" aria-label="Crypto">
          {CRYPTO_TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} aria-current={tab === t.id ? "page" : undefined}
              className={`flex shrink-0 items-center gap-1.5 border-b-2 px-2.5 py-1.5 text-[12px] ${tab === t.id ? "border-accent text-accent" : "border-transparent text-muted hover:text-fg"}`}>
              <Icon name={t.icon} className="h-3.5 w-3.5" />{t.label}{"premium" in t && <PremiumBadge feature={t.premium} />}
            </button>
          ))}
        </nav>
      </div>
      <div className="@container min-h-0 flex-1 overflow-y-auto">
        <div className={tab === "portfolio" || tab === "watchlist" || tab === "notarize" || tab === "map" || tab === "dune" ? "mx-auto max-w-[1280px] p-4" : "mx-auto max-w-[1280px]"}>
          {tab === "markets" && <CrypScreen onRun={onRun} />}
          {tab === "token" && <TokenScreen key={token} onRun={onRun} arg={token} />}
          {tab === "defi" && <DefiScreen onRun={onRun} />}
          {tab === "stablecoins" && <StblScreen onRun={onRun} />}
          {tab === "yields" && <YldScreen onRun={onRun} />}
          {tab === "bitcoin" && <BtcnScreen onRun={onRun} />}
          {tab === "rounds" && <RaiseScreen onRun={onRun} />}
          {tab === "unlocks" && <UnlkScreen onRun={onRun} />}
          {tab === "treasuries" && <TrsyScreen onRun={onRun} />}
          {tab === "rwa" && <RwaScreen onRun={onRun} />}
          {tab === "portfolio" && <Portfolio role="own" />}
          {tab === "watchlist" && <Portfolio role="watch" />}
          {tab === "notarize" && <Notarize />}
          {tab === "map" && <SitesMap />}
          {tab === "dune" && <DunePanel />}
        </div>
      </div>
    </div>
  );
}
