"use client";

import { useMemo, useState } from "react";
import type { Command } from "@/lib/functions";
import type { CompanyData } from "@/lib/types";
import { PEER_GROUPS, type PeerGroup, type PeerMember } from "@/lib/static-data";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { refreshCompany, useCompanies } from "@/lib/client/companies";
import { createPeerGroup, listSheets, loadSheet, saveManualInput, saveSheet, useDbPeerGroups, type SheetSummary } from "@/lib/client/persistence";
import { derive, fmtMoney, fmtNum, fmtPct, fmtX, mean, median, type Derived } from "@/lib/metrics";
import { HBar } from "@/components/charts/HBar";
import { Scatter } from "@/components/charts/Scatter";
import type { AiStatus } from "../Terminal";

type Tier = "target" | "core" | "adjacent";
type Row = { c: CompanyData; d: Derived; tier: Tier; rationale?: string };
type ColKind = "id" | "val" | "ops" | "credit" | "capital";
type Col = { key: string; label: string; get: (r: Row) => string; num?: (r: Row) => number | null; bar?: boolean; stat?: "x" | "pct" | "int"; set: ColKind | ColKind[]; editable?: "ntm_revenue" | "ntm_ebitda" };
type ColSet = "all" | "val" | "ops" | "credit" | "capital";

/** Which column set a desk opens on: credit desks lead with leverage, capital-intensive sectors with capex. */
const defaultColSet = (specialty: string, sectors: string[]): ColSet => {
  if (["Restructuring", "Leveraged finance", "DCM", "Distressed & credit", "Private credit / direct lending"].includes(specialty)) return "credit";
  if (sectors.some((x) => x === "Energy & power" || x === "Industrials" || x === "Real estate")) return "capital";
  return "all";
};
const inSet = (c: Col, k: ColKind | ColSet) => (Array.isArray(c.set) ? (c.set as string[]).includes(k) : c.set === k);

const ratio = (a: number | null | undefined, b: number | null | undefined) => (a !== null && a !== undefined && b !== null && b !== undefined && b !== 0 ? a / b : null);
const netMargin = (r: Row) => ratio(r.c.ltm.netIncome, r.c.ltm.revenue);
const netLeverage = (r: Row) => (r.d.netDebt !== null && r.c.ltm.ebitda !== null && r.c.ltm.ebitda > 0 ? r.d.netDebt / r.c.ltm.ebitda : null);
const debtToEv = (r: Row) => ratio(r.c.balance.debt, r.d.ev);
const fcfToDebt = (r: Row) => (r.c.balance.debt !== null && r.c.balance.debt > 0 ? ratio(r.d.fcf, r.c.balance.debt) : null);
const capexIntensity = (r: Row) => ratio(r.c.ltm.capex, r.c.ltm.revenue);
const sbcIntensity = (r: Row) => ratio(r.c.ltm.sbc, r.c.ltm.revenue);

