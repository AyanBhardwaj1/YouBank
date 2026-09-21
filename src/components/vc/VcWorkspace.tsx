"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AiScreen } from "@/components/terminal/screens/AiScreen";
import type { AiStatus } from "@/components/terminal/Terminal";
import type { FormDFiling } from "@/lib/vc/formd";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

type Startup = {
  id: number; source: string; sourceId: string; name: string; oneLiner: string; description: string; website: string; url: string; logo: string; program: string; status: string;
  foundedYear: number | null; founders: string; location: string; country: string; industries: string[]; tags: string[]; teamSize: number | null; fundingStage: string; investors: string[];
  raised: string; isHiring: number; sourceDate: string; data: Record<string, unknown> | null;
};
type Facets = { sources: { source: string; n: number }[]; countries: { country: string; n: number }[]; programs: { program: string; n: number }[]; industries: { industry: string; n: number }[]; total: number; lastSync: string | null };

const SOURCE_LABEL: Record<string, string> = { yc: "YC", a16z: "a16z", thiel: "Thiel", hn: "Show HN", formd: "Form D", web: "Web", user: "Added" };
const SOURCE_STYLE: Record<string, string> = { yc: "bg-accent-soft text-accent", a16z: "bg-info/15 text-info", thiel: "bg-pos/15 text-pos", hn: "bg-elevated text-fg/80", formd: "bg-neg/10 text-neg", web: "bg-raised text-muted", user: "bg-raised text-muted" };

