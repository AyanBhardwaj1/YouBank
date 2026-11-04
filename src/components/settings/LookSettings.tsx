"use client";

/**
 * Settings → Style, below the themes: the appearance studio. Size, corners, typeface, accent, background,
 * motion and contrast, each on top of whichever theme is chosen, applied at once and saved to the account
 * (and to a cookie, so the next page's first paint already has it). Above them, saved looks: a style and
 * all of these together under a name, built in or the person's own, applied in one click and shared as a
 * short code anyone can paste.
 */
import { useEffect, useRef, useState } from "react";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { useTheme } from "@/components/theme/ThemeProvider";
import { Icon } from "@/components/ui/Icon";
import { promptDialog } from "@/components/ui/Dialog";
import { THEMES, themeById, type ThemeId } from "@/lib/themes";
import { WALLPAPERS, ACCENTS, BACKGROUNDS, BUILTIN_LOOKS, DEFAULT_LOOK, FONTS, RADII, SCALES, asAccent, lookCode, readLookCode, type LookPrefs, type LookPreset } from "@/lib/desk/desk";

const SCALE_LABEL: Record<number, string> = { 0.9: "Compact", 1: "Standard", 1.1: "Large", 1.25: "Larger" };
const RADIUS_LABEL: Record<string, string> = { theme: "Theme's own", square: "Square", soft: "Soft", round: "Round" };
const FONT_LABEL: Record<string, { name: string; sample: string; family: string }> = {
  sans: { name: "Sans", sample: "Aa", family: "var(--font-geist-sans)" },
  serif: { name: "Serif", sample: "Aa", family: "\"Iowan Old Style\", Palatino, Georgia, serif" },
  mono: { name: "Mono", sample: "Aa", family: "var(--font-geist-mono)" },
  system: { name: "System", sample: "Aa", family: "system-ui, -apple-system, sans-serif" },
};
const WALL_LABEL: Record<string, string> = { none: "None", dawn: "Dawn", dusk: "Dusk", ocean: "Ocean", forest: "Forest", aurora: "Aurora", paper: "Paper" };
const BG_LABEL: Record<string, string> = { theme: "Theme's own", plain: "Plain", mesh: "Glow", grid: "Grid", dots: "Dots" };

function Row({ icon, label, hint, children }: { icon: string; label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-2 border-b border-line py-3 last:border-0 sm:grid-cols-[200px_minmax(0,1fr)] sm:items-center">
      <div className="flex items-start gap-2"><Icon name={icon} className="mt-0.5 h-4 w-4 text-accent" /><div><div className="text-[12.5px] font-medium">{label}</div>{hint && <div className="text-[11px] text-muted">{hint}</div>}</div></div>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function Choice({ on, onClick, children, label }: { on: boolean; onClick: () => void; children: React.ReactNode; label?: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} aria-label={label} onClick={onClick}
      className={`ctl border px-2.5 py-1.5 text-[12px] transition ${on ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:border-accent/50 hover:text-fg"}`}>{children}</button>
  );
}

/** Any colour: the browser's picker, applied after a short pause so dragging through colours saves once. */
function CustomAccent({ value, onPick }: { value: string; onPick: (hex: `#${string}`) => void }) {
  const custom = value !== "theme" && !(ACCENTS as readonly string[]).includes(value);
  const [hex, setHex] = useState(custom ? value : "#ff7a59");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  return (
    <label title="Any colour" className={`relative grid h-7 cursor-pointer place-items-center rounded-full border px-2 text-[10.5px] transition ${custom ? "border-fg text-fg" : "border-line text-muted hover:border-fg/60"}`}>
      <span className="flex items-center gap-1"><span className="h-3.5 w-3.5 rounded-full" style={{ background: custom ? value : "conic-gradient(#f87171,#facc15,#4ade80,#38bdf8,#a78bfa,#f472b6,#f87171)" }} />Custom</span>
      <input type="color" value={hex} aria-label="Pick any accent colour" className="absolute inset-0 cursor-pointer opacity-0"
        onChange={(e) => {
          const v = asAccent(e.target.value);
          if (!v || v === "theme") return;
          setHex(v);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => onPick(v), 250);
        }} />
    </label>
  );
}

