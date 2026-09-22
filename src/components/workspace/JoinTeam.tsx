"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { ROLE_LABEL, type TeamRole } from "@/lib/teams/roles";

type Joined = { id: number; name: string; role: TeamRole; memberCount: number };

/**
 * Redeems an invitation link. The join is deliberately a button rather than an automatic side
 * effect of opening the page, so a link opened by accident does not add anyone to a team.
 */
export function JoinTeam({ token, email }: { token: string; email: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<Joined | null>(null);

  const join = async () => {
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/teams/join", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Could not join (${res.status})`);
      setJoined(body as Joined);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[560px] px-5 py-12">
        <div className="ctl border border-line bg-elevated/40 p-6">
          {joined ? (
            <>
              <h1 className="flex items-center gap-2 text-[17px] font-semibold tracking-tight"><Icon name="Check" className="h-4 w-4 text-pos" /> You joined {joined.name}</h1>
              <p className="mt-2 text-[12px] text-muted">You are {ROLE_LABEL[joined.role].toLowerCase()} on a team of {joined.memberCount}. Anything the team shares is now on your desk.</p>
              <div className="mt-4 flex gap-2">
                <Link href="/app/team" className="ctl bg-fg px-3 py-1.5 text-[12px] font-semibold text-bg transition hover:bg-white">Open the team</Link>
                <Link href="/app" className="ctl border border-line px-3 py-1.5 text-[12px] text-muted transition hover:text-fg">Go to my desk</Link>
              </div>
            </>
          ) : !token ? (
            <>
              <h1 className="text-[17px] font-semibold tracking-tight">No invitation link</h1>
              <p className="mt-2 text-[12px] text-muted">This page needs an invitation link. Ask whoever invited you to send it again.</p>
              <Link href="/app/team" className="mt-4 inline-block text-[12px] text-accent hover:underline">Back to teams</Link>
            </>
          ) : (
            <>
              <h1 className="text-[17px] font-semibold tracking-tight">You have been invited to a team</h1>
              <p className="mt-2 text-[12px] text-muted">
                You are signed in as <span className="num">{email}</span>. Invitations are tied to the address they were sent to, so if that is not the right account, sign in as the one that was invited.
              </p>
              {error && <div className="mt-3 ctl border border-neg/40 bg-neg/5 px-3 py-2 text-[12px] text-neg">{error}</div>}
              <div className="mt-4 flex gap-2">
                <button type="button" onClick={join} disabled={busy}
                  className="ctl bg-fg px-3 py-1.5 text-[12px] font-semibold text-bg transition hover:bg-white disabled:opacity-60">{busy ? "Joining…" : "Accept invitation"}</button>
                <Link href="/app" className="ctl border border-line px-3 py-1.5 text-[12px] text-muted transition hover:text-fg">Not now</Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
