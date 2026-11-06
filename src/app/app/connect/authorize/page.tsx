import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Icon } from "@/components/ui/Icon";
import { currentUser } from "@/lib/auth/user";
import { originOf } from "@/lib/mcp/http";
import { parseAuthorize } from "@/lib/mcp/oauth";
import { getClient } from "@/lib/mcp/oauth-store";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect an AI app", robots: { index: false } };

type Q = Record<string, string | string[] | undefined>;

function Problem({ text }: { text: string }) {
  return (
    <div className="mx-auto mt-16 max-w-md panel p-6 text-[13px]">
      <h1 className="text-[15px] font-semibold">This connection cannot go ahead</h1>
      <p className="mt-2 text-muted">{text}</p>
      <p className="mt-2 text-muted">Start again from the AI app. If it keeps happening, the app may not support YouBank&apos;s sign-in yet: make a key in Settings → Connect AI apps instead.</p>
    </div>
  );
}

/**
 * OAuth consent for MCP (src/lib/mcp/oauth.ts): an AI app asks to use YouBank's research tools as this
 * person. Shows who is asking, where the person will be sent back, and what the app will and will not be
 * able to do; the answer posts to /api/oauth/authorize. Signed out, the app's sign-in brings the person
 * back here (this is under /app).
 */
export default async function Authorize({ searchParams }: { searchParams: Promise<Q> }) {
  const user = await currentUser();
  const sp = await searchParams;
  const q = Object.fromEntries(Object.entries(sp).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  if (!user) redirect(`/sign-in?next=${encodeURIComponent(`/app/connect/authorize?${new URLSearchParams(q as Record<string, string>).toString()}`)}`);
  const origin = originOf(await headers());
  const parsed = parseAuthorize(q, origin);
  if ("error" in parsed) return <Problem text={`The request is not valid: ${parsed.error}.`} />;
  const client = await getClient(parsed.req.client_id).catch(() => null);
  if (!client) return <Problem text="YouBank does not know this app: it did not register, or its client information could not be read." />;
  if (!client.redirect_uris.includes(parsed.req.redirect_uri)) return <Problem text="The address the app asked to be sent back to is not one it registered." />;
  const back = new URL(parsed.req.redirect_uri);
  const hidden = { response_type: "code", client_id: parsed.req.client_id, redirect_uri: parsed.req.redirect_uri, state: parsed.req.state, code_challenge: parsed.req.code_challenge, code_challenge_method: "S256", resource: parsed.req.resource };
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto mt-10 max-w-md panel p-6 text-[13px]">
        <div className="flex items-center gap-2"><Icon name="Bot" className="h-5 w-5 text-accent" /><h1 className="text-[16px] font-semibold">Connect {client.client_name} to YouBank?</h1></div>
        <p className="mt-2 text-muted">{client.client_name} asks to use YouBank&apos;s research tools as <span className="text-fg">{user.email}</span>. You will be sent back to <span className="num text-fg">{back.host}</span>.</p>
        <ul className="mt-3 space-y-1.5">
          <li className="flex gap-2"><Icon name="Check" className="mt-0.5 h-4 w-4 shrink-0 text-pos" />Read company fundamentals, filings, comps, insiders, private raises and news, each with its source</li>
          <li className="flex gap-2"><Icon name="Check" className="mt-0.5 h-4 w-4 shrink-0 text-pos" />Read your Book: positions, theses and where each kill criterion stands</li>
          <li className="flex gap-2"><Icon name="X" className="mt-0.5 h-4 w-4 shrink-0 text-neg" />Never trade, send email, change your data or spend your AI allowance</li>
        </ul>
        <p className="mt-3 text-[11.5px] text-muted">It gets a key named &ldquo;{client.client_name} (connected)&rdquo;, listed in Settings → Connect AI apps, where you can revoke it at any time. Calls are recorded in your research ledger when it is on.</p>
        <form method="post" action="/api/oauth/authorize" className="mt-4 flex gap-2">
          {Object.entries(hidden).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <button type="submit" name="decision" value="approve" className="ctl bg-accent px-4 py-2 text-[12.5px] font-semibold text-accent-fg">Connect</button>
          <button type="submit" name="decision" value="deny" className="ctl border border-line px-4 py-2 text-[12.5px] text-muted hover:text-fg">Cancel</button>
        </form>
      </div>
    </div>
  );
}