function PresetCard({ p, on, onApply, onDelete }: { p: LookPreset; on: boolean; onApply: () => void; onDelete?: () => void }) {
  const t = themeById(p.theme).vars;
  const accent = p.look.accent === "theme" ? t.accent : p.look.accent;
  return (
    <div className={`group relative ctl border transition ${on ? "border-accent" : "border-line hover:border-accent/50"}`}>
      <button type="button" onClick={onApply} className="block w-full p-1.5 text-left" aria-label={`Use the look ${p.name}`}>
        <div className="flex h-12 gap-1 overflow-hidden rounded-[6px] p-1.5" style={{ background: t.bg, backgroundImage: p.look.background === "theme" ? t.bgImage : "none" }}>
          <div className="w-1/3 rounded-[3px]" style={{ background: t.panel, border: `1px solid ${t.line}` }} />
          <div className="flex flex-1 flex-col justify-between rounded-[3px] p-1" style={{ background: t.panel, border: `1px solid ${t.line}` }}>
            <div className="h-1.5 w-2/3 rounded-full" style={{ background: t.muted, opacity: 0.6 }} />
            <div className="h-2.5 w-1/2 rounded-sm" style={{ background: accent }} />
          </div>
        </div>
        <div className="truncate px-0.5 pt-1 text-[11.5px] font-medium">{p.name}</div>
      </button>
      {onDelete && <button type="button" onClick={onDelete} aria-label={`Delete the look ${p.name}`} className="absolute right-1 top-1 hidden h-5 w-5 place-items-center rounded-full bg-raised text-muted hover:text-neg group-hover:grid group-focus-within:grid"><Icon name="X" className="h-3 w-3" /></button>}
    </div>
  );
}

