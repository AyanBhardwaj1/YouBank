/**
 * Documents · RAG blocks: a document scope (filings of the wired-in companies, uploads, calls, the
 * workspace, the Newsroom, the web), a cited answer from it, and the change radar between a company's
 * last two filings.
 */
import { askDocuments, type Scope } from "../../docs/answer";
import { changeRadar } from "../../docs/changes";
import { register } from "../engine";
import type { Answer, Companies, Memo, Table } from "../values";

const tickersIn = (values: unknown[] | undefined) => [...new Set((values ?? []).flatMap((v) => (v as Companies).items?.map((c) => c.ticker) ?? []))].slice(0, 6);
const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

register("source.documents", {
  async start(ctx) {
    const scope: Scope = { tickers: tickersIn(ctx.inputs.companies), sources: list(ctx.config.sources), forms: list(ctx.config.forms), months: Number(ctx.config.months) || 12 };
    const bits = [scope.tickers?.length ? `${scope.tickers.join(", ")}` : "", (scope.sources ?? []).join(", "), (scope.forms ?? []).join(", ")].filter(Boolean);
    return { outputs: { docs: { scope } }, summary: bits.join(" · ") || "Your documents", preview: { kind: "list", items: (scope.sources ?? []).map((s) => ({ label: s })) } };
  },
});

register("docs.ask", {
  async start(ctx) {
    const question = typeof ctx.config.question === "string" ? ctx.config.question.trim() : "";
    if (!question) throw Object.assign(new Error("Write the question first."), { status: 400 });
    const scopes = (ctx.inputs.docs ?? []).map((v) => (v as { scope?: Scope }).scope).filter((s): s is Scope => !!s);
    const direct = tickersIn(ctx.inputs.docs);
    const scope: Scope = scopes.length
      ? { tickers: [...new Set(scopes.flatMap((s) => s.tickers ?? []))], sources: [...new Set(scopes.flatMap((s) => s.sources ?? []))], forms: [...new Set(scopes.flatMap((s) => s.forms ?? []))], months: Math.max(...scopes.map((s) => s.months ?? 12)) }
      : { tickers: direct, sources: ["sec"], forms: ["10-K", "10-Q", "8-K"], months: 12 };
    await ctx.progress("gather");
    const mode = ctx.config.mode === "balanced" ? "balanced" : "strict";
    const form = (["direct", "table", "timeline", "memo"] as const).find((f) => f === ctx.config.form) ?? "auto";
    let stage = "gather";
    const a = await askDocuments(ctx.userId, { question, mode, form, scope }, {
      deadline: ctx.deadline,
      progress: async (m) => { const next = /passages/.test(m) ? "retrieve" : /Writing/.test(m) ? "answer" : /Checking/.test(m) ? "check" : stage; stage = next; await ctx.progress(next, m); },
    });
    const value: Answer = { question: a.question, mode: a.mode, text: a.text, claims: a.claims, citations: a.citations, notFound: a.notFound, answerId: a.answerId };
    return {
      outputs: { answer: value },
      summary: a.notFound ? "Not found in the documents" : `${a.claims.length} cited claim${a.claims.length === 1 ? "" : "s"} from ${new Set(a.citations.map((c) => c.docId)).size} document${new Set(a.citations.map((c) => c.docId)).size === 1 ? "" : "s"}${a.contradictions.length ? `, ${a.contradictions.length} contradiction${a.contradictions.length === 1 ? "" : "s"} flagged` : ""}`,
      preview: { kind: "text", text: a.text.slice(0, 300) },
    };
  },
});

register("docs.changes", {
  async start(ctx) {
    const tickers = tickersIn(ctx.inputs.companies).slice(0, 3);
    if (!tickers.length) throw Object.assign(new Error("Wire in the companies to compare."), { status: 400 });
    const form = ctx.config.form === "10-Q" ? "10-Q" : "10-K";
    const section = ctx.config.section === "mdna" ? "mdna" : ctx.config.section === "all" ? "all" : "risk";
    const rows: Table["rows"] = [];
    const lines: string[] = [];
    const items: { label: string; detail: string }[] = [];
    for (const t of tickers) {
      await ctx.progress("fetch", `${t}: last two ${form}s`);
      const r = await changeRadar(t, form, section);
      await ctx.progress("summarize");
      for (const x of r.rows.slice(0, 60)) rows.push([t, x.status, x.text.slice(0, 500), x.before?.slice(0, 300) ?? "", x.similarity]);
      lines.push(`**${r.name}** (${form} ${r.prior?.filed ?? "?"} to ${r.current?.filed ?? "?"}): ${r.counts.added} added, ${r.counts.removed} removed, ${r.counts.changed} reworded.${r.summary.length ? ` ${r.summary.join(" ")}` : ""}`);
      items.push({ label: t, detail: `+${r.counts.added} −${r.counts.removed} ~${r.counts.changed}` });
    }
    const table: Table = { title: `${form} changes`, columns: [{ name: "ticker", type: "text" }, { name: "change", type: "cat" }, { name: "text", type: "text" }, { name: "before", type: "text" }, { name: "similarity", type: "num" }], rows };
    const memo: Memo = { title: `What changed in ${tickers.join(", ")}'s ${form} ${section === "risk" ? "risk factors" : section === "mdna" ? "MD&A" : "filings"}`, markdown: lines.join("\n\n"), sources: [] };
    return { outputs: { table, memo }, summary: items.map((i) => `${i.label} ${i.detail}`).join(" · "), preview: { kind: "list", items } };
  },
});
