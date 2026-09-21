"use client";

import Link from "next/link";
import { useState } from "react";
import { ThemePicker } from "@/components/theme/ThemePicker";
import { ModelPicker, useAiSettings } from "@/components/ai/ModelPicker";
import { useWorkspace } from "./WorkspaceProvider";
import { ROLES } from "@/lib/roles";
import { toolsFor } from "@/lib/workflows/registry";
import { type AiPrefs } from "@/lib/ai/models";
import { Icon } from "@/components/ui/Icon";

const TABS = [
  { id: "style", label: "Style", icon: "Palette" },
  { id: "ai", label: "AI model", icon: "Cpu" },
  { id: "desk", label: "My desk", icon: "Layout" },
  { id: "data", label: "Data and privacy", icon: "Database" },
] as const;
type Tab = (typeof TABS)[number]["id"];

export function SettingsClient({ email, prefs }: { email: string; prefs: AiPrefs }) {
  const [tab, setTab] = useState<Tab>("style");
  const { profile, config } = useWorkspace();
  const { settings, setSettings, status, catalog } = useAiSettings();
  const tools = toolsFor(profile);

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1100px] px-5 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Settings</h1>
            <p className="mt-1 text-[12px] text-muted">{email} · {ROLES[profile.role].label}{profile.specialty ? ` · ${profile.specialty}` : ""}</p>
          </div>
          <Link href="/app" className="text-[11.5px] text-muted hover:text-fg">← Back to home</Link>
        </div>

        <div className="mt-5 flex flex-wrap gap-1.5 border-b border-line pb-3">
          {TABS.map((t) => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)} className={`ctl flex items-center gap-1.5 px-3 py-1.5 text-[12px] transition ${tab === t.id ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>
              <Icon name={t.icon} className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {tab === "style" && (
          <section className="mt-5 rise">
            <h2 className="text-[14px] font-semibold">Interface style</h2>
            <p className="mt-1 max-w-[70ch] text-[12px] text-muted">Fourteen styles, each with its own palette, density, corner radius and glass. Terminal styles are square and dense; modern styles are rounder and softer. Your choice is saved to your account and applies everywhere, including the signed-out pages on this browser.</p>
            <div className="mt-4"><ThemePicker /></div>
          </section>
        )}

        {tab === "ai" && (
          <section className="mt-5 rise">
            <h2 className="text-[14px] font-semibold">Model and reasoning depth</h2>
            <p className="mt-1 max-w-[70ch] text-[12px] text-muted">
              Applies to the assistant and every AI workflow, and can be overridden per run. Deeper reasoning is slower and costs more per answer; use it for models, memos and audits and leave lookups on the quicker setting.
            </p>
            {status && (
              <div className="mt-3 ctl border border-line bg-elevated/60 px-3 py-2 text-[11.5px]">
                <span className={status.configured ? "text-pos" : "text-neg"}>{status.configured ? "Connected" : "Not configured"}</span>
                {status.configured && <span className="num text-muted"> · {status.provider} · {status.model} · {status.effort} reasoning</span>}
                {catalog?.providers?.length ? <span className="text-muted"> · providers available: {catalog.providers.join(", ")}</span> : null}
              </div>
            )}
            <div className="mt-4"><ModelPicker value={{ model: settings.model ?? prefs.model, effort: settings.effort ?? prefs.effort }} onChange={setSettings} /></div>
          </section>
        )}

        {tab === "desk" && (
          <section className="mt-5 rise space-y-4">
            <div>
              <h2 className="text-[14px] font-semibold">Your desk</h2>
              <p className="mt-1 text-[12px] text-muted">Derived from your survey answers. Change the answers to rebuild it.</p>
            </div>
            <dl className="grid gap-3 sm:grid-cols-2">
              {[
                ["Role", ROLES[profile.role].label], ["Specialty", profile.specialty || "—"], ["Level", profile.seniority || "—"], ["Firm type", profile.firmType || "—"],
                ["Firm or school", profile.firmName || "—"], ["Own ticker", profile.firmTicker || "—"], ["Sectors", profile.sectors.join(", ") || "—"], ["Workspace", config.title],
              ].map(([k, v]) => (
                <div key={k} className="panel px-3 py-2"><dt className="text-[10.5px] uppercase tracking-wider text-muted">{k}</dt><dd className="mt-0.5 text-[12.5px]">{v}</dd></div>
              ))}
            </dl>
            <div className="panel p-3">
              <div className="text-[11px] uppercase tracking-wider text-muted">Watchlist</div>
              <div className="mt-2 flex flex-wrap gap-1.5">{config.watchlist.map((t) => <Link key={t} href={`/app/terminal?ticker=${t}`} className="num ctl border border-line px-2 py-0.5 text-[11.5px] hover:border-accent/50 hover:text-accent">{t}</Link>)}</div>
              <div className="mt-3 text-[11px] uppercase tracking-wider text-muted">Tools wired to this desk</div>
              <div className="mt-1 text-[12px] text-muted">{tools.length} total. <Link href="/app/tools" className="text-accent hover:underline">Open the gallery</Link>. Your goals note is passed to the assistant: {profile.goals ? <span className="text-fg">“{profile.goals.slice(0, 200)}”</span> : "not set"}.</div>
            </div>
            <div className="flex gap-2">
              <Link href="/app/profile" className="ctl bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-fg">Retake the survey</Link>
              <Link href="/app/library" className="ctl border border-line px-3 py-1.5 text-[12.5px] text-muted hover:border-accent/50 hover:text-fg">See saved work</Link>
            </div>
          </section>
        )}

        {tab === "data" && (
          <section className="mt-5 rise space-y-3 text-[12.5px] leading-relaxed">
            <h2 className="text-[14px] font-semibold">Data and privacy</h2>
            <p className="max-w-[80ch] text-muted">What YouBank stores for you, and where the numbers come from.</p>
            <dl className="space-y-3">
              {[
                ["Stored on your account", "Survey answers, peer groups, comps sheets, manual estimates, saved workflow runs with their inputs and sources, and your style and model preferences."],
                ["Sent to the model", "Your question, the workspace context (active ticker, open panels, your role persona), and the data the tools return. Anything you paste into a workflow field is sent with that run."],
                ["Public data", "SEC EDGAR filings and XBRL facts, SEC Form D, and public startup directories. Cached to keep the SEC rate limit happy: fundamentals for six hours, filing text for thirty days."],
                ["Market data", "Prices, market caps and 52-week ranges from Financial Modeling Prep. Consensus estimates are not licensed, so next-twelve-month figures are yours to enter and are labelled as manual."],
                ["Not advice", "Everything here is derived from public filings and may be restated by the filer. Check anything that goes into a client deliverable."],
              ].map(([k, v]) => (
                <div key={k} className="border-t border-line pt-3"><dt className="font-semibold">{k}</dt><dd className="mt-1 text-muted">{v}</dd></div>
              ))}
            </dl>
          </section>
        )}
      </div>
    </div>
  );
}