export function VcWorkspace() {
  const { profile } = useWorkspace();
  const [tab, setTab] = useState<"directory" | "formd">("directory");
  const [facets, setFacets] = useState<Facets | null>(null);
  const [q, setQ] = useState(""); const [source, setSource] = useState(""); const [country, setCountry] = useState(""); const [program, setProgram] = useState(""); const [industry, setIndustry] = useState(""); const [hiring, setHiring] = useState(false);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ total: number; rows: Startup[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Startup | null>(null);
  const [discovering, setDiscovering] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ai, setAi] = useState<AiStatus | null>(null);
  const [formQ, setFormQ] = useState("");
  const [formRes, setFormRes] = useState<{ total: number; filings: FormDFiling[] } | null>(null);
  const [formLoading, setFormLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { fetch("/api/ai/status").then((r) => r.json()).then(setAi).catch(() => null); }, []);
  const loadFacets = useCallback(async () => {
    try { const f = (await (await fetch("/api/vc/startups/facets")).json()) as Facets; setFacets(f); return f; }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); return null; }
  }, []);
  useEffect(() => { const t = setTimeout(() => void loadFacets(), 0); return () => clearTimeout(t); }, [loadFacets]);

  const runSearch = useCallback((signal: AbortSignal) => {
    setLoading(true);
    const p = new URLSearchParams({ q, source, country, program, industry, hiring: hiring ? "1" : "", page: String(page), pageSize: "50" });
    fetch(`/api/vc/startups?${p}`, { signal }).then((r) => r.json()).then((r) => { if (!("error" in r)) setResult(r); }).catch(() => { /* aborted */ }).finally(() => setLoading(false));
  }, [q, source, country, program, industry, hiring, page]);

  useEffect(() => {
    const ctrl = new AbortController();
    const t = setTimeout(() => runSearch(ctrl.signal), 150);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [runSearch, facets?.total]);

  const discover = async () => {
    const query = [q, industry, country ? `in ${country}` : "", program ? `from ${program}` : ""].filter(Boolean).join(" ") || `${profile.sectors[0] || "software"} startups founded recently${country ? ` in ${country}` : ""}`;
    setDiscovering(true); setNotice(null); setError(null);
    try {
      const r = await (await fetch("/api/vc/discover", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query, program }) })).json();
      if ("error" in r) throw new Error(r.error);
      setNotice(`Added ${r.written} startups from the web for "${query}"`);
      setSource("web"); setPage(1); await loadFacets();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setDiscovering(false); }
  };

  const searchFormD = async (name: string) => {
    setFormQ(name); setTab("formd"); setFormLoading(true); setFormRes(null); setError(null);
    try {
      const r = await (await fetch(`/api/vc/formd?q=${encodeURIComponent(name)}`)).json();
      if ("error" in r) throw new Error(r.error);
      setFormRes(r);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setFormLoading(false); }
  };

  const subject = selected ? `${selected.name} (${selected.program}${selected.website ? `, ${selected.website}` : ""})` : `Venture research · ${profile.specialty || "all stages"}`;
  const prompts = selected
    ? [`What would it take to invest in ${selected.name}? Funding history, investors, valuation signals, and whether they are raising`, `How do I reach the founders of ${selected.name}? Names, roles, and the best warm paths`, `Who competes with ${selected.name} and how differentiated are they?`, `Has ${selected.name} filed a Form D? Summarize amounts and officers`]
    : [`Which ${profile.sectors[0] || "fintech"} startups in the directory from the last year look most fundable, and why?`, `Find recent Form D raises above $20M in ${profile.sectors[0] || "software"} and list the officers`, `Search the directory for a16z-backed companies in ${profile.sectors[0] || "infrastructure"} and compare them`, `Discover seed-stage AI startups in Europe not backed by a major fund yet`];

  const chip = (active: boolean, onClick: () => void, label: string, n?: number) => (
    <button key={label} type="button" onClick={onClick} className={`rounded-full border px-2 py-0.5 text-[10.5px] ${active ? "border-accent bg-accent-soft text-accent" : "border-line text-muted hover:text-fg"}`}>{label}{n !== undefined ? <span className="num ml-1 opacity-70">{n.toLocaleString()}</span> : null}</button>
  );

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[400px] shrink-0 flex-col border-r border-line bg-panel">
        <div className="flex items-center gap-1 border-b border-line px-2 py-1.5 text-[11px]">
          <button type="button" onClick={() => setTab("directory")} className={`rounded px-2 py-1 ${tab === "directory" ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>Startup directory</button>
          <button type="button" onClick={() => setTab("formd")} className={`rounded px-2 py-1 ${tab === "formd" ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}>Private raises</button>
          <Link href="/app/terminal" className="ml-auto rounded px-2 py-1 text-muted hover:text-fg">Public comps →</Link>
        </div>

        {tab === "directory" ? (
          <>
            <div className="space-y-1.5 border-b border-line p-2 text-[11px]">
              <input value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} placeholder="Search name, description, founders…"
                className="w-full rounded border border-line bg-bg px-2 py-1.5 text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none" />
              <div className="flex flex-wrap gap-1">
                {chip(source === "", () => { setSource(""); setPage(1); }, "All", facets?.total)}
                {(facets?.sources ?? []).map((s) => chip(source === s.source, () => { setSource(source === s.source ? "" : s.source); setPage(1); }, SOURCE_LABEL[s.source] ?? s.source, s.n))}
              </div>
              <div className="flex gap-1.5">
                <select value={country} onChange={(e) => { setCountry(e.target.value); setPage(1); }} className="min-w-0 flex-1 rounded border border-line bg-elevated px-1.5 py-1 text-fg">
                  <option value="">All countries</option>{facets?.countries.map((c) => <option key={c.country} value={c.country}>{c.country} ({c.n})</option>)}
                </select>
                <select value={program} onChange={(e) => { setProgram(e.target.value); setPage(1); }} className="min-w-0 flex-1 rounded border border-line bg-elevated px-1.5 py-1 text-fg">
                  <option value="">All programs / batches</option>{facets?.programs.map((p) => <option key={p.program} value={p.program}>{p.program} ({p.n})</option>)}
                </select>
              </div>
              <div className="flex items-center gap-1.5">
                <select value={industry} onChange={(e) => { setIndustry(e.target.value); setPage(1); }} className="min-w-0 flex-1 rounded border border-line bg-elevated px-1.5 py-1 text-fg">
                  <option value="">All industries</option>{facets?.industries.map((i) => <option key={i.industry} value={i.industry}>{i.industry} ({i.n})</option>)}
                </select>
                <label className="flex items-center gap-1 text-muted"><input type="checkbox" checked={hiring} onChange={(e) => { setHiring(e.target.checked); setPage(1); }} /> Hiring</label>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted">{result ? `${result.total.toLocaleString()} startups` : loading ? "Loading…" : ""}</span>
                <button type="button" onClick={discover} disabled={discovering || !ai?.configured} title="Search the web for startups matching the current filters and add them to the directory"
                  className={`rounded border px-2 py-0.5 ${ai?.configured ? "border-accent/50 text-accent hover:bg-accent-soft" : "border-line text-muted opacity-60"}`}>{discovering ? "✦ Discovering…" : "✦ Discover more with AI"}</button>
              </div>
              {notice && <div className="text-pos">{notice}</div>}
              {error && <div className="text-neg">{error}</div>}
            </div>
            <ul className="min-h-0 flex-1 overflow-auto">
              {result?.rows.map((s) => (
                <li key={s.id}>
                  <button type="button" onClick={() => setSelected(s)} className={`flex w-full items-start gap-2 border-b border-line/50 px-3 py-2 text-left hover:bg-elevated ${selected?.id === s.id ? "bg-elevated" : ""}`}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {s.logo ? <img src={s.logo} alt="" className="mt-0.5 h-7 w-7 shrink-0 rounded bg-white/5 object-contain" /> : <span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded text-[10px] font-semibold ${SOURCE_STYLE[s.source] ?? "bg-elevated"}`}>{s.name.slice(0, 1)}</span>}
                    <span className="min-w-0 flex-1">
                      <span className="flex items-baseline gap-2"><span className="truncate text-[12.5px] font-semibold">{s.name}</span><span className={`shrink-0 rounded px-1 text-[9.5px] ${SOURCE_STYLE[s.source] ?? ""}`}>{s.program || SOURCE_LABEL[s.source]}</span></span>
                      <span className="line-clamp-2 text-[11px] text-muted">{s.oneLiner || s.description}</span>
                      <span className="mt-0.5 block truncate text-[10px] text-faint">{[s.location || s.country, s.raised, s.sourceDate].filter(Boolean).join(" · ")}</span>
                    </span>
                  </button>
                </li>
              ))}
              {result && result.rows.length === 0 && <li className="p-3 text-[11px] text-muted">Nothing matches. Try “Discover more with AI”.</li>}
            </ul>
            {result && result.total > 50 && (
              <div className="flex items-center justify-between border-t border-line px-3 py-1 text-[11px] text-muted">
                <button type="button" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} className="hover:text-fg disabled:opacity-40">← Prev</button>
                <span>Page {page} of {Math.ceil(result.total / 50)}</span>
                <button type="button" disabled={page * 50 >= result.total} onClick={() => setPage((p) => p + 1)} className="hover:text-fg disabled:opacity-40">Next →</button>
              </div>
            )}
          </>
        ) : (
          <>
            <form className="border-b border-line p-2 text-[11px]" onSubmit={(e) => { e.preventDefault(); void searchFormD(formQ); }}>
              <input value={formQ} onChange={(e) => setFormQ(e.target.value)} placeholder="Company or issuer name, e.g. Anthropic, Stripe, Databricks"
                className="w-full rounded border border-line bg-bg px-2 py-1.5 text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none" />
              <div className="mt-1 text-muted">SEC Form D: exempt private offerings with amounts, dates, and officers. New filings also flow into the directory daily.</div>
            </form>
            <div className="min-h-0 flex-1 overflow-auto p-2 text-[11px]">
              {formLoading && <div className="text-muted">Searching EDGAR…</div>}
              {formRes && formRes.filings.length === 0 && <div className="text-muted">No Form D filings matched.</div>}
              {formRes?.filings.map((f) => (
                <div key={f.accession} className="mb-2 rounded-md border border-line bg-elevated/50 p-2">
                  <div className="flex items-baseline justify-between gap-2"><span className="truncate text-[12px] font-semibold">{f.issuer}</span><span className="num shrink-0 text-muted">{f.form} · {f.filed}</span></div>
                  <div className="num mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-muted">
                    <span>Sold: <span className="text-fg">{f.amountSold || "—"}</span></span><span>Offering: <span className="text-fg">{f.offeringTotal || "—"}</span></span>
                    <span>First sale: <span className="text-fg">{f.dateOfFirstSale || "—"}</span></span><span>Investors: <span className="text-fg">{f.investorsSoFar || "—"}</span></span>
                    <span className="col-span-2">{f.entityType}{f.jurisdiction ? ` · ${f.jurisdiction}` : ""}{f.industry ? ` · ${f.industry}` : ""}</span>
                    {f.issuerAddress && <span className="col-span-2">{f.issuerAddress}{f.phone ? ` · ${f.phone}` : ""}</span>}
                  </div>
                  {f.persons.length > 0 && (
                    <div className="mt-1.5 border-t border-line pt-1.5">
                      <div className="text-[10px] uppercase tracking-wider text-muted">Related persons</div>
                      {f.persons.slice(0, 8).map((p, i) => <div key={i} className="flex gap-2"><span className="font-sans text-fg">{p.name}</span><span className="truncate text-muted">{p.relationships.join(", ")}</span></div>)}
                    </div>
                  )}
                  <a href={f.url} target="_blank" rel="noreferrer" className="mt-1 inline-block text-info hover:underline">Filing ↗</a>
                </div>
              ))}
            </div>
          </>
        )}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col border-r border-line">
        {selected ? (
          <div className="min-h-0 flex-1 overflow-auto p-4">
            <div className="flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {selected.logo ? <img src={selected.logo} alt="" className="h-12 w-12 rounded bg-white/5 object-contain" /> : null}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-2">
                  <h1 className="text-[20px] font-semibold">{selected.name}</h1>
                  <span className={`rounded px-1.5 py-px text-[10px] ${SOURCE_STYLE[selected.source] ?? ""}`}>{selected.program || SOURCE_LABEL[selected.source]}</span>
                  {selected.status && <span className="rounded bg-elevated px-1.5 py-px text-[10px] text-muted">{selected.status}</span>}
                  {selected.isHiring ? <span className="rounded bg-info/15 px-1.5 py-px text-[10px] text-info">Hiring</span> : null}
                </div>
                <p className="mt-1 text-[13px] text-fg/90">{selected.oneLiner}</p>
                <div className="mt-2 flex flex-wrap gap-1.5 text-[10.5px]">
                  {selected.foundedYear ? <span className="rounded border border-line bg-elevated px-1.5 py-0.5 text-muted">Founded {selected.foundedYear}</span> : null}
                  {selected.teamSize ? <span className="rounded border border-line bg-elevated px-1.5 py-0.5 text-muted">Team {selected.teamSize}</span> : null}
                  {(selected.location || selected.country) && <span className="rounded border border-line bg-elevated px-1.5 py-0.5 text-muted">{[selected.location, selected.country].filter(Boolean).join(", ")}</span>}
                  {selected.fundingStage && <span className="rounded border border-line bg-elevated px-1.5 py-0.5 text-muted">{selected.fundingStage}</span>}
                  {selected.raised && <span className="num rounded border border-line bg-elevated px-1.5 py-0.5 text-muted">Raised {selected.raised}</span>}
                  {selected.industries.map((i) => <span key={i} className="rounded border border-line bg-elevated px-1.5 py-0.5 text-muted">{i}</span>)}
                </div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
              {selected.website && <a href={selected.website} target="_blank" rel="noreferrer" className="rounded border border-line px-2 py-1 text-info hover:border-accent/50">Website ↗</a>}
              {selected.url && <a href={selected.url} target="_blank" rel="noreferrer" className="rounded border border-line px-2 py-1 text-info hover:border-accent/50">{selected.source === "formd" ? "SEC filing ↗" : selected.source === "hn" ? "HN thread ↗" : "Source ↗"}</a>}
              <button type="button" onClick={() => searchFormD(selected.name)} className="rounded border border-line px-2 py-1 text-muted hover:border-accent/50 hover:text-accent">Form D filings</button>
            </div>
            {selected.founders && <div className="mt-4 text-[12px]"><span className="text-[10px] uppercase tracking-wider text-muted">Founders / officers</span><div className="mt-0.5">{selected.founders}</div></div>}
            {selected.investors.length > 0 && <div className="mt-3 text-[12px]"><span className="text-[10px] uppercase tracking-wider text-muted">Investors</span><div className="mt-0.5">{selected.investors.join(", ")}</div></div>}
            <p className="mt-4 whitespace-pre-line text-[12.5px] leading-relaxed text-fg/90">{selected.description}</p>
            {selected.tags.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{selected.tags.map((t) => <span key={t} className="rounded-full border border-line px-2 py-0.5 text-[10px] text-muted">{t}</span>)}</div>}
            <div className="mt-6 rounded-md border border-line bg-panel p-3 text-[11.5px] text-muted">
              <div className="text-[10px] uppercase tracking-wider">Investor playbook</div>
              <ul className="mt-1 list-disc space-y-0.5 pl-4">
                <li>Ask the assistant for funding history, investors, and whether a round is open; it searches the web and cites sources.</li>
                <li>Check Form D for amounts raised and the officers named on the filing; that is the fastest public path to founder and CFO names.</li>
                <li>Use “Discover more with AI” to pull in companies from any country or program that the fixed sources miss.</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-muted">
            <div className="text-[15px] text-fg">Venture workspace</div>
            <div className="max-w-md text-[12px]">
              {facets ? `${facets.total.toLocaleString()} startups` : "A directory"} across Y Combinator, the a16z portfolio, Thiel Fellows, Show HN launches, new SEC Form D raises, and AI web discovery for anything else worldwide.
              Pick one to research it, look up its private raises, or ask the assistant.
            </div>
          </div>
        )}
      </section>

      <aside className="flex w-[420px] shrink-0 flex-col bg-panel">
        <AiScreen ticker="" ai={ai} openPanels={[]} subject={subject} prompts={prompts} />
      </aside>
    </div>
  );
}
