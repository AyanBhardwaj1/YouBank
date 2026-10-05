"use client";

/**
 * The deal what-if for any companies: pick two to four, and see what they would own together on the
 * map, where they overlap, what the combination does to each county's processing concentration, and
 * which plants a regulator would most likely ask to be sold.
 */
import dynamic from "next/dynamic";
import { AlertTriangle, ArrowRight, Loader2, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { Select } from "@/components/ui/Select";
import { fmtNum, useApi, type AssetCollection, type EdgeState, type Proforma } from "./client";
import type { CountyShade, MapParty } from "./EarthMap";
import { MapLoading } from "./MapView";

const EarthMap = dynamic(() => import("./EarthMap"), { ssr: false, loading: () => <MapLoading /> });

const FLAG: Record<string, { text: string; cls: string }> = {
  high: { text: "Screens high", cls: "bg-neg/15 text-neg" },
  watch: { text: "Worth a look", cls: "bg-accent-soft text-accent" },
  "": { text: "", cls: "" },
};

const queryFor = (names: string[], place: string) => {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  return clean.length >= 2 ? `parties=${encodeURIComponent(clean.join(","))}&place=${place}` : null;
};

/** Opened from a deal card, it starts drawn (the workspace remounts it per card). */
export function WhatIf({ state, initial }: { state: EdgeState; initial: { parties: string[]; place?: string; key: number } | null }) {
  const watched = state.watches.filter((w) => w.kind === "company" && w.target.ticker).map((w) => w.target.ticker!);
  const [names, setNames] = useState<string[]>(() => initial?.parties.length ? initial.parties.slice(0, 4) : [watched[0] ?? "ET", watched[1] ?? "TRGP"]);
  const [place, setPlace] = useState(initial?.place ?? state.covered[0]?.key ?? "permian");
  const [query, setQuery] = useState<string | null>(() => (initial ? queryFor(initial.parties, initial.place ?? "permian") : null));
  const [error, setError] = useState<string | null>(null);
  const result = useApi<Proforma>(query ? `/api/edge/proforma?${query}` : null);
  const running = result.loading && !!query;
  const drawnPlace = query ? new URLSearchParams(query).get("place") ?? place : place;
  const placeInfo = state.places.find((x) => x.key === drawnPlace) ?? state.places[0];

  const run = () => {
    const q = queryFor(names, place);
    setError(q ? null : "Pick at least two companies.");
    if (q) setQuery(q);
  };

  // What the map needs for the result: the sides' assets and the counties.
  const p = query ? result.data : null;
  const tickers = p ? p.parties.map((x) => x.ticker).filter(Boolean) : [];
  const nameParties = p ? p.parties.filter((x) => !x.ticker).map((x) => x.label) : [];
  const assets = useApi<AssetCollection>(p ? `/api/edge/assets?place=${drawnPlace}&tickers=${tickers.join(",")}&names=${encodeURIComponent(nameParties.join(","))}` : null);
  const counties = useApi<AssetCollection>(p ? `/api/edge/assets?place=${drawnPlace}&kinds=county` : null);
  const parties: MapParty[] = useMemo(() => (p ? p.parties.map((x) => ({ key: x.key, label: x.label, color: x.color, tickers: x.ticker ? [x.ticker] : [], companies: x.ticker ? [] : [x.label] })) : []), [p]);
  const shade: CountyShade = useMemo(() => Object.fromEntries((p?.counties ?? []).map((c) => [c.geoid, { flag: c.flag, shared: c.parties.length >= 2 }])), [p]);
  const partyName = (key: string) => p?.parties.find((x) => x.key === key)?.label ?? key;

  return (
    <div className="space-y-3">
      <form onSubmit={(e) => { e.preventDefault(); run(); }} className="panel flex flex-wrap items-end gap-2 p-3">
        {names.map((n, i) => (
          <label key={i} className="block min-w-[140px] flex-1 text-[11px] text-muted">
            <span>{i === 0 ? "Buyer" : i === 1 ? "Target" : `Company ${i + 1}`}</span>
            <div className="mt-1 flex items-center gap-1">
              <input list="edge-whatif-companies" value={n} onChange={(e) => setNames((cur) => cur.map((x, j) => (j === i ? e.target.value : x)))} placeholder="Ticker or name" className="ctl w-full border border-line bg-bg px-2 py-1.5 text-[12.5px] text-fg outline-none placeholder:text-faint focus:border-accent/60" />
              {names.length > 2 && <button type="button" onClick={() => setNames((cur) => cur.filter((_, j) => j !== i))} aria-label="Remove this company" className="rounded p-1 text-muted hover:text-neg"><X className="h-3.5 w-3.5" /></button>}
            </div>
          </label>
        ))}
        <datalist id="edge-whatif-companies">{state.companies.map((c) => <option key={c.ticker} value={c.ticker}>{c.company}</option>)}</datalist>
        {names.length < 4 && <button type="button" onClick={() => setNames((cur) => [...cur, ""])} className="ctl flex items-center gap-1 border border-dashed border-line px-2 py-1.5 text-[12px] text-muted hover:text-fg"><Plus className="h-3.5 w-3.5" /> Company</button>}
        <label className="block text-[11px] text-muted">
          <span>Where</span>
          <Select value={place} onChange={setPlace} aria-label="Where" className="ctl mt-1 block border border-line bg-bg px-2 py-1.5 text-left text-[12.5px] text-fg outline-none focus:border-accent/60">
            {state.places.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
          </Select>
        </label>
        <button type="submit" disabled={running} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50">
          {running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />} Draw the combination
        </button>
      </form>
      {(error || (query && result.error)) && <p className="text-[12.5px] text-neg">{error ?? result.error}</p>}

      {!p && !running && (
        <div className="panel p-5 text-[12.5px] leading-relaxed text-muted">
          <h3 className="text-[14px] font-semibold text-fg">What would they own together?</h3>
          <p className="mt-1.5 max-w-[80ch]">Pick a buyer and a target (tickers like ET, KMI, TRGP, OKE, EPD, or an operator&apos;s name). Edge draws both footprints from EIA&apos;s pipeline and processing-plant maps, finds where they overlap by county, and screens each county&apos;s processing concentration the way the 2023 Merger Guidelines do (HHI above 1,800 and up by more than 100), naming the plants most likely to be sold as a remedy.</p>
        </div>
      )}

      {p && (
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px]">
          <div className="panel relative h-[60vh] min-h-[400px] overflow-hidden">
            <EarthMap bbox={placeInfo.bbox} assets={assets.data} parties={parties} counties={counties.data} shade={shade} />
            <div className="glass pointer-events-none absolute left-2 top-2 rounded-lg border border-line bg-bg/80 px-2.5 py-2 text-[11px] shadow">
              {p.parties.map((x) => <div key={x.key} className="flex items-center gap-1.5"><span className="h-2 w-3 rounded-sm" style={{ background: x.color }} />{x.label}</div>)}
              <div className="mt-1 flex items-center gap-1.5 text-muted"><span className="h-2.5 w-3 rounded-sm bg-neg/40" />County screens high</div>
              <div className="flex items-center gap-1.5 text-muted"><span className="h-2.5 w-3 rounded-sm bg-accent/30" />Worth a look</div>
              <div className="flex items-center gap-1.5 text-muted"><span className="h-2.5 w-3 rounded-sm bg-info/20" />Both operate there</div>
            </div>
          </div>
          <div className="space-y-3">
            <div className="panel p-3">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[["Processing", `${fmtNum(p.combined.capacityMMcfd)}`, "MMcfd together"], ["Share", `${Math.round(p.combined.capacityShare * 100)}%`, "of mapped capacity"], ["Pipeline", fmtNum(p.combined.pipelineKm), "km together"]].map(([k, v, s]) => (
                  <div key={k} className="rounded-md bg-elevated/60 px-2 py-2"><div className="text-[10.5px] uppercase tracking-wider text-muted">{k}</div><div className="num mt-0.5 text-[18px] font-semibold">{v}</div><div className="text-[10px] text-faint">{s}</div></div>
                ))}
              </div>
              <div className="table-scroll"><table className="mt-3 w-full text-[11.5px]">
                <thead><tr className="text-left text-[10.5px] text-muted"><th className="py-1 font-medium">Company</th><th className="text-right font-medium">Plants</th><th className="text-right font-medium">MMcfd</th><th className="text-right font-medium">Pipe km</th></tr></thead>
                <tbody>
                  {p.parties.map((x) => (
                    <tr key={x.key} className="border-t border-line"><td className="py-1"><span className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: x.color }} />{x.label}</td><td className="text-right">{x.plants}</td><td className="text-right">{fmtNum(x.capacityMMcfd)}</td><td className="text-right">{fmtNum(x.pipelineKm)}</td></tr>
                  ))}
                </tbody>
              </table></div>
              {p.parties.some((x) => !x.plants && x.pipelineKm < 1) && <p className="mt-2 flex items-start gap-1.5 text-[11px] text-accent"><AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {p.parties.filter((x) => !x.plants && x.pipelineKm < 1).map((x) => x.label).join(", ")} {p.parties.filter((x) => !x.plants && x.pipelineKm < 1).length === 1 ? "has" : "have"} no mapped assets here, so the overlap is one-sided.</p>}
            </div>
            <div className="panel p-3 text-[12px]">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Overlap</div>
              <ul className="mt-1.5 space-y-1 text-muted">
                <li><span className="num text-fg">{p.overlap.counties}</span> counties where both operate, <span className="num text-fg">{p.overlap.adjacentCounties}</span> more next door to the other</li>
                {p.parties.length === 2 && <li><span className="num text-fg">{fmtNum(p.overlap.parallelKm)}</span> km of pipeline within a kilometre of the other side&apos;s</li>}
                <li><span className="num text-fg">{p.overlap.nearbyPlants.length}</span> pairs of plants within 25 km{p.overlap.nearbyPlants[0] ? `, closest ${p.overlap.nearbyPlants[0].a.name} and ${p.overlap.nearbyPlants[0].b.name} (${fmtNum(p.overlap.nearbyPlants[0].km, 1)} km)` : ""}</li>
              </ul>
            </div>
            {p.divestitures.length > 0 && (
              <div className="panel border-neg/40 p-3 text-[12px]">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-neg">Likely divestitures</div>
                <ul className="mt-1.5 space-y-1.5">{p.divestitures.map((d) => <li key={d.plant.id}><span className="font-medium">{d.plant.name}</span> <span className="text-muted">({d.plant.company}, {fmtNum(d.plant.capacityMMcfd)} MMcfd)</span><div className="text-[11px] text-muted">{d.reason}</div></li>)}</ul>
              </div>
            )}
          </div>
          <div className="panel overflow-x-auto p-3 xl:col-span-2">
            <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">Counties</div>
            <div className="table-scroll"><table className="mt-1.5 w-full min-w-[640px] text-[11.5px]">
              <thead><tr className="text-left text-[10.5px] text-muted"><th className="py-1 font-medium">County</th><th className="font-medium">Who operates</th><th className="text-right font-medium">Their MMcfd</th><th className="text-right font-medium">County MMcfd</th><th className="text-right font-medium">HHI before</th><th className="text-right font-medium">After</th><th className="text-right font-medium">Change</th><th className="pl-2 font-medium">Screen</th></tr></thead>
              <tbody>
                {p.counties.slice(0, 30).map((c) => (
                  <tr key={c.geoid} className="border-t border-line">
                    <td className="py-1">{c.name}</td>
                    <td className="text-muted">{c.parties.map(partyName).join(" + ") || "—"}</td>
                    <td className="num text-right">{fmtNum(Object.values(c.capacity).reduce((a, b) => a + b, 0))}</td>
                    <td className="num text-right text-muted">{fmtNum(c.totalCapacity)}</td>
                    <td className="num text-right">{c.hhiBefore === null ? "—" : fmtNum(c.hhiBefore)}</td>
                    <td className="num text-right">{c.hhiAfter === null ? "—" : fmtNum(c.hhiAfter)}</td>
                    <td className="num text-right">{c.delta ? `+${fmtNum(c.delta)}` : "—"}</td>
                    <td className="pl-2">{c.flag && <span className={`rounded px-1.5 py-0.5 text-[10.5px] ${FLAG[c.flag].cls}`}>{FLAG[c.flag].text}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
            <p className="mt-2 text-[10.5px] leading-relaxed text-faint">{p.method}. Sources: {p.sources.map((s) => `${s.name} (${s.license}; ${s.vintage})`).join("; ")}. A county is a rough market and plant capacities are from 2017, so read the screen as where to look, not a legal conclusion.</p>
          </div>
        </div>
      )}
    </div>
  );
}
