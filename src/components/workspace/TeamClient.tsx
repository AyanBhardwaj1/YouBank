"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { ROLE_BLURB, ROLE_LABEL, TEAM_ROLES, can, outranks, type TeamRole } from "@/lib/teams/roles";

type Me = { id: string; email: string; name: string };
type Team = { id: number; name: string; slug: string; role: TeamRole; memberCount: number; createdAt: string };
type Member = { userId: string; email: string; name: string; role: TeamRole; joinedAt: string };
type Invite = { id: number; email: string; role: TeamRole; invitedBy: string; expiresAt: string; createdAt: string };
type Detail = { id: number; me: Member; members: Member[]; invites: Invite[] };

const ASSIGNABLE: TeamRole[] = TEAM_ROLES.filter((r) => r !== "owner");

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Request failed (${res.status})`);
  return body as T;
}

export function TeamClient({ me, teams: initialTeams, activeTeamId, needsMigration }: {
  me: Me; teams: Team[]; activeTeamId: number | null; needsMigration: boolean;
}) {
  const [teams, setTeams] = useState<Team[]>(initialTeams);
  const [selected, setSelected] = useState<number | null>(activeTeamId ?? initialTeams[0]?.id ?? null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<TeamRole>("member");
  const [lastLink, setLastLink] = useState<string | null>(null);

  const say = (m: string) => { setNotice(m); setError(null); window.setTimeout(() => setNotice((n) => (n === m ? null : n)), 4000); };

  // Detail is fetched for whichever team is selected; `refresh` re-runs it after a mutation.
  const [refresh, setRefresh] = useState(0);
  const reload = useCallback(() => setRefresh((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (selected === null) { if (!cancelled) setDetail(null); return; }
      try {
        const d = await api<Detail>(`/api/teams/${selected}`);
        if (!cancelled) setDetail(d);
      } catch (e) {
        if (!cancelled) { setDetail(null); setError(e instanceof Error ? e.message : String(e)); }
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [selected, refresh]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError(null);
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const createTeam = () => run(async () => {
    const t = await api<Team>("/api/teams", { method: "POST", body: JSON.stringify({ name: newName }) });
    setTeams((cur) => [...cur, t].sort((a, b) => a.name.localeCompare(b.name)));
    setNewName(""); setSelected(t.id);
    await api("/api/teams/active", { method: "POST", body: JSON.stringify({ teamId: t.id }) }).catch(() => {});
    say(`Created ${t.name}`);
  });

  const invite = () => run(async () => {
    if (selected === null) return;
    const r = await api<{ email: string; url: string }>(`/api/teams/${selected}/members`, { method: "POST", body: JSON.stringify({ email: inviteEmail, role: inviteRole }) });
    setInviteEmail(""); setLastLink(r.url);
    reload();
    say(`Invitation ready for ${r.email}. Copy the link below and send it to them.`);
  });

  const changeRole = (userId: string, role: TeamRole) => run(async () => {
    if (selected === null) return;
    await api(`/api/teams/${selected}/members`, { method: "PATCH", body: JSON.stringify({ userId, role }) });
    reload(); say("Role updated");
  });

  const removeMember = (userId: string, label: string) => run(async () => {
    if (selected === null) return;
    const leaving = userId === me.id;
    if (!window.confirm(leaving ? "Leave this team? You will lose access to everything shared with it." : `Remove ${label} from this team?`)) return;
    await api(`/api/teams/${selected}/members`, { method: "DELETE", body: JSON.stringify({ userId }) });
    if (leaving) {
      setTeams((cur) => cur.filter((t) => t.id !== selected));
      setSelected((cur) => teams.find((t) => t.id !== cur)?.id ?? null);
      say("You left the team");
    } else { reload(); say(`Removed ${label}`); }
  });

  const revokeInvite = (inviteId: number, email: string) => run(async () => {
    if (selected === null) return;
    await api(`/api/teams/${selected}/invites`, { method: "DELETE", body: JSON.stringify({ inviteId }) });
    reload(); say(`Withdrew the invitation to ${email}`);
  });

  const rename = (name: string) => run(async () => {
    if (selected === null || !name.trim()) return;
    await api(`/api/teams/${selected}`, { method: "PATCH", body: JSON.stringify({ name }) });
    setTeams((cur) => cur.map((t) => (t.id === selected ? { ...t, name: name.trim() } : t)));
    say("Team renamed");
  });

  const destroy = (name: string) => run(async () => {
    if (selected === null) return;
    if (window.prompt(`Deleting "${name}" removes it for everyone. Shared work becomes personal again rather than being deleted.\n\nType the team name to confirm:`) !== name) return;
    await api(`/api/teams/${selected}`, { method: "DELETE" });
    setTeams((cur) => cur.filter((t) => t.id !== selected));
    setSelected(null); setDetail(null); say(`Deleted ${name}`);
  });

  const switchTo = (id: number | null) => run(async () => {
    setSelected(id);
    await api("/api/teams/active", { method: "POST", body: JSON.stringify({ teamId: id }) });
  });

  const team = teams.find((t) => t.id === selected) ?? null;
  const myRole = detail?.me.role ?? team?.role ?? "viewer";

  if (needsMigration) {
    return (
      <Shell>
        <div className="mt-6 ctl border border-warn/40 bg-warn/5 p-4">
          <h2 className="flex items-center gap-2 text-[14px] font-semibold"><Icon name="AlertTriangle" className="h-4 w-4" /> Teams are not set up yet</h2>
          <p className="mt-2 max-w-[70ch] text-[12px] text-muted">
            The team tables have not been created in the database. Apply the migration and reload this page:
          </p>
          <pre className="num mt-3 overflow-auto ctl border border-line bg-elevated/60 p-3 text-[11.5px]">pnpm exec drizzle-kit push</pre>
          <p className="mt-2 text-[11.5px] text-muted">The exact statements are in <span className="num">drizzle/0001_teams.sql</span>. They only add tables and nullable columns.</p>
        </div>
      </Shell>
    );
  }

  return (
    <Shell>
      {(error || notice) && (
        <div className={`mt-4 ctl border px-3 py-2 text-[12px] ${error ? "border-neg/40 bg-neg/5 text-neg" : "border-pos/40 bg-pos/5 text-pos"}`}>
          {error ?? notice}
        </div>
      )}

      <div className="mt-5 grid gap-5 lg:grid-cols-[260px_1fr]">
        {/* Teams list */}
        <aside>
          <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Your teams</h2>
          <div className="mt-2 flex flex-col gap-1">
            <button type="button" onClick={() => switchTo(null)}
              className={`ctl flex items-center gap-2 px-2.5 py-2 text-left text-[12px] transition ${selected === null ? "bg-accent-soft text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}>
              <Icon name="Lock" className="h-3.5 w-3.5" /> Personal work
            </button>
            {teams.map((t) => (
              <button key={t.id} type="button" onClick={() => switchTo(t.id)}
                className={`ctl flex items-center justify-between gap-2 px-2.5 py-2 text-left text-[12px] transition ${selected === t.id ? "bg-accent-soft text-accent" : "text-muted hover:bg-elevated hover:text-fg"}`}>
                <span className="flex min-w-0 items-center gap-2"><Icon name="Users" className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{t.name}</span></span>
                <span className="num shrink-0 text-[10.5px] opacity-70">{t.memberCount}</span>
              </button>
            ))}
          </div>

          <div className="mt-4 border-t border-line pt-3">
            <label className="text-[11px] font-semibold uppercase tracking-wide text-muted" htmlFor="new-team">New team</label>
            <div className="mt-2 flex gap-1.5">
              <input id="new-team" value={newName} onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) createTeam(); }}
                placeholder="Deal team" maxLength={80}
                className="ctl min-w-0 flex-1 border border-line bg-elevated/60 px-2 py-1.5 text-[12px] outline-none focus:border-accent/60" />
              <button type="button" onClick={createTeam} disabled={busy || !newName.trim()}
                className="ctl bg-fg px-2.5 py-1.5 text-[12px] font-semibold text-bg transition hover:bg-white disabled:opacity-50">Create</button>
            </div>
          </div>
        </aside>

        {/* Detail */}
        <section className="min-w-0">
          {selected === null ? (
            <div className="ctl border border-line bg-elevated/40 p-5">
              <h2 className="text-[14px] font-semibold">Personal work</h2>
              <p className="mt-1.5 max-w-[70ch] text-[12px] text-muted">
                Everything you build is private to you unless you share it with a team. Create a team to work on the same LBO, comps sheet or pitch with other people.
              </p>
            </div>
          ) : !detail ? (
            <div className="ctl border border-line bg-elevated/40 p-5 text-[12px] text-muted">Loading team…</div>
          ) : (
            <>
              <header className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-[16px] font-semibold tracking-tight">{team?.name}</h2>
                  <p className="mt-0.5 text-[11.5px] text-muted">
                    {detail.members.length} {detail.members.length === 1 ? "member" : "members"} · you are {ROLE_LABEL[myRole].toLowerCase()}
                  </p>
                </div>
                {can(myRole, "invite") && (
                  <button type="button" disabled={busy}
                    onClick={() => { const n = window.prompt("Rename team", team?.name ?? ""); if (n) rename(n); }}
                    className="ctl border border-line px-2.5 py-1.5 text-[11.5px] text-muted transition hover:border-accent/50 hover:text-fg disabled:opacity-50">Rename</button>
                )}
              </header>

              {/* Members */}
              <div className="mt-4 ctl overflow-hidden border border-line">
                <table className="w-full text-[12px]">
                  <thead className="bg-elevated/60 text-[10.5px] uppercase tracking-wide text-muted">
                    <tr><th className="px-3 py-2 text-left font-semibold">Member</th><th className="px-3 py-2 text-left font-semibold">Role</th><th className="px-3 py-2" /></tr>
                  </thead>
                  <tbody>
                    {detail.members.map((m) => {
                      const isMe = m.userId === me.id;
                      const mayEdit = can(myRole, "invite") && !isMe && outranks(myRole, m.role);
                      return (
                        <tr key={m.userId} className="border-t border-line">
                          <td className="px-3 py-2">
                            <div className="truncate font-medium">{m.name || m.email || m.userId}{isMe && <span className="ml-1.5 text-[10.5px] text-muted">(you)</span>}</div>
                            {m.name && m.email && <div className="truncate text-[11px] text-muted">{m.email}</div>}
                          </td>
                          <td className="px-3 py-2">
                            {mayEdit ? (
                              <select value={m.role} disabled={busy} onChange={(e) => changeRole(m.userId, e.target.value as TeamRole)}
                                className="ctl border border-line bg-elevated/60 px-1.5 py-1 text-[11.5px] outline-none focus:border-accent/60">
                                {ASSIGNABLE.filter((r) => outranks(myRole, r)).map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                              </select>
                            ) : (
                              <span className="text-muted" title={ROLE_BLURB[m.role]}>{ROLE_LABEL[m.role]}</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {(isMe || mayEdit) && (
                              <button type="button" disabled={busy} onClick={() => removeMember(m.userId, m.name || m.email)}
                                className="text-[11.5px] text-muted transition hover:text-neg disabled:opacity-50">{isMe ? "Leave" : "Remove"}</button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Invites */}
              {can(myRole, "invite") && (
                <div className="mt-5">
                  <h3 className="text-[13px] font-semibold">Invite someone</h3>
                  <p className="mt-1 max-w-[70ch] text-[11.5px] text-muted">
                    Invitations are links. Send the link to your colleague; they join when they open it while signed in as that address. Links expire after 14 days.
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    <input value={inviteEmail} onChange={(e) => setInviteEmail(e.target.value)} type="email" placeholder="colleague@firm.com"
                      onKeyDown={(e) => { if (e.key === "Enter" && inviteEmail.trim()) invite(); }}
                      className="ctl min-w-[220px] flex-1 border border-line bg-elevated/60 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent/60" />
                    <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as TeamRole)}
                      className="ctl border border-line bg-elevated/60 px-2 py-1.5 text-[12px] outline-none focus:border-accent/60">
                      {ASSIGNABLE.filter((r) => outranks(myRole, r) || myRole === "owner").map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                    </select>
                    <button type="button" onClick={invite} disabled={busy || !inviteEmail.trim()}
                      className="ctl bg-fg px-3 py-1.5 text-[12px] font-semibold text-bg transition hover:bg-white disabled:opacity-50">Create invite</button>
                  </div>
                  <p className="mt-1.5 text-[11px] text-muted">{ROLE_BLURB[inviteRole]}</p>

                  {lastLink && (
                    <div className="mt-3 ctl border border-accent/40 bg-accent-soft/40 p-2.5">
                      <div className="text-[11px] font-semibold text-accent">Invitation link</div>
                      <div className="mt-1.5 flex gap-1.5">
                        <input readOnly value={lastLink} onFocus={(e) => e.currentTarget.select()}
                          className="num ctl min-w-0 flex-1 border border-line bg-bg/60 px-2 py-1 text-[11px] outline-none" />
                        <button type="button" onClick={() => { void navigator.clipboard?.writeText(lastLink).then(() => say("Link copied")); }}
                          className="ctl border border-line px-2 py-1 text-[11px] transition hover:border-accent/50">Copy</button>
                      </div>
                    </div>
                  )}

                  {detail.invites.length > 0 && (
                    <div className="mt-3.5">
                      <h4 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Pending</h4>
                      <ul className="mt-1.5 flex flex-col gap-1">
                        {detail.invites.map((i) => (
                          <li key={i.id} className="ctl flex items-center justify-between gap-3 border border-line bg-elevated/40 px-2.5 py-1.5 text-[11.5px]">
                            <span className="min-w-0 truncate">{i.email} <span className="text-muted">· {ROLE_LABEL[i.role]} · expires {new Date(i.expiresAt).toLocaleDateString()}</span></span>
                            <button type="button" disabled={busy} onClick={() => revokeInvite(i.id, i.email)}
                              className="shrink-0 text-muted transition hover:text-neg disabled:opacity-50">Withdraw</button>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              )}

              {can(myRole, "deleteTeam") && (
                <div className="mt-6 border-t border-line pt-3.5">
                  <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Danger zone</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <button type="button" disabled={busy} onClick={() => destroy(team?.name ?? "")}
                      className="ctl border border-neg/40 px-2.5 py-1.5 text-[11.5px] text-neg transition hover:bg-neg/10 disabled:opacity-50">Delete this team</button>
                    <span className="text-[11px] text-muted">Shared work becomes personal again; nothing is deleted with it.</span>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[1100px] px-5 py-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-[20px] font-semibold tracking-tight">Team</h1>
            <p className="mt-1 max-w-[70ch] text-[12px] text-muted">Work on the same models, comps and pitches with other people. Anything you share with a team is visible to everyone on it.</p>
          </div>
          <Link href="/app" className="text-[11.5px] text-muted hover:text-fg">← Back to home</Link>
        </div>
        {children}
      </div>
    </div>
  );
}
