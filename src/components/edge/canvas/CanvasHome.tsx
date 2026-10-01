"use client";

/**
 * Canvases: yours and your team's, the starter canvases, and "describe a goal" (the AI builder lays out
 * the blocks and wires for you). Each canvas shows which modules it uses, its last run and whether it
 * is deployed as a monitor.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell, GitBranch, Loader2, Plus, Sparkles, Users, Workflow } from "lucide-react";
import { useRef, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { MODULE_LABEL, NODE, type Module } from "@/lib/edge/canvas/catalog";
import { ago, post, useApi, useNow } from "../client";
import { MODULE_COLOR } from "./colors";

type Summary = { id: number; title: string; description: string; template: string; teamId: number | null; parentId: number | null; branch: string; mine: boolean; updatedAt: string; nodeTypes: string[]; lastRun: { id: number; status: string; at: string } | null; monitor: { schedule: string; active: boolean } | null };
type Home = { canvases: Summary[]; templates: { id: string; title: string; blurb: string; modules: Module[]; ready: boolean }[]; available: string[] };

const IDEAS = [
  "Watch Energy Transfer and Targa's plants from space and brief me on what a merger would combine",
  "Which Permian midstream companies are likely acquirers of Kinetik, and why",
  "Read my uploaded data room and list every risk with where it is stated",
];

export function CanvasHome() {
  const router = useRouter();
  const now = useNow();
  const home = useApi<Home>("/api/edge/canvases");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const goalRef = useRef<HTMLTextAreaElement>(null);
  // The empty state offers the first starter that can run now.
  const starter = home.data?.templates.find((t) => t.ready);

  const create = async (body: Record<string, unknown>, key: string) => {
    setBusy(key); setError(null);
    try {
      const r = await post<{ canvas: { id: number }; dropped?: string[] }>("/api/edge/canvases", body);
      router.push(`/app/edge/canvas/${r.canvas.id}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(null); }
  };

  const stories = useApi<{ stories: { slug: string; title: string; visibility: string; createdAt: string; url: string }[] }>("/api/edge/stories");
  const modulesOf = (types: string[]) => [...new Set(types.map((t) => NODE[t]?.module).filter((m): m is Module => !!m && m !== "source" && m !== "output"))];

  return (
    <div className="space-y-5">
      <form onSubmit={(e) => { e.preventDefault(); if (goal.trim()) void create({ prompt: goal.trim() }, "build"); }} className="panel p-3">
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold"><Sparkles className="h-4 w-4 text-accent" />Describe what you want to find out</label>
        <p className="mt-0.5 text-[11.5px] text-muted">Edge lays out the blocks and wires; you can change anything before running it.</p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <textarea ref={goalRef} value={goal} onChange={(e) => setGoal(e.target.value)} rows={2} placeholder={IDEAS[0]} className="ctl min-h-[44px] flex-1 resize-y border border-line bg-bg px-2.5 py-2 text-[12.5px] outline-none placeholder:text-faint focus:border-accent/60" />
          <button type="submit" disabled={!goal.trim() || !!busy} className="ctl flex items-center justify-center gap-1.5 bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-50 sm:self-start">
            {busy === "build" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />} Build the canvas
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">{IDEAS.slice(1).map((i) => <button key={i} type="button" onClick={() => setGoal(i)} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted hover:text-fg">{i.length > 70 ? `${i.slice(0, 70)}…` : i}</button>)}</div>
        {error && <p className="mt-2 text-[12px] text-neg">{error}</p>}
      </form>

      <section>
        <h2 className="mb-2 text-[12.5px] font-semibold">Start from a template</h2>
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {(home.data?.templates ?? []).map((t) => (
            <button key={t.id} type="button" disabled={!t.ready || !!busy} onClick={() => void create({ template: t.id }, t.id)} className="panel flex flex-col items-start gap-1.5 p-3 text-left transition hover:border-accent/50 disabled:opacity-50">
              <div className="flex gap-1">{t.modules.filter((m) => m !== "output").map((m) => <span key={m} className="h-1.5 w-6 rounded-full" style={{ background: MODULE_COLOR[m] }} title={MODULE_LABEL[m]} />)}</div>
              <span className="text-[13px] font-semibold">{t.title}</span>
              <span className="text-[11.5px] text-muted">{t.blurb}</span>
              <span className="mt-auto text-[11px] text-accent">{busy === t.id ? "Creating…" : t.ready ? "Use this" : "Arrives with its modules"}</span>
            </button>
          ))}
          <button type="button" disabled={!!busy} onClick={() => void create({}, "blank")} className="panel flex flex-col items-center justify-center gap-1 border-dashed p-3 text-[12px] text-muted hover:text-fg"><Plus className="h-4 w-4" />Blank canvas</button>
        </div>
      </section>

      {!!stories.data?.stories.length && (
        <section>
          <h2 className="mb-2 text-[12.5px] font-semibold">Your stories</h2>
          <ul className="flex flex-wrap gap-2">{stories.data.stories.slice(0, 8).map((st) => <li key={st.slug}><Link href={st.url} className="panel flex flex-col px-3 py-2 transition hover:border-accent/50"><span className="text-[12.5px] font-medium">{st.title}</span><span className="text-[10.5px] text-muted">{st.visibility === "link" ? "Published" : st.visibility === "team" ? "Shared with a team" : "Private"}{now ? ` · ${ago(st.createdAt, now)}` : ""}</span></Link></li>)}</ul>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-[12.5px] font-semibold">Your canvases</h2>
        {!home.data ? <div className="h-24 animate-pulse rounded-lg bg-elevated/40" /> : !home.data.canvases.length ? (
          <div className="panel flex flex-col items-center gap-2 px-4 py-8 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent-soft text-accent"><Workflow className="h-5 w-5" /></span>
            <h3 className="text-[13.5px] font-semibold">No canvases yet</h3>
            <p className="max-w-[440px] text-[12px] text-muted">A canvas chains Edge&apos;s modules into one run: pick the companies, watch their sites from space, read their filings and write it up, as blocks you can change and run again.</p>
            <div className="mt-1 flex flex-wrap items-center justify-center gap-2">
              {starter && (
                <button type="button" disabled={!!busy} onClick={() => void create({ template: starter.id }, starter.id)} className="ctl flex items-center gap-1.5 bg-accent px-3 py-1.5 text-[12px] font-semibold text-accent-fg disabled:opacity-50">
                  {busy === starter.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Start with “{starter.title}”
                </button>
              )}
              <button type="button" disabled={!!busy} onClick={() => void create({}, "blank")} className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-fg hover:border-accent/50 disabled:opacity-50">
                {busy === "blank" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Blank canvas
              </button>
              <button type="button" onClick={() => goalRef.current?.focus()} className="px-1 text-[12px] text-accent hover:underline">or describe a goal</button>
            </div>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {home.data.canvases.map((cv) => (
              <Link key={cv.id} href={`/app/edge/canvas/${cv.id}`} className="panel flex flex-col gap-1.5 p-3 transition hover:border-accent/50">
                <div className="flex items-start justify-between gap-2">
                  <span className="text-[13px] font-semibold leading-snug">{cv.title}</span>
                  <span className="flex shrink-0 items-center gap-1 text-muted">{cv.monitor?.active && <Bell className="h-3.5 w-3.5 text-accent" aria-label={`Deployed ${cv.monitor.schedule}`} />}{cv.teamId && <Users className="h-3.5 w-3.5" aria-label="Shared with a team" />}{cv.parentId && <GitBranch className="h-3.5 w-3.5" aria-label="A branch" />}</span>
                </div>
                <div className="flex flex-wrap gap-1">{modulesOf(cv.nodeTypes).map((m) => <span key={m} className="rounded-full px-1.5 py-px text-[10px]" style={{ background: `${MODULE_COLOR[m]}22`, color: MODULE_COLOR[m] }}>{MODULE_LABEL[m]}</span>)}</div>
                <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                  <span className="flex items-center gap-1">{cv.nodeTypes.slice(0, 5).map((t) => NODE[t] && <Icon key={t} name={NODE[t].icon} className="h-3 w-3" />)}</span>
                  <span>{cv.lastRun ? `${cv.lastRun.status === "done" ? "ran" : cv.lastRun.status} ${now ? ago(cv.lastRun.at, now) : ""}` : "not run yet"}</span>
                  {!cv.mine && <span>· shared with you</span>}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
