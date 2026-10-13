"use client";

/**
 * The mining map on the Crypto page: Bitcoin mining sites and crypto data centres from company
 * filings, on a free basemap, through the same self-contained layer the Edge map uses
 * (src/lib/crypto/map-layer.ts), with a legend, EIA's estimate of mining's power use, and the list.
 * Loaded only when the tab opens (MapLibre is large).
 */
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { useEffect, useRef, useState } from "react";
import { DataTable, Section } from "@/components/terminal/kit";
import { addCryptoSitesLayer } from "@/lib/crypto/map-layer";
import { EIA_ESTIMATE, estimatedGwh, filingsUrl, SITE_COLORS, SITE_LABELS, SITES, siteTotals, type Site } from "@/lib/crypto/sites";

const isDark = () => {
  const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
  const m = bg.match(/^#([0-9a-f]{6})$/i);
  if (!m) return true;
  const n = parseInt(m[1], 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255) < 128;
};

export default function SitesMap() {
  const el = useRef<HTMLDivElement | null>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [failed, setFailed] = useState(false);
  const totals = siteTotals();

  useEffect(() => {
    if (!el.current) return;
    let m: maplibregl.Map;
    try {
      m = new maplibregl.Map({ container: el.current, style: `https://tiles.openfreemap.org/styles/${isDark() ? "dark" : "positron"}`, bounds: [[-125, 24], [-66, 50]], fitBoundsOptions: { padding: 16 }, attributionControl: { compact: true }, dragRotate: false });
    } catch { queueMicrotask(() => setFailed(true)); return; }
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    let remove = () => undefined as void;
    m.on("load", () => { remove = addCryptoSitesLayer(m, { initiallyOn: true }); });
    map.current = m;
    return () => { remove(); m.remove(); map.current = null; };
  }, []);

  const fly = (s: Site) => map.current?.flyTo({ center: [s.lon, s.lat], zoom: 8, duration: 1200, essential: true });

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="panel relative h-[58vh] min-h-[380px] overflow-hidden">
          {failed ? <div className="flex h-full items-center justify-center p-6 text-center text-[12.5px] text-muted">This browser cannot draw the map (WebGL is off or unavailable). The list below has every site.</div> : <div ref={el} className="h-full w-full" />}
        </div>
        <aside className="ctl border border-line bg-panel p-3 text-[12px]">
          <h3 className="font-semibold">Mining sites and crypto data centres</h3>
          <p className="mt-1 text-muted">{totals.sites} sites of the listed miners. {totals.withCapacity} state a capacity, together {Math.round(totals.mw).toLocaleString("en-US")} MW: about {totals.estTwh.toFixed(0)} TWh a year at an 85% load (an estimate).</p>
          <div className="mt-2 space-y-1">{Object.entries(SITE_LABELS).map(([k, label]) => <div key={k} className="flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: SITE_COLORS[k] }} />{label}</div>)}<div className="flex items-center gap-2 text-muted"><span className="h-3 w-3 rounded-full border-2 border-faint" />Capacity not stated</div></div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">{EIA_ESTIMATE.text} <a href={EIA_ESTIMATE.url} target="_blank" rel="noreferrer" className="text-info hover:underline">EIA ↗</a></p>
          <p className="mt-2 text-[10.5px] leading-relaxed text-faint">From the companies&apos; own filings and releases through mid-2025. Locations are to the town, not the site. Several sites are being converted to AI and high-performance computing. Click a site for its operator&apos;s SEC filings.</p>
        </aside>
      </div>
      <Section title="Every site">
        <DataTable rows={SITES} rowKey={(s) => s.id} onRow={fly} columns={[
          { key: "op", label: "Operator", align: "left", value: (s) => s.operator, render: (s) => <span>{s.operator} <span className="num text-[10px] text-faint">{s.ticker}</span></span> },
          { key: "name", label: "Site", align: "left", value: (s) => s.name },
          { key: "where", label: "Where", align: "left", value: (s) => `${s.region}, ${s.country}`, render: (s) => `${s.city}, ${s.region}${s.country !== "US" ? `, ${s.country}` : ""}` },
          { key: "kind", label: "Now", align: "left", value: (s) => s.kind, render: (s) => <span className="inline-flex items-center gap-1"><span className="h-2 w-2 rounded-full" style={{ background: SITE_COLORS[s.kind] }} />{s.status}</span> },
          { key: "mw", label: "MW", value: (s) => s.capacityMw, render: (s) => (s.capacityMw ? s.capacityMw.toLocaleString("en-US") : <span className="text-faint">—</span>) },
          { key: "gwh", label: "GWh a year (est.)", value: (s) => estimatedGwh(s.capacityMw), render: (s) => { const g = estimatedGwh(s.capacityMw); return g ? Math.round(g).toLocaleString("en-US") : <span className="text-faint">—</span>; } },
          { key: "power", label: "Power", align: "left", value: (s) => s.power, render: (s) => <span className="block max-w-[200px] truncate" title={s.note || s.power}>{s.power}</span> },
          { key: "src", label: "", sortable: false, value: () => null, render: (s) => <a href={filingsUrl(s.operator)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="text-info hover:underline">filings</a> },
        ]} />
      </Section>
    </div>
  );
}
