"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ROLES, SECTORS, type Profile, type RoleId } from "@/lib/roles";
import { THEMES, isThemeId, type ThemeId } from "@/lib/themes";
import { ThemeThumb } from "@/components/theme/ThemePicker";
import { useTheme } from "@/components/theme/ThemeProvider";
import { toolsForRole } from "@/lib/workflows/registry";
import { Icon } from "@/components/ui/Icon";

type Draft = Profile;
const EMPTY: Draft = { role: "banker", specialty: "", seniority: "", firmType: "", firmName: "", firmTicker: "", sectors: [], goals: "" };
const ROLE_ICON: Record<RoleId, string> = { banker: "Landmark", pe: "Briefcase", vc: "Rocket", markets: "LineChart", corpfin: "Building2", consultant: "Compass", accountant: "Receipt", student: "GraduationCap" };

export function OnboardingWizard({ initial, userName }: { initial: Partial<Profile> | null; userName: string }) {
  const router = useRouter();
  const { themeId, setTheme, preview } = useTheme();
  const [d, setD] = useState<Draft>({ ...EMPTY, ...(initial ?? {}) });
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const role = ROLES[d.role];
  const steps = ["Role", role.specialtyLabel, "Experience", "Focus", "Style", "Goals"];
  const toolCount = toolsForRole(d.role).length;

  const pickRole = (id: RoleId) => {
    setD({ ...d, role: id, specialty: "", seniority: "", firmType: "" });
    if (isThemeId(ROLES[id].defaultTheme)) setTheme(ROLES[id].defaultTheme as ThemeId);
  };

  const submit = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/profile", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(d) });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? `HTTP ${res.status}`);
      await fetch("/api/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ theme: themeId }) }).catch(() => {});
      router.push("/app");
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  const Chip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
    <button type="button" onClick={onClick}
      className={`ctl border px-3 py-2 text-left text-[12.5px] transition ${active ? "border-accent bg-accent-soft text-fg" : "border-line bg-panel text-fg/85 hover:border-accent/50"}`}>
      {children}
    </button>
  );

  const canNext = step === 0 ? true : step === 1 ? !!d.specialty : step === 2 ? !!d.seniority : true;

  return (
    <div className="w-full max-w-3xl">
      <div className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted">
        {steps.map((s, i) => (
          <span key={s} className={`flex items-center gap-2 ${i === step ? "text-accent" : i < step ? "text-fg" : ""}`}>
            <span className={`grid h-5 w-5 place-items-center rounded-full border text-[10px] ${i <= step ? "border-accent" : "border-line"}`}>{i < step ? "✓" : i + 1}</span>{s}
            {i < steps.length - 1 && <span className="mx-1 hidden h-px w-6 bg-line sm:block" />}
          </span>
        ))}
      </div>

      {step === 0 && (
        <div className="rise">
          <h1 className="text-[24px] font-semibold tracking-tight">Welcome{userName ? `, ${userName.split(" ")[0]}` : ""}. What do you do?</h1>
          <p className="mt-1 text-[12.5px] text-muted">This decides your data, watchlists, function keys, prompt library and tool shelf. You can change it whenever.</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {(Object.keys(ROLES) as RoleId[]).map((id) => (
              <Chip key={id} active={d.role === id} onClick={() => pickRole(id)}>
                <div className="flex items-center gap-2">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center ctl ${d.role === id ? "bg-accent text-accent-fg" : "bg-accent-soft text-accent"}`}><Icon name={ROLE_ICON[id]} className="h-4 w-4" /></span>
                  <span className="min-w-0">
                    <span className="block font-semibold">{ROLES[id].label}</span>
                    <span className="block text-[11.5px] text-muted">{ROLES[id].blurb}</span>
                  </span>
                </div>
              </Chip>
            ))}
          </div>
        </div>
      )}

      {step === 1 && (
        <div className="rise">
          <h1 className="text-[24px] font-semibold tracking-tight">{role.specialtyLabel}</h1>
          <p className="mt-1 text-[12.5px] text-muted">Pick the closest match. This is what makes the tools specific rather than generic.</p>
          <div className="mt-5 grid gap-2 sm:grid-cols-2">
            {role.specialties.map((s) => <Chip key={s} active={d.specialty === s} onClick={() => setD({ ...d, specialty: s })}>{s}</Chip>)}
          </div>
        </div>
      )}

      {step === 2 && (
        <div className="rise">
          <h1 className="text-[24px] font-semibold tracking-tight">Experience and firm</h1>
          <p className="mt-1 text-[12.5px] text-muted">Level changes the register of what the assistant writes: analyst mechanics or partner-ready conclusions.</p>
          <div className="mt-5 text-[11px] uppercase tracking-wider text-muted">Level</div>
          <div className="mt-2 flex flex-wrap gap-2">{role.seniorities.map((s) => <Chip key={s} active={d.seniority === s} onClick={() => setD({ ...d, seniority: s })}>{s}</Chip>)}</div>
          <div className="mt-5 text-[11px] uppercase tracking-wider text-muted">Firm type</div>
          <div className="mt-2 flex flex-wrap gap-2">{role.firmTypes.map((s) => <Chip key={s} active={d.firmType === s} onClick={() => setD({ ...d, firmType: s })}>{s}</Chip>)}</div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="text-[11px] uppercase tracking-wider text-muted">Firm or school (optional)
              <input value={d.firmName} onChange={(e) => setD({ ...d, firmName: e.target.value })} placeholder="e.g. Moelis, UT Austin"
                className="ctl mt-1 block w-full border border-line bg-bg px-3 py-2 text-[13px] normal-case tracking-normal text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none" />
            </label>
            {role.askFirmTicker && (
              <label className="text-[11px] uppercase tracking-wider text-muted">Your company&apos;s ticker (if public)
                <input value={d.firmTicker} onChange={(e) => setD({ ...d, firmTicker: e.target.value.toUpperCase() })} placeholder="e.g. NOW"
                  className="num ctl mt-1 block w-full border border-line bg-bg px-3 py-2 text-[13px] tracking-normal text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none" />
              </label>
            )}
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="rise">
          <h1 className="text-[24px] font-semibold tracking-tight">Sectors you cover</h1>
          <p className="mt-1 text-[12.5px] text-muted">These seed your watchlist, peer groups and benchmarks. Choose any number.</p>
          <div className="mt-5 flex flex-wrap gap-2">
            {SECTORS.map((s) => <Chip key={s} active={d.sectors.includes(s)} onClick={() => setD({ ...d, sectors: d.sectors.includes(s) ? d.sectors.filter((x) => x !== s) : [...d.sectors, s] })}>{s}</Chip>)}
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="rise" onMouseLeave={() => preview(null)}>
          <h1 className="text-[24px] font-semibold tracking-tight">Pick your interface</h1>
          <p className="mt-1 text-[12.5px] text-muted">Hover to preview, click to keep. Terminal styles are dense and square; modern styles are rounder and lighter. We started you on the one most people in your seat pick.</p>
          <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {THEMES.map((t) => (
              <button key={t.id} type="button" onMouseEnter={() => preview(t.id)} onFocus={() => preview(t.id)} onClick={() => setTheme(t.id)}
                className={`lift ctl border p-1.5 text-left ${t.id === themeId ? "border-accent bg-accent-soft" : "border-line bg-panel"}`} title={t.tagline}>
                <ThemeThumb theme={t} active={t.id === themeId} size="sm" />
                <div className="flex items-baseline justify-between px-0.5 pt-1"><span className={`text-[11.5px] font-semibold ${t.id === themeId ? "text-accent" : ""}`}>{t.name}</span><span className="text-[9px] uppercase tracking-wider text-muted">{t.mode}</span></div>
              </button>
            ))}
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="rise">
          <h1 className="text-[24px] font-semibold tracking-tight">What should YouBank do for you?</h1>
          <p className="mt-1 text-[12.5px] text-muted">A sentence or two. The assistant reads this on every answer.</p>
          <textarea value={d.goals} onChange={(e) => setD({ ...d, goals: e.target.value })} rows={4}
            placeholder={d.role === "vc" ? "e.g. Source seed-stage fintech founders in Africa, track my portfolio's competitors, prep for partner meetings" : d.role === "accountant" ? "e.g. Draft technical memos faster, benchmark disclosures against peers, flag quality-of-earnings issues" : "e.g. Turn comps faster, draft pitch pages, check filings for one-time items"}
            className="ctl mt-4 block w-full border border-line bg-bg px-3 py-2 text-[13px] text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none" />
          <div className="mt-4 panel p-3 text-[12px]">
            <div className="text-[10.5px] uppercase tracking-wider text-muted">Your desk</div>
            <div className="mt-1"><span className="font-semibold text-fg">{role.label}</span> · {d.specialty || "—"} · {d.seniority || "—"} · {d.firmType || "—"}{d.firmName ? ` · ${d.firmName}` : ""}{d.sectors.length ? ` · ${d.sectors.join(", ")}` : ""}</div>
            <div className="mt-1 text-muted">{toolCount} tools wired to this seat, plus the terminal, the assistant and the shared toolkit. Style: {THEMES.find((t) => t.id === themeId)?.name}.</div>
          </div>
        </div>
      )}

      {error && <div className="mt-4 text-[12px] text-neg">{error}</div>}
      <div className="mt-8 flex items-center justify-between">
        <button type="button" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0} className="text-[12px] text-muted hover:text-fg disabled:opacity-40">← Back</button>
        {step < steps.length - 1 ? (
          <button type="button" onClick={() => setStep((s) => s + 1)} disabled={!canNext} className="ctl bg-accent px-4 py-2 text-[13px] font-semibold text-accent-fg transition hover:brightness-110 disabled:opacity-40">Continue</button>
        ) : (
          <button type="button" onClick={submit} disabled={busy} className="ctl glow bg-accent px-4 py-2 text-[13px] font-semibold text-accent-fg disabled:opacity-60">{busy ? "Setting up…" : "Open my workspace"}</button>
        )}
      </div>
    </div>
  );
}
