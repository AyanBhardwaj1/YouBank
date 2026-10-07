"use client";

/**
 * A site's digital twin, from the map's side panel: open it (free: terrain, lidar-measured and mapped
 * tanks and stacks, pipelines as tubes, flares, data centres and mines, the aerial photo), then add what
 * a plan includes: the lidar point cloud streamed in passes, AI scene analyses drawn as 3D cells, Planet
 * imagery draped on the terrain, and a recorded 3D time-lapse. Every paid or heavy step starts from a
 * button here, and the server checks the plan again before it runs. The glTF export of the twin is free.
 */
import { errorMessage } from "@/lib/client/errors";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { PremiumBadge, PremiumGate } from "@/components/billing/Premium";
import { Icon } from "@/components/ui/Icon";
import { decodePoints } from "@/lib/edge/geo3d/ept";
import { toGlb } from "@/lib/edge/geo3d/glb";
import { twinParts } from "@/lib/edge/geo3d/twin-export";
import type { SceneResult } from "@/lib/edge/scene";
import type { Bbox, SourceInfo } from "@/lib/edge/sources/eia";
import type { DigitalTwin } from "@/lib/edge/twin";
import type { Frame } from "@/lib/edge/timelapse";
import { useFeature } from "@/lib/client/plan";
import { api, post } from "../client";
import type { MapApi } from "../EarthMap";
import { CLASS_LEGEND, MAP_LAYERS } from "./layers";
import { cloudPoints, type Cloud, type CloudColor, type Map3DScene } from "./scene";

export type TwinTarget = { asset?: number; detection?: number; name: string; lon: number; lat: number; bbox?: Bbox | null; heat?: boolean };
/** What the twin puts on the map, and which place it belongs to (a new twin replaces the last). */
export type TwinView = { target: TwinTarget | null; scene: Map3DScene; drape: { url: string; bbox: Bbox } | null; planet: { type: string; id: string; bbox: Bbox } | null };
export const EMPTY_VIEW: TwinView = { target: null, scene: {}, drape: null, planet: null };
export const targetKey = (t: TwinTarget | null | undefined) => (t ? (t.asset ? `a${t.asset}` : `d${t.detection}`) : "");

type SetView = (fn: (v: TwinView) => TwinView) => void;

const q = (t: TwinTarget) => (t.asset ? `asset=${t.asset}` : `detection=${t.detection}`);
const body = (t: TwinTarget) => (t.asset ? { asset: t.asset } : { detection: t.detection });
const n0 = (v: number) => Math.round(v).toLocaleString("en-US");
const small = () => typeof window !== "undefined" && (window.matchMedia?.("(max-width: 640px)").matches ?? false);
/** A failure in words: the server's own plain message, or a dropped connection said plainly. */
const errText = (e: unknown) => errorMessage(e);

function Section({ title, badge, children }: { title: string; badge?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-elevated/30 p-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-muted">{title}{badge}</div>
      {children}
    </section>
  );
}

function Sources({ sources }: { sources: SourceInfo[] }) {
  return (
    <p className="text-[10px] leading-snug text-faint">
      {sources.map((s, i) => <span key={s.key}>{i ? "; " : ""}{s.url ? <a href={s.url} target="_blank" rel="noreferrer" className="hover:text-fg hover:underline">{s.name}</a> : s.name}{s.vintage ? `, ${s.vintage}` : ""} ({s.license})</span>)}.
    </p>
  );
}

const action = "ctl flex w-full items-center justify-center gap-1.5 border border-line px-2.5 py-2 text-[12px] font-medium hover:border-accent/50 hover:text-fg disabled:opacity-60";
const primary = "ctl flex w-full items-center justify-center gap-1.5 border border-accent/50 bg-accent-soft/40 px-2.5 py-2 text-[12px] font-medium text-accent hover:bg-accent-soft disabled:opacity-60";

