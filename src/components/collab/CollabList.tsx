"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

type Session = { id: number; title: string; kind: string; refId: string; teamId: number | null; status: string; ownerId: string; updatedAt: string };
type Team = { id: number; name: string };
type Tool = { id: string; title: string; kind: string };

export function CollabList({ needsMigration, me, sessions, teams, tools }: {
  needsMigration: boolean; me: { id: string; name: string }; sessions: Session[]; teams: Team[]; tools: Tool[];
}) {
  const router = useRouter();
  const [toolId, setToolId] = useState(tools[0]?.id ?? "");
  const [teamId, setTeamId] = useState<string>(teams[0] ? String(teams[0].id) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = async () => {
    setBusy(true); setError(null);
    try {
      const tool = tools.find((t) => t.id === toolId);
      const res = await fetch("/api/collab", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "tool", refId: toolId, title: tool?.title ?? "Shared session", teamId: teamId ? Number(teamId) : null }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Could not start a session (${res.status})`);
      router.push(`/app/collab/${(body as { id: number }).id}`);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); setBusy(false); }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1000px] px-5 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Shared sessions</h1>
            <p className="mt-1 max-w-[70ch] text-[12px] text-muted">
              Open the same model with someone else and work on it together. Every change one of you makes appears for the other, and whoever joins later picks it up where it stands.
            </p>
          </div>
          <Link href="/app/team" className="text-[11.5px] text-muted hover:text-fg">Manage teams →</Link>
        </div>

        {needsMigration ? (
          <div className="mt-6 ctl border border-warn/40 bg-warn/5 p-4">
            <h2 className="flex items-center gap-2 text-[14px] font-semibold"><Icon name="AlertTriangle" className="h-4 w-4" /> Not set up yet</h2>
            <p className="mt-2 max-w-[70ch] text-[12px] text-muted">The collaboration tables have not been created. Apply the migration and reload:</p>
            <pre className="num mt-3 overflow-auto ctl border border-line bg-elevated/60 p-3 text-[11.5px]">( set -a; . ./.env.local; set +a; pnpm exec drizzle-kit push )</pre>
            <p className="mt-2 text-[11.5px] text-muted">The statements are in <span className="num">drizzle/0003_collab.sql</span> — three new tables.</p>
          </div>
        ) : (
          <>
            {error && <div className="mt-4 ctl border border-neg/40 bg-neg/5 px-3 py-2 text-[12px] text-neg">{error}</div>}

            <section className="mt-5 ctl border border-line bg-elevated/30 p-3.5">
              <h2 className="text-[13px] font-semibold">Start a session</h2>
              <p className="mt-1 text-[11.5px] text-muted">
                Pick what you want to work on together. Share it with a team and anyone on it can join; leave it unshared and it stays yours.
              </p>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                <select value={toolId} onChange={(e) => setToolId(e.target.value)}
                  className="ctl min-w-[240px] flex-1 border border-line bg-bg/60 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent/60">
                  {tools.map((t) => <option key={t.id} value={t.id}>{t.title}{t.kind === "calc" ? " (calculator)" : ""}</option>)}
                </select>
                <select value={teamId} onChange={(e) => setTeamId(e.target.value)}
                  className="ctl border border-line bg-bg/60 px-2 py-1.5 text-[12px] outline-none focus:border-accent/60">
                  <option value="">Just me</option>
                  {teams.map((t) => <option key={t.id} value={String(t.id)}>{t.name}</option>)}
                </select>
                <button type="button" onClick={start} disabled={busy || !toolId}
                  className="ctl bg-fg px-3 py-1.5 text-[12px] font-semibold text-bg transition hover:bg-white disabled:opacity-50">
                  {busy ? "Starting…" : "Start"}
                </button>
              </div>
              {teams.length === 0 && (
                <p className="mt-2 text-[11px] text-muted">
                  You are not on a team yet, so a session would be yours alone. <Link href="/app/team" className="text-accent hover:underline">Create a team</Link> to work with someone.
                </p>
              )}
            </section>

            <h2 className="mt-6 text-[11px] font-semibold uppercase tracking-wide text-muted">Open sessions</h2>
            <div className="mt-2 flex flex-col gap-1.5">
              {sessions.length === 0 && <p className="text-[12px] text-muted">Nothing yet. Start one above.</p>}
              {sessions.map((s) => (
                <Link key={s.id} href={`/app/collab/${s.id}`}
                  className="ctl flex items-center justify-between gap-3 border border-line bg-elevated/30 px-3 py-2 transition hover:border-accent/50">
                  <span className="min-w-0">
                    <span className="block truncate text-[12.5px] font-semibold">{s.title}</span>
                    <span className="block text-[11px] text-muted">
                      {s.teamId ? (teams.find((t) => t.id === s.teamId)?.name ?? "A team") : "Just you"}
                      {s.ownerId === me.id ? " · you started it" : ""} · updated {new Date(s.updatedAt).toLocaleString()}
                    </span>
                  </span>
                  <Icon name="ChevronRight" className="h-4 w-4 shrink-0 text-muted" />
                </Link>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
