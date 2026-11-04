import type { WorkflowOutput } from "./schema";

/**
 * A workflow's output as Markdown: for copying and downloading a run, and on the server for checking the
 * run's figures against the sources they cite (src/lib/ai/figures.ts). Pure.
 */
export function outputToMarkdown(o: WorkflowOutput, sources: { id: string; label: string; url: string }[]): string {
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
