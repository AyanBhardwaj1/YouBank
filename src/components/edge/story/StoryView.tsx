"use client";

/**
 * A story: a canvas run as a scrolling visual report. Each section rises into view as the reader
 * scrolls (still, with reduced motion); the network is drawn live; synthetic values keep their labels.
 * The owner chooses who can read it (only them, a team, anyone with the link); anyone who can read it
 * can download it as PowerPoint or print it to PDF.
 */
import { motion, useReducedMotion } from "motion/react";
import { Check, Copy, Download, Globe2, Lock, Printer, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Select } from "@/components/ui/Select";
import { api } from "@/components/news/client";
import type { GraphValue } from "@/lib/edge/canvas/values";
import type { Section } from "@/lib/edge/story";
import { ValueView } from "../canvas/Results";
import { ForceGraph } from "../net/ForceGraph";

export type StoryData = { slug: string; title: string; createdAt: string; sections: Section[]; visibility: string; teamId: number | null };

function GraphSection({ g }: { g: GraphValue }) {
  const nodes = useMemo(() => g.nodes.map((n) => ({ id: n.id, kind: n.kind, name: n.name, ticker: n.ticker ?? "" })), [g]);
  const links = useMemo(() => g.links.map((l, i) => ({ id: i + 1, s: l.s, d: l.d, kind: l.kind, w: 1, asOf: null, ended: null, source: "", url: "", label: "" })), [g]);
  return <ForceGraph nodes={nodes} links={links} focus={g.nodes[0]?.id ?? 0} height={460} />;
}

export function StoryView({ story, owner, teams }: { story: StoryData; owner: boolean; teams: { id: number; name: string }[] }) {
  const reduce = useReducedMotion();
  const [share, setShare] = useState(story.visibility === "team" && story.teamId ? `team:${story.teamId}` : story.visibility);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const changeShare = async (v: string) => {
    setError(null);
    const [visibility, team] = v.split(":");
    try { await api(`/api/edge/stories/${story.slug}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility, teamId: team ? Number(team) : null }) }); setShare(v); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  const copy = () => { void navigator.clipboard.writeText(window.location.href).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };
  return (
    <div className="min-h-screen bg-bg text-fg">
      <div className="mx-auto max-w-[980px] px-4 pb-24 pt-10 md:px-8 print:px-0 print:pt-0">
        <header className="border-b border-line pb-6">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-accent">Edge story</div>
          <h1 className="mt-2 font-[family-name:var(--font-display-serif)] text-[34px] leading-tight md:text-[44px]">{story.title}</h1>
          <p className="mt-2 text-[12.5px] text-muted">{new Date(story.createdAt).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })} · {story.sections.length} sections · every figure is cited or labeled</p>
          <div className="mt-4 flex flex-wrap items-center gap-2 print:hidden max-md:[&>a]:min-h-10 max-md:[&>button]:min-h-10">
            <a href={`/api/edge/stories/${story.slug}/pptx`} className="ctl flex items-center gap-1.5 border border-line px-2.5 py-1 text-[12px] hover:border-accent/50"><Download className="h-3.5 w-3.5" />PowerPoint</a>
            <button type="button" onClick={() => window.print()} className="ctl flex items-center gap-1.5 border border-line px-2.5 py-1 text-[12px] hover:border-accent/50"><Printer className="h-3.5 w-3.5" />PDF</button>
            {owner && (
              <span className="ml-auto flex items-center gap-2 text-[12px]">
                {share === "private" ? <Lock className="h-3.5 w-3.5 text-muted" /> : share === "link" ? <Globe2 className="h-3.5 w-3.5 text-accent" /> : <Users className="h-3.5 w-3.5 text-accent" />}
                <Select value={share} onChange={(v) => void changeShare(v)} aria-label="Who can read this story" className="ctl border border-line bg-bg px-2 py-1 text-left">
                  <option value="private">Only me</option>
                  {teams.map((t) => <option key={t.id} value={`team:${t.id}`}>{t.name}</option>)}
                  <option value="link">Anyone with the link</option>
                </Select>
                {share !== "private" && <button type="button" onClick={copy} className="ctl flex items-center gap-1 border border-line px-2 py-1 hover:border-accent/50">{copied ? <Check className="h-3.5 w-3.5 text-pos" /> : <Copy className="h-3.5 w-3.5" />}{copied ? "Copied" : "Copy link"}</button>}
              </span>
            )}
          </div>
          {error && <p className="mt-2 text-[12px] text-neg">{error}</p>}
        </header>
        <ol className="mt-10 space-y-16">
          {story.sections.map((s, i) => (
            <motion.li key={i} initial={reduce || i === 0 ? false : { opacity: 0, y: 28 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-80px" }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }} className="break-inside-avoid print:!transform-none print:!opacity-100">
              <div className="num text-[11px] text-muted">{String(i + 1).padStart(2, "0")}</div>
              <h2 className="mt-1 text-[22px] font-semibold tracking-tight">{s.title}</h2>
              <div className="mt-4">{s.kind === "graph" ? <GraphSection g={s.value as GraphValue} /> : <ValueView value={s.value} />}</div>
            </motion.li>
          ))}
        </ol>
        <footer className="mt-20 border-t border-line pt-4 text-[11px] text-faint">Made with YouBank Edge. Synthetic figures are labeled with their recipe and seed; findings link to their sources and audit trail.</footer>
      </div>
    </div>
  );
}
