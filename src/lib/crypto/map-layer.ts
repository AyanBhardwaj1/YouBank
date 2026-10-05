/**
 * Crypto on the map: Bitcoin mining sites and crypto data centres as a self-contained MapLibre layer,
 * with its own on/off button and popups. Client only (it touches the DOM); loaded with the map.
 *
 * One call adds everything to a map that has finished loading:
 *
 *   addCryptoSitesLayer(map, { beforeId: "markers-halo" })
 *
 * The data (GET /api/crypto/sites, GeoJSON) is fetched the first time the layer is switched on, so a
 * map that never shows it never downloads it. Circles are sized by stated capacity (sites without a
 * stated figure are small hollow rings) and coloured by what the site does now: mining, hosting, or
 * converting to AI and high-performance computing. The layer owns its ids (all "crypto-sites…"),
 * so it never collides with the host map's layers or click handlers.
 */
import maplibregl, { type GeoJSONSource, type IControl, type Map as MLMap, type MapMouseEvent } from "maplibre-gl";
import { SITE_COLORS, sitePopupHtml, type SitePopup } from "./sites";

export { SITE_COLORS, SITE_LABELS } from "./sites";

export const CRYPTO_LAYER_IDS = ["crypto-sites-halo", "crypto-sites"] as const;
const SOURCE = "crypto-sites";

const EMPTY = { type: "FeatureCollection" as const, features: [] };

/**
 * Add the layer and its button to a loaded map. Returns a function that removes both. Options:
 * `beforeId` keeps the host's own markers on top; `initiallyOn` shows it straight away (the crypto
 * page's map); `url` points at another GeoJSON source.
 */
export function addCryptoSitesLayer(map: MLMap, opts: { beforeId?: string; initiallyOn?: boolean; url?: string; onToggle?: (on: boolean) => void } = {}): () => void {
  if (map.getSource(SOURCE)) return () => undefined;
  const before = opts.beforeId && map.getLayer(opts.beforeId) ? opts.beforeId : undefined;
  map.addSource(SOURCE, { type: "geojson", data: EMPTY });
  const color: unknown = ["match", ["get", "kind"], "hosting", SITE_COLORS.hosting, "hpc_conversion", SITE_COLORS.hpc_conversion, SITE_COLORS.bitcoin_mining];
  const radius: unknown = ["interpolate", ["linear"], ["sqrt", ["coalesce", ["get", "capacityMw"], 0]], 0, 4, 10, 7, 32, 16];
  map.addLayer({ id: "crypto-sites-halo", type: "circle", source: SOURCE, layout: { visibility: "none" }, paint: { "circle-color": color as never, "circle-radius": ["+", radius, 5] as never, "circle-opacity": 0.18, "circle-blur": 0.6 } }, before);
  map.addLayer({ id: "crypto-sites", type: "circle", source: SOURCE, layout: { visibility: "none" }, paint: {
    "circle-color": color as never, "circle-radius": radius as never,
    // A site without a stated capacity is a ring, so nobody reads its size as "small".
    "circle-opacity": ["case", ["==", ["get", "capacityMw"], null], 0, 0.85] as never,
    "circle-stroke-color": color as never, "circle-stroke-width": ["case", ["==", ["get", "capacityMw"], null], 2, 1] as never,
  } }, before);

  let loaded = false, on = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    fetch(opts.url ?? "/api/crypto/sites").then((r) => (r.ok ? r.json() : null)).then((d) => { if (d && map.getSource(SOURCE)) (map.getSource(SOURCE) as GeoJSONSource).setData(d); }).catch(() => { loaded = false; });
  };
  const set = (v: boolean) => {
    on = v;
    if (v) load();
    for (const id of CRYPTO_LAYER_IDS) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v ? "visible" : "none");
    button.setAttribute("aria-pressed", String(v));
    button.style.color = v ? "var(--accent, #f5a623)" : "";
    opts.onToggle?.(v);
  };

  // The button, as a MapLibre control so it sits with the map's own controls.
  const box = document.createElement("div");
  box.className = "maplibregl-ctrl maplibregl-ctrl-group";
  const button = document.createElement("button");
  button.type = "button";
  button.title = "Bitcoin mining sites and crypto data centres, from company filings";
  button.setAttribute("aria-label", "Show crypto mining sites");
  button.style.cssText = "width:auto;padding:0 8px;font:600 11px/29px var(--font-sans);white-space:nowrap";
  button.textContent = "₿ Mining sites";
  button.addEventListener("click", () => set(!on));
  box.appendChild(button);
  const control: IControl = { onAdd: () => box, onRemove: () => box.remove() };
  map.addControl(control, "bottom-right");

  const popup = new maplibregl.Popup({ closeButton: false, closeOnClick: true, maxWidth: "270px", className: "edge-popup" });
  const click = (e: MapMouseEvent & { features?: { properties: Record<string, unknown> }[] }) => {
    const f = e.features?.[0];
    if (!f) return;
    const p = f.properties as unknown as SitePopup;
    // MapLibre turns nulls in properties into the string "null"; put them back.
    const capacityMw = p.capacityMw === null || (p.capacityMw as unknown) === "null" ? null : Number(p.capacityMw);
    const estGwh = p.estGwh === null || (p.estGwh as unknown) === "null" ? null : Number(p.estGwh);
    popup.setLngLat(e.lngLat).setHTML(sitePopupHtml({ ...p, capacityMw, estGwh })).addTo(map);
  };
  const enter = () => { map.getCanvas().style.cursor = "pointer"; };
  const leave = () => { map.getCanvas().style.cursor = ""; };
  map.on("click", "crypto-sites", click);
  map.on("mouseenter", "crypto-sites", enter);
  map.on("mouseleave", "crypto-sites", leave);
  if (opts.initiallyOn) set(true);

  return () => {
    map.off("click", "crypto-sites", click);
    map.off("mouseenter", "crypto-sites", enter);
    map.off("mouseleave", "crypto-sites", leave);
    popup.remove();
    try { map.removeControl(control); } catch { /* already gone */ }
    for (const id of CRYPTO_LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SOURCE)) map.removeSource(SOURCE);
  };
}