const COLS: Col[] = [
  { key: "ticker", label: "Ticker", get: (r) => r.c.ticker, set: "id" },
  { key: "price", label: "Price", get: (r) => (r.c.price ? fmtNum(r.c.price.last, 2) : "n/a"), num: (r) => r.c.price?.last ?? null, set: "val" },
  { key: "mc", label: "Mkt cap", get: (r) => fmtMoney(r.d.marketCap), num: (r) => r.d.marketCap, set: "val" },
  { key: "ev", label: "EV", get: (r) => fmtMoney(r.d.ev), num: (r) => r.d.ev, set: "val" },
  { key: "evrl", label: "EV/Rev LTM", get: (r) => fmtX(r.d.evRevLtm), num: (r) => r.d.evRevLtm, bar: true, stat: "x", set: "val" },
  { key: "ntmrev", label: "NTM Rev*", get: (r) => (r.c.estimates.ntmRevenue !== null ? fmtNum(r.c.estimates.ntmRevenue) : "—"), num: (r) => r.c.estimates.ntmRevenue, set: "val", editable: "ntm_revenue" },
  { key: "evrn", label: "EV/Rev NTM", get: (r) => (r.c.estimates.ntmRevenue ? fmtX(r.d.evRevNtm) : "n/a"), num: (r) => r.d.evRevNtm, stat: "x", set: "val" },
  { key: "ntmebitda", label: "NTM EBITDA*", get: (r) => (r.c.estimates.ntmEbitda !== null ? fmtNum(r.c.estimates.ntmEbitda) : "—"), num: (r) => r.c.estimates.ntmEbitda, set: "val", editable: "ntm_ebitda" },
  { key: "even", label: "EV/EBITDA NTM", get: (r) => (r.c.estimates.ntmEbitda ? fmtX(r.d.evEbitdaNtm) : "n/a"), num: (r) => r.d.evEbitdaNtm, stat: "x", set: "val" },
  { key: "evel", label: "EV/EBITDA", get: (r) => fmtX(r.d.evEbitdaLtm), num: (r) => r.d.evEbitdaLtm, stat: "x", set: "val" },
  { key: "evae", label: "EV/Adj EBITDA", get: (r) => fmtX(r.d.evAdjEbitdaLtm), num: (r) => r.d.evAdjEbitdaLtm, stat: "x", set: "val" },
  { key: "evfcf", label: "EV/FCF", get: (r) => fmtX(r.d.evFcf), num: (r) => r.d.evFcf, stat: "x", set: "val" },
  { key: "gr", label: "Rev gr", get: (r) => fmtPct(r.d.revenueGrowth), num: (r) => r.d.revenueGrowth, bar: true, stat: "pct", set: "ops" },
  { key: "gm", label: "GM", get: (r) => fmtPct(r.d.grossMargin), num: (r) => r.d.grossMargin, stat: "pct", set: "ops" },
  { key: "om", label: "Op M", get: (r) => fmtPct(r.d.opMargin), num: (r) => r.d.opMargin, stat: "pct", set: "ops" },
  { key: "aem", label: "Adj EBITDA M", get: (r) => (r.c.ltm.adjEbitda !== null && r.c.ltm.revenue ? fmtPct(r.c.ltm.adjEbitda / r.c.ltm.revenue) : "NM"), num: (r) => (r.c.ltm.adjEbitda !== null && r.c.ltm.revenue ? r.c.ltm.adjEbitda / r.c.ltm.revenue : null), stat: "pct", set: "ops" },
  { key: "fcfm", label: "FCF M", get: (r) => fmtPct(r.d.fcfMargin), num: (r) => r.d.fcfMargin, stat: "pct", set: "ops" },
  { key: "r40", label: "R40", get: (r) => (r.d.ruleOf40 !== null ? r.d.ruleOf40.toFixed(0) : "NM"), num: (r) => r.d.ruleOf40, stat: "int", set: "ops" },
  { key: "pe", label: "P/E", get: (r) => fmtX(r.d.peLtm), num: (r) => r.d.peLtm, stat: "x", set: ["val", "credit"] },
  { key: "netmargin", label: "Net margin", get: (r) => fmtPct(netMargin(r)), num: netMargin, stat: "pct", set: ["ops", "credit"] },
  { key: "netlev", label: "Net debt/EBITDA", get: (r) => fmtX(netLeverage(r)), num: netLeverage, bar: true, stat: "x", set: "credit" },
  { key: "debtev", label: "Debt/EV", get: (r) => fmtPct(debtToEv(r)), num: debtToEv, stat: "pct", set: "credit" },
  { key: "fcfdebt", label: "FCF/debt", get: (r) => fmtPct(fcfToDebt(r)), num: fcfToDebt, stat: "pct", set: "credit" },
  { key: "netcash", label: "Net cash/(debt)", get: (r) => (r.d.netDebt === null ? "n/a" : fmtMoney(-r.d.netDebt)), num: (r) => (r.d.netDebt === null ? null : -r.d.netDebt), set: ["credit", "capital"] },
  { key: "capex", label: "Capex % rev", get: (r) => fmtPct(capexIntensity(r)), num: capexIntensity, bar: true, stat: "pct", set: "capital" },
  { key: "evebitda2", label: "EV/EBITDA", get: (r) => fmtX(r.d.evEbitdaLtm), num: (r) => r.d.evEbitdaLtm, stat: "x", set: "capital" },
  { key: "ebitdam", label: "EBITDA margin", get: (r) => fmtPct(r.d.ebitdaMargin), num: (r) => r.d.ebitdaMargin, stat: "pct", set: ["capital", "credit"] },
  { key: "sbc", label: "SBC % rev", get: (r) => fmtPct(sbcIntensity(r)), num: sbcIntensity, stat: "pct", set: "ops" },
];

