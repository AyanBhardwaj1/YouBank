"use client";

/**
 * Settings → Connect AI apps: keys for YouBank's MCP server (/api/mcp, src/lib/mcp), so the person's own
 * AI apps (Claude, ChatGPT, Cursor, an in-house agent) can use YouBank's research tools with sources, and
 * read their Book. A key is shown once when it is made; the list shows its name, last four characters,
 * when it was made and last used, and revokes it. Below, the set-up for the common apps, filled in with
 * this site's address and the new key.
 */
import { useEffect, useState } from "react";
import { confirmDialog } from "@/components/ui/Dialog";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { siteLink } from "@/lib/site";

type Key = { id: string; name: string; hint: string; createdAt: string; lastUsedAt: string | null };

const input = "ctl w-full border border-line bg-panel px-2.5 py-2 text-[13px] text-fg outline-none focus:border-accent";
const primary = "ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-60";
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "never");

const TOOLS = [
  ["Company fundamentals", "LTM income, cash flow and balance sheet from SEC XBRL, with price and EV"], ["Trading comps", "a target against peers, with medians"],
  ["Filings", "search, read sections, EDGAR full text, recent filings, any sec.gov document"], ["What changed", "the latest 10-K or 10-Q against the one before"],
  ["XBRL series and insiders", "any reported concept over time; Form 4 transactions"], ["Private markets", "Form D raises and the startup directory"],
  ["News", "this week's Newsroom stories for a ticker"], ["Your Book", "every position's thesis checked, exposure and P&L"], ["Check a thesis", "any kill criteria against filings and price, without saving"],
];