/** A button for a plan feature: works when unlocked; when locked it says what the plan adds instead (locked, not hidden). */
function FeatureButton({ feature, busy, onClick, children }: { feature: string; busy?: boolean; onClick: () => void; children: ReactNode }) {
  const unlocked = useFeature(feature);
  const [why, setWhy] = useState(false);
  if (unlocked === false) {
    return (
      <div className="space-y-1.5">
        <button type="button" onClick={() => setWhy((v) => !v)} aria-expanded={why} className={`${action} text-muted`}><Icon name="Lock" className="h-3.5 w-3.5" /> {children} <PremiumBadge feature={feature} /></button>
        {why && <PremiumGate feature={feature}>{null}</PremiumGate>}
      </div>
    );
  }
  return (
    <button type="button" disabled={busy || unlocked === null} onClick={onClick} className={action}>
      {busy ? <Icon name="Loader" className="h-3.5 w-3.5 animate-spin" /> : null} {children} <PremiumBadge feature={feature} />
    </button>
  );
}

/** Save bytes as a file. */
function save(bytes: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const a = document.createElement("a");
  a.href = url; a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "site";

/** Record a canvas for `ms` as WebM, or null where the browser cannot. */
async function record(canvas: HTMLCanvasElement, ms: number): Promise<Blob | null> {
  if (typeof MediaRecorder === "undefined" || !canvas.captureStream) return null;
  const type = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"].find((t) => MediaRecorder.isTypeSupported(t));
  if (!type) return null;
  const rec = new MediaRecorder(canvas.captureStream(30), { mimeType: type, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((r) => { rec.onstop = () => r(); });
  rec.start(500);
  await new Promise((r) => setTimeout(r, ms));
  rec.stop();
  await done;
  return new Blob(chunks, { type: "video/webm" });
}

/** Load images before showing them, so the drape never flashes empty. */
const preload = (urls: string[]) => Promise.all(urls.map((u) => new Promise<void>((r) => { const i = new Image(); i.crossOrigin = "anonymous"; i.onload = () => r(); i.onerror = () => r(); i.src = u; })));

export function SiteTwin({ target, view, setView, api: mapApi, onFly, autoOpen }: { target: TwinTarget; view: TwinView; setView: SetView; api: MapApi | null; onFly: (f: { lon: number; lat: number; zoom: number; pitch: number; bearing: number }) => void; autoOpen?: boolean }) {
  const [state, setState] = useState<{ busy: boolean; error: string | null }>({ busy: false, error: null });
  // This place's twin, or none yet (another site's twin stays on the map until this one opens).
  const twin = view.target && targetKey(view.target) === targetKey(target) ? view.scene.twin ?? null : null;

  const open = () => {
    setState({ busy: true, error: null });
    api<DigitalTwin>(`/api/edge/twin?${q(target)}`)
      .then((t) => { setView(() => ({ ...EMPTY_VIEW, target, scene: { twin: t } })); setState({ busy: false, error: null }); onFly({ lon: t.center.lon, lat: t.center.lat, zoom: 15.4, pitch: 62, bearing: -30 }); })
      .catch((e) => setState({ busy: false, error: errText(e) }));
  };
  const close = () => setView(() => EMPTY_VIEW);
  // Opened with "See it in 3D": open the twin straight away (a click, so free work only).
  const opened = useRef(false);
  useEffect(() => {
    if (!autoOpen || opened.current || twin) return;
    opened.current = true;
    queueMicrotask(open);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen, twin]);

  if (!twin) {
    return (
      <Section title="Digital twin">
        <p className="mb-2 text-[11.5px] leading-snug text-muted">The site in 3D from free public data: the terrain, tanks and stacks measured by USGS lidar or mapped in OpenStreetMap, pipelines as tubes, this week&apos;s flares, data centres and mines, and the newest aerial photo.</p>
        <button type="button" onClick={open} disabled={state.busy} className={primary}>
          {state.busy ? <Icon name="Loader" className="h-3.5 w-3.5 animate-spin" /> : <Icon name="Boxes" className="h-3.5 w-3.5" />}
          {state.busy ? "Reading the ground, lidar and OpenStreetMap…" : "Open the digital twin"}
        </button>
        {state.error && <p className="mt-1.5 text-[11px] text-neg">{state.error}</p>}
      </Section>
    );
  }
  const c = twin.counts;
  const facts = [c.tanks ? `${c.tanks} tank${c.tanks === 1 ? "" : "s"}` : "", c.stacks ? `${c.stacks} stack${c.stacks === 1 ? "" : "s"} or tower${c.stacks === 1 ? "" : "s"}` : "", c.flames ? `${c.flames} flaring` : "", c.pipelines ? `${c.pipelines} pipeline run${c.pipelines === 1 ? "" : "s"}` : "", c.datacenters ? `${c.datacenters} data centre${c.datacenters === 1 ? "" : "s"}` : "", c.mines ? `${c.mines} mine${c.mines === 1 ? "" : "s"} or quarr${c.mines === 1 ? "y" : "ies"}` : ""].filter(Boolean);
  const volume = twin.models.filter((m) => m.kind === "tank").reduce((s, m) => s + (m.volumeM3 ?? 0), 0);
  return (
    <div className="space-y-2">
      <Section title="Digital twin">
        <div className="flex items-start justify-between gap-2">
          <p className="text-[12px] leading-snug">{facts.length ? facts.join(", ") : "Nothing standing is mapped or measured here yet"}{volume ? `; about ${n0((volume * 6.2898) / 1000)}k barrels of tank shell` : ""}.</p>
          <button type="button" onClick={close} aria-label="Close the digital twin" className="shrink-0 text-muted hover:text-fg"><Icon name="X" className="h-3.5 w-3.5" /></button>
        </div>
        {twin.notes.length > 0 && <p className="mt-1 text-[10.5px] leading-snug text-muted">{twin.notes.join(" ")}</p>}
        <LayerToggles view={view} setView={setView} />
        <div className="mt-2 flex flex-wrap gap-1.5">
          <button type="button" onClick={() => onFly({ lon: twin.center.lon, lat: twin.center.lat, zoom: 15.4, pitch: 62, bearing: -30 })} className="ctl border border-line px-2 py-1 text-[11px] text-muted hover:text-fg">Fly back to the site</button>
          {mapApi && <button type="button" onClick={() => mapApi.setOrbit(true)} className="ctl flex items-center gap-1 border border-line px-2 py-1 text-[11px] text-muted hover:text-fg"><Icon name="Orbit" className="h-3 w-3" /> Orbit</button>}
          <button type="button" onClick={() => save(toGlb(twinParts(twin), { copyright: twin.sources.map((s) => s.license).join("; ").slice(0, 400) }) as BlobPart, `${slug(twin.name)}-digital-twin.glb`, "model/gltf-binary")} className="ctl flex items-center gap-1 border border-line px-2 py-1 text-[11px] text-muted hover:text-fg" title="The terrain, tanks, stacks and pipelines as a glTF file for Blender or a CAD viewer">
            <Icon name="Download" className="h-3 w-3" /> 3D model (.glb)
          </button>
        </div>
        <div className="mt-2"><Sources sources={twin.sources} /></div>
      </Section>
      <LidarSection twin={twin} target={target} view={view} setView={setView} />
      <AnalysisSection target={target} view={view} setView={setView} />
      <ImagerySection target={target} view={view} setView={setView} mapApi={mapApi} />
    </div>
  );
}

/** Switch each 3D layer that has something to draw on or off. */
function LayerToggles({ view, setView }: { view: TwinView; setView: SetView }) {
  const shown = MAP_LAYERS.filter((d) => d.has(view.scene));
  if (!shown.length) return null;
  const hidden = new Set(view.scene.hidden ?? []);
  return (
    <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="3D layers">
      {shown.map((d) => (
        <button key={d.id} type="button" aria-pressed={!hidden.has(d.id)} title={d.description}
          onClick={() => setView((v) => { const h = new Set(v.scene.hidden ?? []); if (h.has(d.id)) h.delete(d.id); else h.add(d.id); return { ...v, scene: { ...v.scene, hidden: [...h] } }; })}
          className={`rounded-full border px-2 py-0.5 text-[10.5px] ${hidden.has(d.id) ? "border-line text-faint line-through" : "border-accent/40 bg-accent-soft/40 text-accent"}`}>{d.label}</button>
      ))}
    </div>
  );
}

/* ---------------- Lidar ---------------- */

function LidarSection({ twin, target, view, setView }: { twin: DigitalTwin; target: TwinTarget; view: TwinView; setView: SetView }) {
  const [phone] = useState(small);
  const budgets = phone ? [120_000, 250_000] : [250_000, 500_000, 800_000];
  const [budget, setBudget] = useState(budgets[0]);
  const [state, setState] = useState<{ busy: boolean; error: string | null; progress: string }>({ busy: false, error: null, progress: "" });
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const cloud = view.scene.cloud ?? null;

  const stream = async () => {
    setState({ busy: true, error: null, progress: "Finding the survey…" });
    setView((v) => ({ ...v, scene: { ...v.scene, cloud: null } }));
    try {
      let pass = 0, passes = 1;
      while (pass < passes && live.current) {
        const res = await fetch(`/api/edge/lidar?${q(target)}&budget=${budget}&pass=${pass}&km=1.2&survey=${encodeURIComponent(twin.lidar!.survey)}`);
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `The point cloud did not load (${res.status}).`);
        const d = decodePoints(await res.arrayBuffer());
        passes = d.header.passes;
        setView((v) => {
          const prev: Cloud = v.scene.cloud ?? { passes: [], color: "class", pointSize: phone ? 1.6 : 2 };
          return { ...v, scene: { ...v.scene, cloud: { ...prev, passes: [...prev.passes, d] } } };
        });
        pass++;
        setState((s) => ({ ...s, progress: `Pass ${pass} of ${passes}` }));
      }
      setState({ busy: false, error: null, progress: "" });
    } catch (e) {
      setState({ busy: false, error: errText(e), progress: "" });
    }
  };
  const setCloud = (patch: Partial<Cloud>) => setView((v) => (v.scene.cloud ? { ...v, scene: { ...v.scene, cloud: { ...v.scene.cloud, ...patch } } } : v));
  const header = cloud?.passes[0]?.header;
  return (
    <Section title="Lidar point cloud" badge={<PremiumBadge feature="maps.lidar" />}>
      {!twin.lidar ? <p className="text-[11.5px] text-muted">No USGS lidar survey covers this place (3DEP covers the United States; most of it since 2015).</p> : (
        <div className="space-y-2">
          <p className="text-[11.5px] leading-snug text-muted">Every lidar return over 1.2 km of the site from <span className="text-fg">{twin.lidar.survey.replace(/_/g, " ")}</span>, coloured by what it hit, streamed coarse first and lined up with the terrain.</p>
          <div className="flex items-center gap-1" role="radiogroup" aria-label="Point budget">
            {budgets.map((b) => <button key={b} type="button" role="radio" aria-checked={budget === b} onClick={() => setBudget(b)} className={`rounded-full border px-2 py-0.5 text-[10.5px] ${budget === b ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{n0(b / 1000)}k points</button>)}
          </div>
          <FeatureButton feature="maps.lidar" busy={state.busy} onClick={stream}>{state.busy ? state.progress || "Streaming…" : cloud ? "Stream again" : "Stream the point cloud"}</FeatureButton>
          {state.error && <p className="text-[11px] text-neg">{state.error}</p>}
          {cloud && header && (
            <div className="space-y-1.5 text-[11px]">
              <p className="text-muted"><span className="num text-fg">{n0(cloudPoints(cloud))}</span> points, flown {header.year || "?"}{header.truncated ? "; more detail exists than this budget shows (the centre is densest)" : ""}.</p>
              <div className="flex flex-wrap items-center gap-1" role="radiogroup" aria-label="Colour points by">
                {(["class", "height", "intensity"] as CloudColor[]).map((m) => <button key={m} type="button" role="radio" aria-checked={cloud.color === m} onClick={() => setCloud({ color: m })} className={`rounded-full border px-2 py-0.5 text-[10.5px] ${cloud.color === m ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{m === "class" ? "What it hit" : m === "height" ? "Height" : "Intensity"}</button>)}
                <label className="ml-auto flex items-center gap-1 text-muted">Size <input type="range" min={1} max={4} step={0.5} value={cloud.pointSize} onChange={(e) => setCloud({ pointSize: Number(e.target.value) })} className="w-16 accent-[var(--accent)]" aria-label="Point size" /></label>
              </div>
              {cloud.color === "class" && (
                <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted">
                  {CLASS_LEGEND.filter((l) => cloud.passes.some((p) => p.header.classes[String(l.k)])).map((l) => <span key={l.k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: `rgb(${l.color.join(",")})` }} />{l.name}</span>)}
                </div>
              )}
              <button type="button" onClick={() => setView((v) => ({ ...v, scene: { ...v.scene, cloud: null } }))} className="text-[10.5px] text-muted hover:text-fg hover:underline">Remove the point cloud</button>
              <p className="text-[10px] text-faint">USGS 3D Elevation Program lidar (public domain), Entwine Point Tiles on AWS Open Data.</p>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

/* ---------------- Scene analysis ---------------- */

type Kind = "heat" | "landuse" | "cube" | "ai-change" | "footprints";
const KINDS: { kind: Kind; label: string; feature?: string; needsHeat?: boolean }[] = [
  { kind: "heat", label: "This change in 3D", needsHeat: true },
  { kind: "landuse", label: "Land use (machine-learning map)", feature: "maps.scene" },
  { kind: "cube", label: "Change month by month (3D time-lapse)", feature: "maps.scene" },
  { kind: "ai-change", label: "AI change (AlphaEarth embeddings)", feature: "maps.ai-change" },
  { kind: "footprints", label: "Detect footprints (Segment Anything)", feature: "maps.footprints" },
];

function AnalysisSection({ target, view, setView }: { target: TwinTarget; view: TwinView; setView: SetView }) {
  const [busy, setBusy] = useState<Kind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);
  const result = view.scene.analysis ?? null;
  const setResult = (r: SceneResult | null) => setView((v) => ({ ...v, scene: { ...v.scene, analysis: r, analysisUpTo: r?.kind === "cube" ? (r.layers?.length ?? 2) - 2 : undefined } }));

  const run = async (kind: Kind) => {
    setBusy(kind); setError(null);
    try {
      if (kind === "heat") {
        setResult((await api<{ result: SceneResult }>(`/api/edge/scene?detection=${target.detection}&kind=heat`)).result);
      } else {
        const r = await post<{ result?: SceneResult; job?: string }>("/api/edge/scene", { kind, ...body(target) });
        if (r.result) setResult(r.result);
        else if (r.job) {
          // The ML service answers in half a minute to two minutes; ask every five seconds for up to five minutes.
          let done = false;
          for (let tries = 0; tries < 60 && live.current && !done; tries++) {
            await new Promise((ok) => setTimeout(ok, 5000));
            const p = await api<{ result?: SceneResult; pending?: boolean }>(`/api/edge/scene?job=${r.job}`);
            if (p.result) { setResult(p.result); done = true; }
          }
          if (!done && live.current) throw new Error("The analysis is taking longer than usual. Try again in a few minutes; a finished result is kept.");
        }
      }
    } catch (e) {
      if (live.current) setError(errText(e));
    } finally {
      if (live.current) setBusy(null);
    }
  };
  const upTo = view.scene.analysisUpTo ?? 0;
  return (
    <Section title="Scene analysis">
      <div className="space-y-1.5">
        {KINDS.filter((k) => !k.needsHeat || (target.detection && target.heat)).map((k) => k.feature
          ? <FeatureButton key={k.kind} feature={k.feature} busy={busy === k.kind} onClick={() => void run(k.kind)}>{k.label}</FeatureButton>
          : <button key={k.kind} type="button" onClick={() => void run(k.kind)} disabled={busy === k.kind} className={action}>{busy === k.kind && <Icon name="Loader" className="h-3.5 w-3.5 animate-spin" />}{k.label}</button>)}
      </div>
      {busy && (busy === "ai-change" || busy === "footprints") && <p className="mt-1.5 text-[11px] text-muted">Running on the ML service: usually under two minutes. You can keep using the map.</p>}
      {error && <p className="mt-1.5 text-[11px] text-neg">{error}</p>}
      {result && (
        <div className="mt-2 space-y-1.5 text-[11px]">
          <p className="leading-snug">{result.summary}</p>
          {result.kind === "cube" && result.layers && result.layers.length > 1 && (
            <label className="flex items-center gap-2 text-muted">
              <span className="num shrink-0">{result.layers[upTo + 1] ?? ""}</span>
              <input type="range" min={0} max={result.layers.length - 2} value={upTo} onChange={(e) => setView((v) => ({ ...v, scene: { ...v.scene, analysisUpTo: Number(e.target.value) } }))} aria-label="Month" className="w-full accent-[var(--accent)]" />
            </label>
          )}
          <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-[10px] text-muted">
            {result.legend.filter((l) => result.kind !== "landuse" || result.cells.some((c) => c.k === l.k)).map((l) => <span key={l.k} className="flex items-center gap-1"><span className="h-2 w-2 rounded-sm" style={{ background: `rgb(${l.color.join(",")})` }} />{l.label}</span>)}
          </div>
          {result.notes.length > 0 && <p className="text-[10.5px] leading-snug text-muted">{result.notes.join(" ")}</p>}
          <Sources sources={result.source} />
          <button type="button" onClick={() => setResult(null)} className="text-[10.5px] text-muted hover:text-fg hover:underline">Clear the analysis</button>
        </div>
      )}
    </Section>
  );
}

/* ---------------- Imagery: Planet drape and the 3D time-lapse ---------------- */

function ImagerySection({ target, view, setView, mapApi }: { target: TwinTarget; view: TwinView; setView: SetView; mapApi: MapApi | null }) {
  const [planet, setPlanet] = useState<{ busy: boolean; note: string | null }>({ busy: false, note: null });
  const [film, setFilm] = useState<{ busy: boolean; note: string | null; frames: Frame[]; at: number; playing: boolean }>({ busy: false, note: null, frames: [], at: 0, playing: false });
  const box = target.bbox ?? null;
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  const drapePlanet = async () => {
    if (view.planet) { setView((v) => ({ ...v, planet: null })); return; }
    setPlanet({ busy: true, note: null });
    try {
      const res = await fetch(`/api/edge/planet/scenes?${q(target)}`);
      const j = (await res.json().catch(() => ({}))) as { scenes?: { id: string; type: string; acquired: string; cloudPct: number }[]; bbox?: Bbox; off?: boolean; error?: string };
      if (j.off) throw new Error("Planet is not set up on this YouBank yet (an administrator adds the key).");
      if (!res.ok) throw new Error(j.error ?? "Planet did not answer.");
      const s = j.scenes?.[0];
      if (!s || !j.bbox) throw new Error("No Planet scene of this place under 20% cloud in the last 60 days.");
      setView((v) => ({ ...v, planet: { type: s.type, id: s.id, bbox: j.bbox! } }));
      setPlanet({ busy: false, note: `${s.type === "SkySatCollect" ? "SkySat" : "PlanetScope"} scene of ${s.acquired.slice(0, 10)}, ${s.cloudPct}% cloud.` });
    } catch (e) {
      setPlanet({ busy: false, note: errText(e) });
    }
  };

  // Step the draped frames while playing.
  useEffect(() => {
    if (!film.playing || !film.frames.length || !box) return;
    const t = setInterval(() => setFilm((f) => ({ ...f, at: (f.at + 1) % f.frames.length })), 700);
    return () => clearInterval(t);
  }, [film.playing, film.frames.length, box]);
  const frameUrl = film.frames[film.at]?.url ?? null;
  useEffect(() => {
    if (!box) return;
    setView((v) => ({ ...v, drape: frameUrl ? { url: frameUrl, bbox: box } : null }));
  }, [frameUrl, box, setView]);

  const loadFrames = async (size: 384 | 1024) => {
    const { frames } = await api<{ frames: Frame[] }>(`/api/edge/timelapse?detection=${target.detection}${size === 1024 ? "&size=1024" : ""}`);
    if (!frames.length) throw new Error("No clear Sentinel-2 images of this site in the last two years.");
    await preload(frames.map((f) => f.url));
    return frames;
  };
  const play = async () => {
    if (film.frames.length) { setFilm((f) => ({ ...f, playing: !f.playing })); return; }
    setFilm((f) => ({ ...f, busy: true, note: "Loading the months…" }));
    try {
      const frames = await loadFrames(384);
      if (live.current) setFilm({ busy: false, note: null, frames, at: 0, playing: true });
    } catch (e) {
      if (live.current) setFilm((f) => ({ ...f, busy: false, note: errText(e) }));
    }
  };
  const exportVideo = async () => {
    if (!mapApi) return;
    setFilm((f) => ({ ...f, busy: true, playing: false, note: "Loading 1,024-pixel frames…" }));
    try {
      const frames = await loadFrames(1024);
      if (!live.current) return;
      setFilm({ busy: true, note: "Recording: the map turns once while the months play.", frames, at: 0, playing: true });
      mapApi.setOrbit(true);
      const blob = await record(mapApi.canvas(), frames.length * 700 + 800);
      mapApi.setOrbit(false);
      if (!blob) throw new Error("This browser cannot record video from the map (try Chrome, Edge or Firefox).");
      save(blob, `${slug(target.name)}-3d-timelapse.webm`, "video/webm");
      if (live.current) setFilm((f) => ({ ...f, busy: false, playing: false, note: "Saved the video." }));
    } catch (e) {
      if (live.current) setFilm((f) => ({ ...f, busy: false, note: errText(e) }));
    }
  };

  return (
    <Section title="Imagery in 3D">
      <div className="space-y-1.5">
        {target.detection && box && (
          <>
            <button type="button" onClick={() => void play()} disabled={film.busy && !film.frames.length} className={action}>
              <Icon name={film.playing ? "Pause" : "Play"} className="h-3.5 w-3.5" /> {film.playing ? "Pause the time-lapse" : film.frames.length ? "Play the time-lapse" : "Two years of Sentinel-2 on the terrain"}
            </button>
            {film.frames.length > 0 && <p className="text-[11px] text-muted"><span className="num text-fg">{film.frames[film.at]?.month}</span>, the clearest Sentinel-2 image of the month (contains modified Copernicus Sentinel data).</p>}
            <FeatureButton feature="maps.export" busy={film.busy && film.frames.length > 0} onClick={() => void exportVideo()}><Icon name="Video" className="h-3.5 w-3.5" /> Record a 3D video (1,024 px)</FeatureButton>
            {film.frames.length > 0 && <button type="button" onClick={() => { setFilm({ busy: false, note: null, frames: [], at: 0, playing: false }); }} className="text-[10.5px] text-muted hover:text-fg hover:underline">Take the time-lapse off the map</button>}
          </>
        )}
        <FeatureButton feature="maps.planet-drape" busy={planet.busy} onClick={() => void drapePlanet()}><Icon name="Satellite" className="h-3.5 w-3.5" /> {view.planet ? "Remove the Planet imagery" : "Drape Planet imagery (3 m or 50 cm)"}</FeatureButton>
        {(planet.note || film.note) && <p className="text-[11px] text-muted">{[planet.note, film.note].filter(Boolean).join(" ")}</p>}
      </div>
    </Section>
  );
}
