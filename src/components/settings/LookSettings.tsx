"use client";

/**
 * Settings → Style, below the themes: the appearance studio. Size, corners, typeface, accent, background,
 * motion and contrast, each on top of whichever theme is chosen, applied at once and saved to the account
 * (and to a cookie, so the next page's first paint already has it).
 */
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { Icon } from "@/components/ui/Icon";
import { ACCENTS, BACKGROUNDS, DEFAULT_LOOK, FONTS, RADII, SCALES, type LookPrefs } from "@/lib/desk/desk";

const SCALE_LABEL: Record<number, string> = { 0.9: "Compact", 1: "Standard", 1.1: "Large", 1.25: "Larger" };
const RADIUS_LABEL: Record<string, string> = { theme: "Theme's own", square: "Square", soft: "Soft", round: "Round" };
const FONT_LABEL: Record<string, { name: string; sample: string; family: string }> = {
  sans: { name: "Sans", sample: "Aa", family: "var(--font-geist-sans)" },
  serif: { name: "Serif", sample: "Aa", family: "\"Iowan Old Style\", Palatino, Georgia, serif" },
  mono: { name: "Mono", sample: "Aa", family: "var(--font-geist-mono)" },
  system: { name: "System", sample: "Aa", family: "system-ui, -apple-system, sans-serif" },
};
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

export function LookSettings() {
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
        </Row>
        <Row icon="Image" label="Background">
          {BACKGROUNDS.map((b) => <Choice key={b} on={look.background === b} onClick={() => set({ background: b })}>{BG_LABEL[b]}</Choice>)}
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
