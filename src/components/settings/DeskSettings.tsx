"use client";

/**
 * Settings → My desk: let YouBank set the workspace up (from the survey, or from the person's own words),
 * then change any of it: which features are in the navigation, how Home is laid out, which widgets it
 * shows and in what order. Every change applies at once (WorkspaceProvider) and is saved to the account.
 */
import { useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { useNav } from "@/components/workspace/NavContext";
import { Icon } from "@/components/ui/Icon";
import { FEATURES, type NavId } from "@/lib/nav";
import { CORE_FEATURES, LAYOUTS, WIDGET_HINT, WIDGET_LABEL, type DeskPrefs, type HomeLayout } from "@/lib/desk/desk";
import { errorMessage } from "@/lib/client/errors";

const LAYOUT_INFO: Record<HomeLayout, { name: string; icon: string; blurb: string }> = {
  focus: { name: "Focus", icon: "Focus", blurb: "One question box and only what needs you. Quiet." },
  home: { name: "Home", icon: "Sofa", blurb: "A calm, roomy page for the day: larger type, cards, your agenda first." },
  desk: { name: "Desk", icon: "LayoutGrid", blurb: "Everything at once, dense, in two columns." },
};

function LayoutSketch({ layout }: { layout: HomeLayout }) {
  const bar = "rounded-sm bg-line";
  if (layout === "focus") return <div className="flex h-14 flex-col items-center gap-1 p-2"><div className={`${bar} h-2 w-1/2`} /><div className="h-2.5 w-3/4 rounded-sm bg-accent/40" /><div className={`${bar} h-2 w-3/4`} /><div className={`${bar} h-2 w-3/4`} /></div>;
  if (layout === "home") return <div className="flex h-14 flex-col gap-1 p-2"><div className="h-4 rounded-sm bg-accent/30" /><div className="grid flex-1 grid-cols-2 gap-1"><div className={bar} /><div className={bar} /></div></div>;
  return <div className="grid h-14 grid-cols-[2fr_1fr] gap-1 p-2"><div className="flex flex-col gap-1"><div className={`${bar} h-3`} /><div className={`${bar} flex-1`} /></div><div className="flex flex-col gap-1"><div className={`${bar} h-2`} /><div className={`${bar} h-2`} /><div className={`${bar} h-2`} /></div></div>;
}

export function DeskSettings() {
  const { profile, desk, setDesk } = useWorkspace();
  const nav = useNav();
  const [words, setWords] = useState("");
  const [busy, setBusy] = useState<"words" | "survey" | null>(null);
  const [result, setResult] = useState<{ reasons: string[]; via: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const features = FEATURES.filter((f) => !CORE_FEATURES.includes(f.id) && (!f.roles || f.roles.includes(profile.role)));
  const toggleFeature = (id: NavId) => setDesk({ hidden: desk.hidden.includes(id) ? desk.hidden.filter((x) => x !== id) : [...desk.hidden, id] });
  const move = (i: number, by: number) => {
    const w = [...desk.widgets];
    const j = i + by;
    if (j < 0 || j >= w.length) return;
    [w[i], w[j]] = [w[j], w[i]];
    setDesk({ widgets: w });
  };

  const setUp = async (from: "words" | "survey") => {
    setBusy(from); setError(null); setResult(null);
    try {
      const res = await fetch("/api/desk/setup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ words: from === "words" ? words : "" }) });
      const d = (await res.json().catch(() => ({}))) as { desk?: DeskPrefs; pinned?: NavId[]; reasons?: string[]; via?: string; error?: string };
      if (!res.ok || !d.desk) throw new Error(d.error ?? "Your desk could not be set up just now. Try again in a minute.");
      // Saved on the server already: show it here without saving it again.
      setDesk({ ...d.desk, source: d.desk.source });
      if (d.pinned) nav.update({ pinned: d.pinned }, { persist: false });
      setResult({ reasons: d.reasons ?? [], via: d.via ?? "rules" });
    } catch (e) {
      setError(errorMessage(e));
    } finally { setBusy(null); }
  };

  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="flex items-center gap-2"><Icon name="Wand2" className="h-4 w-4 text-accent" /><h3 className="text-[13.5px] font-semibold">Set up my desk for me</h3></div>
        <p className="mt-1 max-w-[72ch] text-[12px] text-muted">Tell YouBank how you work and it picks your features, your Home layout and its widgets. You can change anything afterwards, below.</p>
        <textarea value={words} onChange={(e) => setWords(e.target.value)} rows={3} maxLength={1500}
          placeholder="e.g. I run a two-person search fund. Mostly sourcing companies and outreach to owners, some LBO models. Keep it calm and simple."
          className="ctl mt-3 w-full border border-line bg-panel px-2.5 py-2 text-[12.5px] text-fg outline-none placeholder:text-faint focus:border-accent" />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" disabled={!!busy || !words.trim()} onClick={() => setUp("words")} className="ctl bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50">{busy === "words" ? "Setting up…" : "Set it up from this"}</button>
          <button type="button" disabled={!!busy} onClick={() => setUp("survey")} className="ctl border border-line px-3 py-1.5 text-[12.5px] text-muted hover:text-fg disabled:opacity-50">{busy === "survey" ? "Setting up…" : "Reset from my survey"}</button>
          <span className="text-[11px] text-faint">{desk.setupAt ? `Last set up ${new Date(desk.setupAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}${desk.source === "you" ? ", then changed by you" : desk.source === "ai" ? " from your words" : " from your survey"}.` : "Set up from your role."}</span>
        </div>
        {error && <p role="alert" className="mt-2 text-[12px] text-neg">{error}</p>}
        {result && (
          <ul className="mt-3 space-y-1 border-t border-line pt-3 text-[12px] text-muted">
            {result.reasons.map((r, i) => <li key={i} className="flex gap-2"><Icon name="Check" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-pos" />{r}</li>)}
          </ul>
        )}
      </div>

      <div className="panel p-4">
        <h3 className="text-[13.5px] font-semibold">Features</h3>
        <p className="mt-1 text-[12px] text-muted">What appears in your navigation. A feature you switch off keeps its data and still opens from a link.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {features.map((f) => {
            const on = !desk.hidden.includes(f.id);
            return (
              <button key={f.id} type="button" role="switch" aria-checked={on} onClick={() => toggleFeature(f.id)}
                className={`ctl flex items-start gap-2.5 border px-3 py-2 text-left transition ${on ? "border-accent/50 bg-accent-soft/40" : "border-line opacity-70 hover:opacity-100"}`}>
                <Icon name={f.icon} className={`mt-0.5 h-4 w-4 shrink-0 ${on ? "text-accent" : "text-muted"}`} />
                <span className="min-w-0"><span className="block text-[12.5px] font-medium text-fg">{f.label}</span><span className="block text-[11px] text-muted">{f.blurb}</span></span>
                <span className={`ml-auto mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition ${on ? "bg-accent" : "bg-line"}`}><span className={`block h-3 w-3 rounded-full bg-bg transition ${on ? "translate-x-3" : ""}`} /></span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="panel p-4">
        <h3 className="text-[13.5px] font-semibold">Home layout</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="Home layout">
          {LAYOUTS.map((l) => (
            <button key={l} type="button" role="radio" aria-checked={desk.layout === l} onClick={() => setDesk({ layout: l })}
              className={`ctl border p-2 text-left transition ${desk.layout === l ? "border-accent bg-accent-soft/40" : "border-line hover:border-accent/50"}`}>
              <div className="ctl border border-line bg-bg"><LayoutSketch layout={l} /></div>
              <div className="mt-2 flex items-center gap-1.5 text-[12.5px] font-medium"><Icon name={LAYOUT_INFO[l].icon} className="h-3.5 w-3.5 text-accent" />{LAYOUT_INFO[l].name}</div>
              <div className="text-[11px] text-muted">{LAYOUT_INFO[l].blurb}</div>
            </button>
          ))}
        </div>
      </div>

      <div className="panel p-4">
        <h3 className="text-[13.5px] font-semibold">Home widgets</h3>
        <p className="mt-1 text-[12px] text-muted">Switch widgets on or off and put them in the order you want them.</p>
        <ul className="mt-3 divide-y divide-line">
          {desk.widgets.map((w, i) => (
            <li key={w.id} className="flex items-center gap-2 py-1.5">
              <button type="button" role="switch" aria-checked={w.on} aria-label={`${WIDGET_LABEL[w.id]} ${w.on ? "on" : "off"}`}
                onClick={() => setDesk({ widgets: desk.widgets.map((x) => (x.id === w.id ? { ...x, on: !x.on } : x)) })}
                className={`h-4 w-7 shrink-0 rounded-full p-0.5 transition ${w.on ? "bg-accent" : "bg-line"}`}><span className={`block h-3 w-3 rounded-full bg-bg transition ${w.on ? "translate-x-3" : ""}`} /></button>
              <span className={`min-w-0 flex-1 ${w.on ? "" : "opacity-60"}`}><span className="text-[12.5px] text-fg">{WIDGET_LABEL[w.id]}</span><span className="ml-2 text-[11px] text-muted max-sm:hidden">{WIDGET_HINT[w.id]}</span></span>
              <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${WIDGET_LABEL[w.id]} up`} className="ctl p-1 text-muted hover:text-fg disabled:opacity-30"><Icon name="ArrowUp" className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={() => move(i, 1)} disabled={i === desk.widgets.length - 1} aria-label={`Move ${WIDGET_LABEL[w.id]} down`} className="ctl p-1 text-muted hover:text-fg disabled:opacity-30"><Icon name="ArrowDown" className="h-3.5 w-3.5" /></button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