function Snippet({ title, code }: { title: string; code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between"><span className="text-[11.5px] font-semibold">{title}</span>
        <button type="button" className="text-[11px] text-muted hover:text-fg" onClick={() => { void navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre tabIndex={0} aria-label={`${title} set-up`} className="ctl overflow-x-auto border border-line bg-bg p-2.5 text-[11px] leading-relaxed"><code>{code}</code></pre>
    </div>
  );
}

export function ConnectAISettings() {
  const [keys, setKeys] = useState<Key[] | null>(null);
  const [name, setName] = useState("");
  const [fresh, setFresh] = useState<{ key: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const load = () => fetchJson<{ keys: Key[] }>("/api/settings/mcp-keys").then((r) => setKeys(r.keys)).catch((e) => { setErr(errorMessage(e)); setKeys([]); });
  useEffect(() => { void load(); }, []);

  const create = async () => {
    setBusy(true); setErr("");
    try {
      const r = await fetchJson<{ key: string; view: Key }>("/api/settings/mcp-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      setFresh({ key: r.key, name: r.view.name }); setName(""); await load();
    } catch (e) { setErr(errorMessage(e)); } finally { setBusy(false); }
  };
  const revoke = async (k: Key) => {
    if (!(await confirmDialog({ title: `Revoke “${k.name}”?`, body: "Apps using this key stop reaching YouBank at once.", confirmLabel: "Revoke", tone: "danger" }))) return;
    try { await fetchJson(`/api/settings/mcp-keys?id=${k.id}`, { method: "DELETE" }); if (fresh && keys?.length === 1) setFresh(null); await load(); } catch (e) { setErr(errorMessage(e)); }
  };

  // The public address (NEXT_PUBLIC_SITE_URL, inlined at build), so a copied set-up points at production.
  const url = siteLink("/api/mcp");
  const key = fresh?.key ?? "ybm_YOUR_KEY";
  return (
    <div className="mt-5 max-w-3xl space-y-5">
      <section className="panel p-4">
        <div className="flex items-center gap-2"><Icon name="Bot" className="h-4 w-4 text-accent" /><h2 className="text-[14px] font-semibold">Use YouBank from your AI apps</h2></div>
        <p className="mt-1 text-[12.5px] text-muted">
          YouBank is an MCP server: Claude, ChatGPT, Cursor and your own agents can call its research tools under your account. Every figure comes back with the filing, XBRL fact or price feed it is from, so an answer written elsewhere can be checked the same way as one written here. Nothing trades, sends or changes your data: an app can only propose a position, which waits in your Book until you add it.
        </p>
        <ul className="mt-3 grid gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
          {TOOLS.map(([t, d]) => <li key={t}><span className="font-semibold">{t}</span> <span className="text-muted">· {d}</span></li>)}
        </ul>
        <p className="mt-3 text-[12px] text-muted"><span className="font-semibold text-fg">Ready-made prompts</span> appear in your app&apos;s slash or prompt menu: <i>Review my book</i>, <i>Argue against a position</i>, <i>What changed in the latest filing</i> and <i>Earnings prep</i>. Each tells the AI which YouBank tools to use and to cite every figure.</p>
      </section>

      <section className="panel space-y-3 p-4">
        <h3 className="text-[13px] font-semibold">Keys</h3>
        {fresh && (
          <div role="status" className="ctl border border-accent/50 bg-accent-soft p-3">
            <div className="text-[12px] font-semibold">Your key for “{fresh.name}”. Copy it now: it is not shown again.</div>
            <div className="mt-1.5 flex items-center gap-2">
              <code className="num min-w-0 flex-1 break-all text-[11.5px]">{fresh.key}</code>
              <button type="button" className="ctl border border-line px-2 py-1 text-[11px]" onClick={() => void navigator.clipboard?.writeText(fresh.key)}>Copy</button>
            </div>
          </div>
        )}
        {keys === null ? <div className="shimmer h-12 ctl" /> : keys.length === 0 ? <p className="text-[12px] text-muted">No keys yet.</p> : (
          <ul className="divide-y divide-line/60 text-[12px]">
            {keys.map((k) => (
              <li key={k.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                <span className="font-semibold">{k.name}</span><span className="num text-muted">{k.hint}</span>
                <span className="text-[11px] text-muted">made {when(k.createdAt)} · last used {when(k.lastUsedAt)}</span>
                <button type="button" onClick={() => revoke(k)} className="ml-auto text-[11.5px] text-muted hover:text-neg">Revoke</button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex gap-2">
          <input className={input} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} placeholder="What is it for? e.g. Claude on my laptop" aria-label="Key name" />
          <button type="button" disabled={busy || (keys?.length ?? 0) >= 10} onClick={create} className={`${primary} shrink-0`}>{busy ? "Making…" : "Make a key"}</button>
        </div>
        {err && <p role="alert" className="text-[12px] text-neg">{err}</p>}
        <p className="text-[11px] text-faint">Up to ten keys, including those apps receive when you connect them with sign-in. Each works only for this MCP server, as you, and can be revoked here at any time. Calls are limited to 600 an hour.</p>
      </section>

      <section className="panel space-y-3 p-4">
        <h3 className="text-[13px] font-semibold">Set up your app</h3>
        <p className="text-[12px] text-muted">The server address is <code className="num">{url}</code> (Streamable HTTP). Send the key as a bearer token.</p>
        <div className="ctl border border-accent/40 bg-accent-soft/40 p-3 text-[12px]">
          <div className="font-semibold">Apps that take just a URL (Claude and ChatGPT custom connectors)</div>
          <p className="mt-1 text-muted">Add a custom connector with the address below and no key. The app sends you to YouBank to approve it, then receives its own key, listed above.</p>
          <code className="num mt-1.5 block break-all">{url}</code>
        </div>
        <Snippet title="Claude Code" code={`claude mcp add --transport http youbank ${url} \\\n  --header "Authorization: Bearer ${key}"`} />
        <Snippet title="Claude Desktop, Cursor, Windsurf and other apps that take an mcpServers file" code={JSON.stringify({ mcpServers: { youbank: { url, headers: { Authorization: `Bearer ${key}` } } } }, null, 2)} />
        <Snippet title="Apps that only run local servers (through mcp-remote)" code={JSON.stringify({ mcpServers: { youbank: { command: "npx", args: ["-y", "mcp-remote", url, "--header", `Authorization:Bearer ${key}`] } } }, null, 2)} />
        <Snippet title="Any agent, over plain HTTP" code={`curl -s ${url} \\\n  -H "Authorization: Bearer ${key}" -H "Content-Type: application/json" \\\n  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_company_financials","arguments":{"ticker":"SNOW"}}}'`} />
      </section>
    </div>
  );
}