function SavedLooks() {
  const { look, setLook, looks, setLooks } = useWorkspace();
  const { themeId, setTheme } = useTheme();
  const [note, setNote] = useState<string | null>(null);
  const same = (p: LookPreset) => p.theme === themeId && JSON.stringify(p.look) === JSON.stringify(look);
  const apply = (p: LookPreset) => { setTheme(p.theme); setLook(p.look); setNote(null); };
  const save = async () => {
    const name = await promptDialog({ title: "Save this look", label: "Name", placeholder: "e.g. Late nights", confirmLabel: "Save" });
    if (!name?.trim()) return;
    setLooks([...looks.filter((x) => x.name.toLowerCase() !== name.trim().toLowerCase()), { name: name.trim().slice(0, 40), theme: themeId, look }]);
    setNote(`Saved as “${name.trim().slice(0, 40)}”.`);
  };
  const copy = async () => {
    const code = lookCode({ name: "Shared look", theme: themeId, look });
    try { await navigator.clipboard.writeText(code); setNote("Code copied. Anyone can paste it here to get this look."); }
    catch { await promptDialog({ title: "Copy this code", body: "Your browser did not allow copying. Select the code and copy it.", defaultValue: code, confirmLabel: "Done" }); }
  };
  const paste = async () => {
    const code = await promptDialog({ title: "Paste a look code", label: "Code", placeholder: "yb1.…", confirmLabel: "Use it" });
    if (!code) return;
    const p = readLookCode(code);
    if (!p) { setNote("That is not a look code. They start with yb1."); return; }
    apply(p);
    setLooks([...looks.filter((x) => x.name.toLowerCase() !== p.name.toLowerCase()), p]);
    setNote(`Using “${p.name}”, and saved it to your looks.`);
  };
  return (
    <div className="panel mt-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13.5px] font-semibold">Looks</h3>
          <p className="mt-0.5 text-[12px] text-muted">A style and every setting below, in one click. Save your own and share it as a code.</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button type="button" onClick={save} className="ctl bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-accent-fg">Save this look</button>
          <button type="button" onClick={copy} className="ctl border border-line px-2.5 py-1 text-[11.5px] text-muted hover:text-fg">Copy code</button>
          <button type="button" onClick={paste} className="ctl border border-line px-2.5 py-1 text-[11.5px] text-muted hover:text-fg">Paste a code</button>
        </div>
      </div>
      {note && <p role="status" className="mt-2 text-[11.5px] text-muted">{note}</p>}
      {looks.length > 0 && <div className="mt-3 text-[10.5px] uppercase tracking-wider text-muted">Yours</div>}
      {looks.length > 0 && <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">{looks.map((p) => <PresetCard key={p.name} p={p} on={same(p)} onApply={() => apply(p)} onDelete={() => setLooks(looks.filter((x) => x !== p))} />)}</div>}
      <div className="mt-3 text-[10.5px] uppercase tracking-wider text-muted">To start from</div>
      <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">{BUILTIN_LOOKS.map((p) => <PresetCard key={p.name} p={p} on={same(p)} onApply={() => apply(p)} />)}</div>
    </div>
  );
}

export function LookSettings() {
  return <><SavedLooks /><LookStudio /></>;
}

function LookStudio() {
  const { look, setLook } = useWorkspace();
  const set = (p: Partial<LookPrefs>) => setLook(p);
  const changed = (Object.keys(DEFAULT_LOOK) as (keyof LookPrefs)[]).some((k) => look[k] !== DEFAULT_LOOK[k]);
  return (
    <div className="panel mt-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-[13.5px] font-semibold">Make it yours</h3>
          <p className="mt-0.5 text-[12px] text-muted">On top of the style above. Changes apply as you click.</p>
        </div>
        {changed && <button type="button" onClick={() => set(DEFAULT_LOOK)} className="ctl border border-line px-2.5 py-1 text-[11.5px] text-muted hover:text-fg">Back to the style&apos;s defaults</button>}
      </div>
      <div className="mt-2" role="radiogroup">
        <Row icon="Contrast" label="Light and dark" hint="Follow your device's setting, with a style for each">
          <Choice on={!look.system} onClick={() => set({ system: false })}>One style</Choice>
          <Choice on={look.system} onClick={() => set({ system: true })}>Match my system</Choice>
          {look.system && (
            <span className="flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted">
              <label className="flex items-center gap-1">Light
                <select value={look.lightTheme} onChange={(e) => set({ lightTheme: e.target.value as ThemeId })} className="ctl border border-line bg-panel px-1.5 py-1 text-[12px] text-fg">
                  {THEMES.filter((t) => t.mode === "light").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-1">Dark
                <select value={look.darkTheme} onChange={(e) => set({ darkTheme: e.target.value as ThemeId })} className="ctl border border-line bg-panel px-1.5 py-1 text-[12px] text-fg">
                  {THEMES.filter((t) => t.mode === "dark").map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
              </label>
            </span>
          )}
        </Row>
        <Row icon="Maximize2" label="Size" hint="Everything in the app, text and controls">
          {SCALES.map((s) => <Choice key={s} on={look.scale === s} onClick={() => set({ scale: s })}>{SCALE_LABEL[s]}</Choice>)}
        </Row>
        <Row icon="Square" label="Corners">
          {RADII.map((r) => <Choice key={r} on={look.radius === r} onClick={() => set({ radius: r })}>{RADIUS_LABEL[r]}</Choice>)}
        </Row>
        <Row icon="Type" label="Typeface" hint="Figures and tables stay monospaced">
          {FONTS.map((f) => <Choice key={f} label={FONT_LABEL[f].name} on={look.font === f} onClick={() => set({ font: f })}><span aria-hidden style={{ fontFamily: FONT_LABEL[f].family }} className="mr-1.5 text-[13px]">{FONT_LABEL[f].sample}</span>{FONT_LABEL[f].name}</Choice>)}
        </Row>
        <Row icon="Paintbrush" label="Accent" hint="Buttons, links and charts">
          {ACCENTS.map((a) => (
            <button key={a} type="button" role="radio" aria-checked={look.accent === a} aria-label={a === "theme" ? "The style's own accent" : `Accent ${a}`} onClick={() => set({ accent: a })}
              className={`grid h-7 w-7 place-items-center rounded-full border transition ${look.accent === a ? "border-fg" : "border-line hover:border-fg/60"}`}>
              {a === "theme" ? <span className="text-[10px] text-muted">A</span> : <span className="h-5 w-5 rounded-full" style={{ background: a }} />}
            </button>
          ))}
          <CustomAccent value={look.accent} onPick={(hex) => set({ accent: hex })} />
        </Row>
        <Row icon="Image" label="Background">
          {BACKGROUNDS.map((b) => <Choice key={b} on={look.background === b} onClick={() => set({ background: b })}>{BG_LABEL[b]}</Choice>)}
        </Row>
        <Row icon="Sofa" label="Wallpaper" hint="Soft light at the top of Home">
          {WALLPAPERS.map((w) => (
            <Choice key={w} on={look.wallpaper === w} onClick={() => set({ wallpaper: w })} label={`Wallpaper: ${WALL_LABEL[w]}`}>
              <span className="flex items-center gap-1.5">{w !== "none" && <span className={`wall-swatch wall-${w} h-3.5 w-5 rounded-sm border border-line`} aria-hidden />}{WALL_LABEL[w]}</span>
            </Choice>
          ))}
        </Row>
        <Row icon="Move" label="Motion" hint="Reduced also applies when your device asks for it">
          <Choice on={look.motion === "full"} onClick={() => set({ motion: "full" })}>Full</Choice>
          <Choice on={look.motion === "reduced"} onClick={() => set({ motion: "reduced" })}>Reduced</Choice>
        </Row>
        <Row icon="Contrast" label="Contrast" hint="Stronger secondary text and lines">
          <Choice on={look.contrast === "normal"} onClick={() => set({ contrast: "normal" })}>Standard</Choice>
          <Choice on={look.contrast === "high"} onClick={() => set({ contrast: "high" })}>High</Choice>
        </Row>
      </div>
    </div>
  );
}
