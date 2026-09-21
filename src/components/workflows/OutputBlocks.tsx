"use client";

import { Markdown, type Source } from "@/components/terminal/Markdown";
import { HBar } from "@/components/charts/HBar";
import { Columns } from "@/components/charts/Columns";
import { Scatter } from "@/components/charts/Scatter";
import { Waterfall } from "@/components/charts/Waterfall";
import { LineChart } from "@/components/charts/LineChart";
import { Sensitivity } from "@/components/charts/Sensitivity";
import type { NumFormat, OutputBlock, Tone, WorkflowOutput } from "@/lib/workflows/types";

export function formatter(f: NumFormat | undefined): (v: number | null) => string {
  return (v) => {
    if (v === null || !Number.isFinite(v)) return "n/a";
    switch (f) {
      case "money": return Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}B` : Math.abs(v) >= 1 ? `$${v.toFixed(v % 1 === 0 ? 0 : 1)}M` : `$${(v * 1000).toFixed(0)}K`;
      case "x": return `${v.toFixed(1)}x`;
      case "pct": return `${(v * 100).toFixed(Math.abs(v) < 0.1 ? 1 : 0)}%`;
      case "int": return Math.round(v).toLocaleString("en-US");
      case "bps": return `${Math.round(v * 10000)} bps`;
      default: return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
    }
  };
}

const toneClass = (t?: Tone) => (t === "pos" ? "text-pos" : t === "neg" ? "text-neg" : t === "warn" ? "text-accent" : t === "info" ? "text-info" : "text-muted");
const calloutClass = (t: Tone) => ({ pos: "border-pos/40 bg-pos/10", neg: "border-neg/40 bg-neg/10", warn: "border-accent/50 bg-accent-soft", info: "border-info/40 bg-info/10", neutral: "border-line bg-elevated/60" }[t]);
const isNumeric = (s: string | number | null) => typeof s === "number" || (typeof s === "string" && /^[-+$(]?[\d,.]+[%xBMK)]*$/.test(s.trim()) && s.trim() !== "");

function Title({ text }: { text?: string }) {
  return text ? <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">{text}</div> : null;
}

export function Block({ b, sources }: { b: OutputBlock; sources: Source[] }) {
  switch (b.type) {
    case "kpis":
      return (
        <div>
          <Title text={b.title} />
          <div className="stagger grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {b.items.map((k, i) => (
              <div key={i} className="ctl border border-line bg-elevated/60 px-3 py-2" title={k.hint}>
                <div className="text-[10.5px] uppercase tracking-wider text-muted">{k.label}</div>
                <div className="num mt-1 text-[18px] font-semibold leading-none text-fg">{k.value}</div>
                {k.delta && <div className={`mt-1 text-[11px] ${toneClass(k.tone)}`}>{k.delta}</div>}
              </div>
            ))}
          </div>
        </div>
      );
    case "table":
      return (
        <div>
          <Title text={b.title} />
          <div className="overflow-auto ctl border border-line">
            <table className="w-full whitespace-nowrap text-[11.5px]">
              <thead className="bg-elevated/70 text-[10.5px] uppercase tracking-wider text-muted">
                <tr>{b.columns.map((c, i) => <th key={i} className={`px-2 py-1.5 font-normal ${i === 0 ? "text-left" : "text-right"}`}>{c}</th>)}</tr>
              </thead>
              <tbody className="stagger">
                {b.rows.map((r, ri) => (
                  <tr key={ri} className={`border-t border-line/60 hover:bg-elevated/60 ${b.emphasisRow === ri ? "bg-accent-soft font-semibold" : ""}`}>
                    {r.map((c, ci) => <td key={ci} className={`px-2 py-1 ${ci === 0 ? "text-left font-sans" : isNumeric(c) ? "text-right" : "text-left font-sans text-fg/90"} ${c === null || c === "n/a" || c === "NM" ? "text-faint" : ""}`}>{c === null ? "—" : typeof c === "string" ? <Markdown text={c} sources={sources} inline /> : c.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td>)}
                  </tr>
                ))}
                {b.totals && (
                  <tr className="border-t border-line-strong bg-elevated/70 font-semibold">
                    {b.totals.map((c, ci) => <td key={ci} className={`px-2 py-1 ${ci === 0 ? "text-left font-sans" : "text-right"}`}>{c === null ? "" : typeof c === "number" ? c.toLocaleString("en-US", { maximumFractionDigits: 2 }) : c}</td>)}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {b.note && <div className="mt-1 text-[10.5px] text-muted">{b.note}</div>}
        </div>
      );
    case "markdown":
      return <div><Title text={b.title} /><div className="max-w-[820px] text-[12.5px] leading-relaxed"><Markdown text={b.text} sources={sources} /></div></div>;
    case "bullets":
      return (
        <div>
          <Title text={b.title} />
          {b.ordered ? <ol className="stagger list-decimal space-y-1 pl-5 text-[12.5px]">{b.items.map((t, i) => <li key={i}><Markdown text={t} sources={sources} inline /></li>)}</ol>
            : <ul className="stagger list-disc space-y-1 pl-5 text-[12.5px]">{b.items.map((t, i) => <li key={i}><Markdown text={t} sources={sources} inline /></li>)}</ul>}
        </div>
      );
    case "bar": {
      const f = formatter(b.format);
      return <HBar title={b.title ?? ""} data={b.data.map((d, i) => ({ key: `${d.label}-${i}`, label: d.label, value: d.value, emphasis: d.emphasis, note: d.note }))} format={f} maxBars={16} referenceLine={b.reference} />;
    }
    case "columns": {
      const f = formatter(b.format);
      return <Columns title={b.title ?? ""} data={b.data} format={(v) => f(v)} height={150} />;
    }
    case "line": {
      const f = formatter(b.format);
      return <LineChart title={b.title} series={b.series} format={(v) => f(v)} />;
    }
    case "waterfall": {
      const f = formatter(b.format);
      return <Waterfall title={b.title} steps={b.steps} format={(v) => f(v)} />;
    }
    case "scatter": {
      const fx = formatter(b.xFormat), fy = formatter(b.yFormat);
      return <Scatter title={b.title ?? ""} data={b.points.map((p, i) => ({ key: `${p.label}-${i}`, label: p.label, x: p.x, y: p.y, emphasis: p.emphasis }))} xLabel={b.xLabel} yLabel={b.yLabel} fx={(v) => fx(v)} fy={(v) => fy(v)} />;
    }
    case "sensitivity": {
      const f = formatter(b.format);
      return <Sensitivity title={b.title} rows={b.rows} cols={b.cols} values={b.values} rowLabel={b.rowLabel} colLabel={b.colLabel} format={(v) => f(v)} baseRow={b.baseRow} baseCol={b.baseCol} />;
    }
    case "timeline":
      return (
        <div>
          <Title text={b.title} />
          <ol className="stagger relative ml-2 border-l border-line pl-4">
            {b.items.map((it, i) => (
              <li key={i} className="relative mb-2.5">
                <span className={`absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-panel ${it.tone === "neg" ? "bg-neg" : it.tone === "pos" ? "bg-pos" : it.tone === "warn" ? "bg-accent" : "bg-chart-1"}`} />
                <div className="num text-[10.5px] text-muted">{it.date}</div>
                <div className="text-[12.5px] font-medium">{it.label}</div>
                {it.detail && <div className="text-[11.5px] text-muted"><Markdown text={it.detail} sources={sources} inline /></div>}
              </li>
            ))}
          </ol>
        </div>
      );
    case "checklist":
      return (
        <div>
          <Title text={b.title} />
          <ul className="stagger space-y-1">
            {b.items.map((it, i) => (
              <li key={i} className="flex items-start gap-2 text-[12.5px]">
                <span className={`mt-0.5 grid h-3.5 w-3.5 shrink-0 place-items-center rounded-sm border ${it.done ? "border-pos bg-pos/20 text-pos" : "border-line-strong"}`}>{it.done ? "✓" : ""}</span>
                <span className={it.done ? "text-muted line-through" : ""}><Markdown text={it.text} sources={sources} inline /></span>
                {(it.owner || it.due) && <span className="ml-auto shrink-0 text-[10.5px] text-muted">{[it.owner, it.due].filter(Boolean).join(" · ")}</span>}
              </li>
            ))}
          </ul>
        </div>
      );
    case "risks":
      return (
        <div>
          <Title text={b.title} />
          <div className="stagger space-y-1.5">
            {b.items.map((r, i) => (
              <div key={i} className="ctl flex items-start gap-2 border border-line bg-elevated/50 px-3 py-2 text-[12px]">
                <span className={`mt-0.5 shrink-0 rounded px-1.5 py-px text-[10px] font-semibold uppercase ${r.severity === "high" ? "bg-neg/15 text-neg" : r.severity === "medium" ? "bg-accent-soft text-accent" : "bg-elevated text-muted"}`}>{r.severity}</span>
                <div><div className="font-medium"><Markdown text={r.risk} sources={sources} inline /></div>{r.mitigation && <div className="mt-0.5 text-[11.5px] text-muted">Mitigation: <Markdown text={r.mitigation} sources={sources} inline /></div>}</div>
              </div>
            ))}
          </div>
        </div>
      );
    case "callout":
      return (
        <div className={`ctl border px-3.5 py-2.5 text-[12.5px] leading-relaxed ${calloutClass(b.tone)}`}>
          {b.title && <div className={`mb-0.5 text-[11px] font-semibold uppercase tracking-wider ${toneClass(b.tone)}`}>{b.title}</div>}
          <Markdown text={b.text} sources={sources} />
        </div>
      );
    case "steps":
      return (
        <div>
          <Title text={b.title} />
          <ol className="stagger space-y-1.5">
            {b.items.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-[12.5px]">
                <span className="num grid h-5 w-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[10.5px] font-semibold text-accent">{i + 1}</span>
                <div><div className="font-medium">{s.title}</div>{s.detail && <div className="text-[11.5px] text-muted"><Markdown text={s.detail} sources={sources} inline /></div>}</div>
              </li>
            ))}
          </ol>
        </div>
      );
    case "qa":
      return (
        <div>
          <Title text={b.title} />
          <div className="stagger space-y-2">
            {b.items.map((it, i) => (
              <details key={i} className="ctl group border border-line bg-elevated/50 px-3 py-2 text-[12.5px]" open={i === 0}>
                <summary className="cursor-pointer font-medium marker:text-accent"><span className="num mr-1.5 text-accent">Q{i + 1}</span>{it.q}</summary>
                <div className="mt-1.5 border-t border-line pt-1.5 text-fg/90"><Markdown text={it.a} sources={sources} /></div>
              </details>
            ))}
          </div>
        </div>
      );
    case "email":
      return (
        <div className="ctl border border-line bg-elevated/50 p-3 text-[12.5px]">
          {b.to && <div className="text-[11px] text-muted">To: {b.to}</div>}
          <div className="font-semibold">Subject: {b.subject}</div>
          <pre className="mt-2 whitespace-pre-wrap font-sans leading-relaxed">{b.body}</pre>
        </div>
      );
    case "score":
      return (
        <div>
          <Title text={b.title} />
          <div className="stagger space-y-1.5">
            {b.items.map((s, i) => {
              const max = s.max ?? 10, pct = Math.max(0, Math.min(1, s.score / max));
              return (
                <div key={i} className="text-[12px]">
                  <div className="flex justify-between"><span>{s.label}</span><span className="num text-muted">{s.score}/{max}</span></div>
                  <div className="mt-0.5 h-1.5 w-full rounded-full bg-elevated"><div className="grow-x h-full rounded-full bg-chart-1" style={{ width: `${pct * 100}%`, animationDelay: `${i * 60}ms` }} /></div>
                  {s.note && <div className="mt-0.5 text-[11px] text-muted">{s.note}</div>}
                </div>
              );
            })}
          </div>
        </div>
      );
  }
}

export function OutputBlocks({ output, sources, compact = false }: { output: WorkflowOutput; sources: Source[]; compact?: boolean }) {
  return (
    <div className={`space-y-4 ${compact ? "" : "max-w-[1100px]"}`}>
      {output.summary && (
        <div className="rise text-[13px] leading-relaxed text-fg/95"><Markdown text={output.summary} sources={sources} /></div>
      )}
      {output.blocks.map((b, i) => (
        <div key={i} className="rise" style={{ animationDelay: `${Math.min(i, 8) * 60}ms` }}><Block b={b} sources={sources} /></div>
      ))}
      {(output.nextSteps?.length || output.caveats?.length) ? (
        <div className="grid gap-3 border-t border-line pt-3 md:grid-cols-2">
          {output.nextSteps?.length ? <div><Title text="Next steps" /><ul className="list-disc space-y-0.5 pl-5 text-[12px]">{output.nextSteps.map((s, i) => <li key={i}><Markdown text={s} sources={sources} inline /></li>)}</ul></div> : null}
          {output.caveats?.length ? <div><Title text="Caveats" /><ul className="list-disc space-y-0.5 pl-5 text-[12px] text-muted">{output.caveats.map((s, i) => <li key={i}><Markdown text={s} sources={sources} inline /></li>)}</ul></div> : null}
        </div>
      ) : null}
      {sources.length > 0 && (
        <div className="border-t border-line pt-2 text-[10.5px] text-muted">
          <div className="mb-0.5 uppercase tracking-wider">Sources</div>
          {sources.map((s) => <div key={s.id} className="flex gap-1.5"><span className="num text-accent">{s.id}</span><a href={s.url} target="_blank" rel="noreferrer" className="truncate hover:text-info hover:underline">{s.label}</a></div>)}
        </div>
      )}
    </div>
  );
}

/** Plain-text/markdown export of an output, for copy and download. */
export function outputToMarkdown(o: WorkflowOutput, sources: Source[]): string {
  const lines: string[] = [`# ${o.title}`, "", o.summary, ""];
  for (const b of o.blocks) {
    const t = "title" in b && b.title ? `## ${b.title}\n` : "";
    switch (b.type) {
      case "kpis": lines.push(t + b.items.map((k) => `- **${k.label}**: ${k.value}${k.delta ? ` (${k.delta})` : ""}`).join("\n")); break;
      case "table": lines.push(t + `| ${b.columns.join(" | ")} |\n| ${b.columns.map(() => "---").join(" | ")} |\n` + b.rows.map((r) => `| ${r.map((c) => (c === null ? "" : String(c))).join(" | ")} |`).join("\n") + (b.totals ? `\n| ${b.totals.map((c) => (c === null ? "" : String(c))).join(" | ")} |` : "") + (b.note ? `\n\n_${b.note}_` : "")); break;
      case "markdown": lines.push(t + b.text); break;
      case "bullets": lines.push(t + b.items.map((x, i) => (b.ordered ? `${i + 1}. ${x}` : `- ${x}`)).join("\n")); break;
      case "bar": case "columns": lines.push(t + b.data.map((d) => `- ${d.label}: ${d.value ?? "n/a"}`).join("\n")); break;
      case "line": lines.push(t + b.series.map((s) => `${s.name}: ${s.points.map((p) => `${p.x}=${p.y ?? "n/a"}`).join(", ")}`).join("\n")); break;
      case "waterfall": lines.push(t + b.steps.map((s) => `- ${s.label}: ${s.value}${s.total ? " (total)" : ""}`).join("\n")); break;
      case "scatter": lines.push(t + b.points.map((p) => `- ${p.label}: ${b.xLabel}=${p.x ?? "n/a"}, ${b.yLabel}=${p.y ?? "n/a"}`).join("\n")); break;
      case "sensitivity": lines.push(t + `| ${b.rowLabel} \\ ${b.colLabel} | ${b.cols.join(" | ")} |\n| --- | ${b.cols.map(() => "---").join(" | ")} |\n` + b.rows.map((r, i) => `| ${r} | ${b.values[i].map((v) => (v === null ? "n/a" : String(Math.round(v * 100) / 100))).join(" | ")} |`).join("\n")); break;
      case "timeline": lines.push(t + b.items.map((i) => `- ${i.date}: ${i.label}${i.detail ? ` — ${i.detail}` : ""}`).join("\n")); break;
      case "checklist": lines.push(t + b.items.map((i) => `- [${i.done ? "x" : " "}] ${i.text}${i.owner ? ` (${i.owner})` : ""}`).join("\n")); break;
      case "risks": lines.push(t + b.items.map((r) => `- [${r.severity.toUpperCase()}] ${r.risk}${r.mitigation ? ` — Mitigation: ${r.mitigation}` : ""}`).join("\n")); break;
      case "callout": lines.push(`> ${b.title ? `**${b.title}** ` : ""}${b.text}`); break;
      case "steps": lines.push(t + b.items.map((s, i) => `${i + 1}. **${s.title}**${s.detail ? ` — ${s.detail}` : ""}`).join("\n")); break;
      case "qa": lines.push(t + b.items.map((q, i) => `**Q${i + 1}. ${q.q}**\n\n${q.a}`).join("\n\n")); break;
      case "email": lines.push(`${b.to ? `To: ${b.to}\n` : ""}Subject: ${b.subject}\n\n${b.body}`); break;
      case "score": lines.push(t + b.items.map((s) => `- ${s.label}: ${s.score}/${s.max ?? 10}${s.note ? ` — ${s.note}` : ""}`).join("\n")); break;
    }
    lines.push("");
  }
  if (o.nextSteps?.length) lines.push("## Next steps", ...o.nextSteps.map((s) => `- ${s}`), "");
  if (o.caveats?.length) lines.push("## Caveats", ...o.caveats.map((s) => `- ${s}`), "");
  if (sources.length) lines.push("## Sources", ...sources.map((s) => `- [${s.id}] ${s.label}: ${s.url}`));
  return lines.join("\n");
}