const fmtStat = (kind: Col["stat"], v: number | null) => (v === null ? "NM" : kind === "int" ? v.toFixed(0) : kind === "pct" ? fmtPct(v) : fmtX(v));

export function CompsScreen({ company: target, onRun, ai }: { company: CompanyData; onRun: (c: Command) => void; ai: AiStatus | null }) {
  const defaultGroup = PEER_GROUPS.find((g) => g.members.some((m) => m.ticker === target.ticker));
  const [groupId, setGroupId] = useState<string>(defaultGroup?.id ?? "watchlist");
  const [aiGroup, setAiGroup] = useState<PeerGroup | null>(null);
  const [custom, setCustom] = useState<PeerMember[]>([]);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const [showCharts, setShowCharts] = useState(true);
  const [colSet, setColSet] = useState<ColSet>("all");
  const [colSetTouched, setColSetTouched] = useState(false);
  const [addTicker, setAddTicker] = useState("");
  const [proposing, setProposing] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [sheets, setSheets] = useState<SheetSummary[] | null>(null);
  const [sheetId, setSheetId] = useState<number | null>(null);
  const [sheetGroup, setSheetGroup] = useState<PeerGroup | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const { groups: dbGroups } = useDbPeerGroups();
  const { config: ws, profile } = useWorkspace();
  const preferred = defaultColSet(profile.specialty, profile.sectors);
  const activeSet = colSetTouched ? colSet : preferred;

  const groups = useMemo<PeerGroup[]>(() => [...(aiGroup ? [aiGroup] : []), ...(sheetGroup ? [sheetGroup] : []), ...dbGroups, ...PEER_GROUPS], [aiGroup, sheetGroup, dbGroups]);
  const members = useMemo<PeerMember[]>(() => {
    const g = groups.find((x) => x.id === groupId);
    const base: PeerMember[] = g ? g.members : ws.watchlist.map((t) => ({ ticker: t, tier: "core" as const, rationale: "Watchlist" }));
    const seen = new Set<string>([target.ticker]);
    return [...base, ...custom].filter((m) => (seen.has(m.ticker) ? false : (seen.add(m.ticker), true)));
  }, [groups, groupId, custom, target.ticker, ws.watchlist]);

  const { data, errors, loading } = useCompanies([target.ticker, ...members.map((m) => m.ticker)]);
  const cols = COLS.filter((c) => inSet(c, "id") || (activeSet === "all" ? inSet(c, "val") || inSet(c, "ops") : inSet(c, activeSet)));

  const peers = useMemo<Row[]>(() => {
    const rows = members.filter((m) => !excluded.has(m.ticker) && data[m.ticker]).map((m) => ({ c: data[m.ticker], d: derive(data[m.ticker]), tier: m.tier as Tier, rationale: m.rationale }));
    if (!sort) return rows;
    const col = COLS.find((c) => c.key === sort.key);
    if (!col?.num) return rows;
    return [...rows].sort((a, b) => {
      const av = col.num!(a), bv = col.num!(b);
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return (av - bv) * sort.dir;
    });
  }, [members, excluded, data, sort]);

  const pending = members.filter((m) => !excluded.has(m.ticker) && !data[m.ticker] && !errors[m.ticker]);
  const failed = members.filter((m) => !excluded.has(m.ticker) && errors[m.ticker]);
  const targetRow: Row = { c: target, d: derive(target), tier: "target" };
  const core = peers.filter((r) => r.tier === "core");
  const adjacent = peers.filter((r) => r.tier === "adjacent");
  const all = [targetRow, ...peers];
  const barMax: Record<string, number> = {};
  for (const col of COLS) if (col.bar && col.num) barMax[col.key] = Math.max(...all.map((r) => col.num!(r) ?? 0), 0.0001);
  const medLtm = median(peers.map((r) => r.d.evRevLtm));

  const toggleSort = (key: string) => setSort((s) => (s?.key === key ? (s.dir === -1 ? { key, dir: 1 } : null) : { key, dir: -1 }));

  const proposePeers = async () => {
    setProposing(true); setAiError(null);
    try {
      const res = await fetch("/api/ai/peers", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: target.ticker }) });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      const g: PeerGroup = {
        id: "ai", name: `AI proposed · ${json.model}`, description: json.summary ?? "",
        members: [...json.core.map((m: PeerMember) => ({ ...m, tier: "core" as const })), ...json.adjacent.map((m: PeerMember) => ({ ...m, tier: "adjacent" as const }))],
      };
      setAiGroup(g); setGroupId("ai"); setExcluded(new Set());
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setProposing(false);
    }
  };

  const flash = (msg: string) => { setStatus(msg); setTimeout(() => setStatus(null), 2500); };

  const saveGroup = async () => {
    const current = groups.find((g) => g.id === groupId);
    const name = window.prompt("Save peer group as", current?.id === "ai" ? `${target.ticker} peers (AI)` : `${target.ticker} peers`);
    if (!name) return;
    try {
      const g = await createPeerGroup({ name, description: current?.description ?? "", members: members.filter((m) => !excluded.has(m.ticker)) });
      setGroupId(g.id); setCustom([]); setExcluded(new Set()); flash(`Saved group "${name}"`);
    } catch (e) { setAiError(e instanceof Error ? e.message : String(e)); }
  };

  const persistSheet = async () => {
    const name = window.prompt("Save sheet as", `${target.ticker} trading comps`);
    if (!name) return;
    try {
      const snapshot = all.map((r) => ({ ticker: r.c.ticker, tier: r.tier, ev: r.d.ev, evRevLtm: r.d.evRevLtm, evRevNtm: r.d.evRevNtm, growth: r.d.revenueGrowth, gm: r.d.grossMargin, fcfm: r.d.fcfMargin, ltmEnd: r.c.ltm.periodEnd, price: r.c.price?.last ?? null }));
      const saved = await saveSheet({ id: sheetId ?? undefined, name, targetTicker: target.ticker, members: members.filter((m) => !excluded.has(m.ticker)), excluded: [], columnSet: activeSet, sort, snapshot });
      setSheetId(saved.id); setSheets(null); flash(`Saved sheet "${name}"`);
    } catch (e) { setAiError(e instanceof Error ? e.message : String(e)); }
  };

  const openSheet = async (id: number) => {
    try {
      const sh = await loadSheet(id);
      setSheetGroup({ id: `sheet-${sh.id}`, name: `Sheet: ${sh.name}`, description: `Saved by ${sh.createdBy}`, members: sh.members });
      setGroupId(`sheet-${sh.id}`); setCustom([]); setExcluded(new Set(sh.excluded)); setColSet((sh.columnSet as ColSet) || "all"); setColSetTouched(true); setSort(sh.sort); setSheetId(sh.id);
      flash(`Loaded "${sh.name}"`);
    } catch (e) { setAiError(e instanceof Error ? e.message : String(e)); }
  };

  const statRow = (label: string, f: (v: (number | null)[]) => number | null, set: Row[]) => (
    <tr className="border-t border-line-strong bg-elevated/70">
      <td className="py-1 pl-3 font-sans text-muted">{label}</td>
      {cols.slice(1).map((col) => (
        <td key={col.key} className="py-1 pr-2 text-right font-semibold">{col.stat && col.num ? fmtStat(col.stat, f(set.map(col.num))) : ""}</td>
      ))}
    </tr>
  );

  const renderRow = (r: Row) => (
    <tr key={r.c.ticker} title={r.rationale} className={`group/row border-b border-line/50 transition-colors hover:bg-elevated/70 ${r.tier === "target" ? "bg-accent-soft" : ""}`}>
      {cols.map((col, i) => {
        const text = col.get(r);
        if (i === 0) {
          return (
            <td key={col.key} className={`py-1 pl-2 ${r.tier === "target" ? "border-l-2 border-accent" : "border-l-2 border-transparent"}`}>
              <span className="flex items-center gap-1.5">
                <button type="button" onClick={() => onRun({ ticker: r.c.ticker, fn: "DES" })} title={`Open ${r.c.ticker} DES`}
                  className={`font-semibold hover:underline ${r.tier === "target" ? "text-accent" : "text-fg"}`}>{r.c.ticker}</button>
                {r.tier !== "target" && (
                  <button type="button" title="Remove from this sheet" aria-label={`Remove ${r.c.ticker}`} onClick={() => setExcluded((s) => new Set(s).add(r.c.ticker))}
                    className="text-faint opacity-0 hover:text-neg group-hover/row:opacity-100">×</button>
                )}
              </span>
            </td>
          );
        }
        if (col.editable) {
          return (
            <td key={col.key} className="py-0.5 pr-2 text-right">
              <EditableCell ticker={r.c.ticker} field={col.editable} value={col.editable === "ntm_revenue" ? r.c.estimates.ntmRevenue : r.c.estimates.ntmEbitda}
                meta={r.c.estimates.source === "manual" ? { by: r.c.estimates.enteredBy ?? "?", at: r.c.estimates.enteredAt?.slice(0, 10) ?? "" } : undefined} />
            </td>
          );
        }
        const v = col.num ? col.num(r) : null;
        const w = col.bar && v !== null && v > 0 ? Math.min(v / barMax[col.key], 1) * 100 : 0;
        const dim = text === "NM" || text === "n/a";
        return (
          <td key={col.key} className={`relative py-1 pr-2 text-right ${dim ? "text-faint" : ""} ${r.tier === "target" ? "font-semibold" : ""}`}>
            {col.bar && w > 0 && <span aria-hidden className="absolute inset-y-1 right-1 rounded-sm bg-chart-1/20" style={{ width: `calc(${w}% - 4px)` }} />}
            <span className="relative">{text}</span>
          </td>
        );
      })}
    </tr>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5 text-[11px]">
        <label className="flex items-center gap-1.5 text-muted">
          Peer group
          <select value={groupId} onChange={(e) => { setGroupId(e.target.value); setExcluded(new Set()); }}
            className="max-w-[220px] rounded border border-line bg-elevated px-1.5 py-0.5 text-fg focus:border-accent/60 focus:outline-none">
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
            <option value="watchlist">Watchlist</option>
          </select>
        </label>
        <button type="button" onClick={proposePeers} disabled={proposing || !ai?.configured}
          title={ai?.configured ? `Ask ${ai.provider} for a tiered peer set` : "Add an OpenAI or Anthropic key to enable"}
          className={`rounded border px-2 py-0.5 ${ai?.configured ? "border-accent/50 text-accent hover:bg-accent-soft" : "border-line text-muted opacity-60"}`}>
          {proposing ? "✦ Proposing…" : "✦ Propose peers"}
        </button>
        <form className="flex items-center gap-1" onSubmit={(e) => { e.preventDefault(); const t = addTicker.trim().toUpperCase(); if (t) { setCustom((c) => [...c, { ticker: t, tier: "core", rationale: "Added manually" }]); setAddTicker(""); } }}>
          <input value={addTicker} onChange={(e) => setAddTicker(e.target.value)} placeholder="+ ticker" spellCheck={false}
            className="num w-20 rounded border border-line bg-bg px-1.5 py-0.5 uppercase text-fg placeholder:normal-case placeholder:text-faint focus:border-accent/60 focus:outline-none" />
        </form>
        {(groupId === "ai" || custom.length > 0 || groupId.startsWith("sheet-")) && (
          <button type="button" onClick={saveGroup} className="rounded border border-line px-2 py-0.5 text-muted hover:border-accent/50 hover:text-accent">Save group</button>
        )}
        <button type="button" onClick={persistSheet} className="rounded border border-line px-2 py-0.5 text-muted hover:border-accent/50 hover:text-accent">{sheetId ? "Update sheet" : "Save sheet"}</button>
        <select value="" onFocus={() => { if (!sheets) listSheets().then(setSheets).catch(() => setSheets([])); }} onChange={(e) => { const id = Number(e.target.value); if (id) void openSheet(id); }}
          className="rounded border border-line bg-elevated px-1.5 py-0.5 text-muted focus:border-accent/60 focus:outline-none">
          <option value="">Open sheet…</option>
          {(sheets ?? []).map((sh) => <option key={sh.id} value={sh.id}>{sh.name} · {sh.targetTicker} · {sh.createdBy}</option>)}
          {sheets && sheets.length === 0 && <option disabled>No saved sheets</option>}
        </select>
        {excluded.size > 0 && <button type="button" onClick={() => setExcluded(new Set())} className="text-info hover:underline">Restore {excluded.size} removed</button>}
        {status && <span className="text-pos">{status}</span>}
        {aiError && <span className="text-neg">{aiError}</span>}
        <div className="ml-auto flex overflow-hidden ctl border border-line">
          {(["all", "val", "ops", "credit", "capital"] as ColSet[]).map((k) => (
            <button key={k} type="button" onClick={() => { setColSet(k); setColSetTouched(true); }} title={k === "credit" ? "Leverage, coverage and net cash" : k === "capital" ? "Capex intensity and EBITDA multiples" : undefined}
              className={`px-2 py-0.5 ${activeSet === k ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
              {k === "all" ? "All" : k === "val" ? "Valuation" : k === "ops" ? "Operating" : k === "credit" ? "Credit" : "Capital"}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => setShowCharts((s) => !s)} className={`rounded px-2 py-0.5 ${showCharts ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>Charts</button>
        <span className="text-muted">{peers.length} peers{pending.length ? ` · ${pending.length} loading` : ""} · USD mm</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full whitespace-nowrap text-[11.5px]">
          <thead className="sticky top-0 z-10 bg-panel text-[10.5px] uppercase tracking-wider text-muted">
            <tr className="border-b border-line-strong">
              {cols.map((col, i) => (
                <th key={col.key} className={`py-1.5 font-normal ${i === 0 ? "pl-3 text-left" : "pr-2 text-right"}`}>
                  {col.num ? (
                    <button type="button" onClick={() => toggleSort(col.key)} className={`hover:text-fg ${sort?.key === col.key ? "text-accent" : ""}`}>
                      {col.label}{sort?.key === col.key ? (sort.dir === -1 ? " ▼" : " ▲") : ""}
                    </button>
                  ) : col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {renderRow(targetRow)}
            {core.length > 0 && <tr><td colSpan={cols.length} className="py-1 pl-3 font-sans text-[10px] uppercase tracking-wider text-muted">Core peers</td></tr>}
            {core.map(renderRow)}
            {adjacent.length > 0 && <tr><td colSpan={cols.length} className="py-1 pl-3 font-sans text-[10px] uppercase tracking-wider text-muted">Adjacent peers</td></tr>}
            {adjacent.map(renderRow)}
            {pending.map((m) => (
              <tr key={m.ticker} className="border-b border-line/50">
                <td className="py-1 pl-3 text-muted">{m.ticker}</td>
                <td colSpan={cols.length - 1} className="py-1 pr-2"><span className="inline-block h-3 w-full max-w-[420px] animate-pulse rounded bg-elevated" /></td>
              </tr>
            ))}
            {failed.map((m) => (
              <tr key={m.ticker} className="border-b border-line/50">
                <td className="py-1 pl-3 text-faint">{m.ticker}</td>
                <td colSpan={cols.length - 1} className="py-1 pr-2 text-right text-[10.5px] text-neg">{errors[m.ticker]} <button type="button" className="ml-2 text-muted hover:text-fg" onClick={() => setExcluded((s) => new Set(s).add(m.ticker))}>remove</button></td>
              </tr>
            ))}
            {peers.length > 0 && statRow("Median · all peers", median, peers)}
            {peers.length > 0 && statRow("Mean · all peers", mean, peers)}
            {core.length > 0 && adjacent.length > 0 && statRow("Median · core", median, core)}
          </tbody>
        </table>

        {showCharts && peers.length > 0 && (
          <div className="grid gap-4 border-t border-line p-3 lg:grid-cols-2">
            <HBar title="EV / LTM revenue"
              data={all.map((r) => ({ key: r.c.ticker, label: r.c.ticker, value: r.d.evRevLtm, emphasis: r.tier === "target", note: r.tier }))}
              format={fmtX} referenceLine={medLtm !== null ? { value: medLtm, label: `peer median ${fmtX(medLtm)}` } : undefined} />
            <Scatter title="Growth vs. EV / LTM revenue"
              data={all.map((r) => ({ key: r.c.ticker, label: r.c.ticker, x: r.d.revenueGrowth, y: r.d.evRevLtm, emphasis: r.tier === "target" }))}
              xLabel="LTM revenue growth" yLabel="EV/LTM rev" fx={(v) => fmtPct(v)} fy={(v) => fmtX(v)} />
          </div>
        )}
        {loading && peers.length === 0 && <div className="p-3 text-[11px] text-muted">Loading peers from SEC EDGAR…</div>}
      </div>

      <div className="border-t border-line px-3 py-1 text-[10px] text-muted">
        Fundamentals from SEC XBRL (LTM, latest 10-Q/10-K); prices and market cap from FMP. EV = market cap + debt − cash. EBITDA is reported (op. income + D&A); Adj. adds back SBC.
        * NTM revenue and EBITDA are manual consensus entries (click a cell; USD mm; ᵐ marks manual with author and date). NM = negative or zero denominator. Fiscal years not calendarized.
      </div>
    </div>
  );
}


function EditableCell({ ticker, field, value, meta }: { ticker: string; field: "ntm_revenue" | "ntm_ebitda"; value: number | null; meta?: { by: string; at: string } }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const commit = async () => {
    const v = draft.trim().replace(/,/g, "");
    setSaving(true); setErr(null);
    try {
      await saveManualInput({ ticker, field, value: v === "" ? null : Number(v) });
      refreshCompany(ticker);
      setEditing(false);
    } catch (e) { setErr(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  };
  if (editing) {
    return (
      <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} disabled={saving} placeholder="USD mm"
        onKeyDown={(e) => { if (e.key === "Enter") void commit(); if (e.key === "Escape") setEditing(false); }} onBlur={() => { if (!saving) void commit(); }}
        className="num w-20 rounded border border-accent/60 bg-bg px-1 py-0 text-right text-fg focus:outline-none" title={err ?? undefined} />
    );
  }
  return (
    <button type="button" onClick={() => { setDraft(value !== null ? String(value) : ""); setEditing(true); }}
      title={meta ? `Manual entry by ${meta.by} on ${meta.at}. Click to change.` : "Click to enter consensus estimate (USD mm)"}
      className={`rounded px-1 hover:bg-elevated ${value === null ? "text-faint" : ""} ${err ? "text-neg" : ""}`}>
      {value !== null ? fmtNum(value) : "—"}{meta && <sup className="ml-0.5 text-[9px] text-accent">m</sup>}
    </button>
  );
}
