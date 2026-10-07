/**
 * LlamaParse (premium: edge.parse-llamaparse) for PDFs the free reader handles badly: scans, CIMs and
 * data-room decks whose tables matter. The file goes to LlamaParse's API v2 in one multipart upload
 * (POST /api/v2/parse/upload with the file and a configuration naming the tier), the job is polled
 * (GET /api/v2/parse/{id}?expand=markdown) until it is COMPLETED, and each page's Markdown becomes
 * Edge's parts: headings, paragraphs and tables (Markdown pipe tables and HTML tables both), so the
 * passages keep their tables whole, as the free reader's do.
 *
 * Billing is in credits per page by tier (agentic: 10; LLAMAPARSE_TIER changes it), at $1.25 per 1,000
 * credits after 10,000 free a month. The person's plan is checked before anything is sent.
 */
import { tableParts, type Part } from "../docs/chunk";
import { partsFromHtml } from "../docs/html";

export const llamaBase = () => (process.env.LLAMA_CLOUD_BASE_URL?.trim() || "https://api.cloud.llamaindex.ai").replace(/\/+$/, "");
export const LLAMA_TIERS: Record<string, number> = { fast: 1, cost_effective: 3, agentic: 10, agentic_plus: 45 };
export const llamaTier = () => { const t = process.env.LLAMAPARSE_TIER?.trim() ?? ""; return t in LLAMA_TIERS ? t : "agentic"; };
export const USD_PER_CREDIT = 1.25 / 1000;
/** LlamaParse takes large files, but a function holds the whole file in memory to send it. */
export const LLAMA_MAX_BYTES = 50 * 1024 * 1024;

/** What one job costs at list price: pages by the tier's credits. Pure. */
export const llamaCost = (pages: number, tier = llamaTier()) => pages * (LLAMA_TIERS[tier] ?? 10) * USD_PER_CREDIT;

/** The upload request (multipart: the file and its configuration). */
export function llamaUpload(bytes: Uint8Array, name: string, mime: string, key: string, tier = llamaTier()): { url: string; init: RequestInit } {
  const form = new FormData();
  form.append("file", new Blob([bytes.slice().buffer as ArrayBuffer], { type: mime || "application/pdf" }), name || "document.pdf");
  form.append("configuration", JSON.stringify({ tier, version: "latest" }));
  return { url: `${llamaBase()}/api/v2/parse/upload`, init: { method: "POST", headers: { authorization: `Bearer ${key}`, accept: "application/json" }, body: form } };
}

export type LlamaJob = { id: string; status: string; error: string; pages: { n: number; markdown: string }[] };

/**
 * A job as the API returns it, whether the fields sit at the top or under `job`, with its Markdown
 * pages once COMPLETED. Pure; throws when there is no job id at all.
 */
export function parseLlamaJob(j: unknown): LlamaJob {
  const o = (j ?? {}) as { id?: unknown; status?: unknown; error_message?: unknown; job?: { id?: unknown; status?: unknown; error_message?: unknown }; markdown?: { pages?: { page_number?: unknown; markdown?: unknown; success?: unknown }[] } };
  const id = String(o.job?.id ?? o.id ?? "");
  if (!id) throw new Error("LlamaParse's answer has no job id");
  const status = String(o.job?.status ?? o.status ?? "PENDING").toUpperCase();
  const error = String(o.job?.error_message ?? o.error_message ?? "");
  const pages = (o.markdown?.pages ?? [])
    .filter((p) => p && p.success !== false && typeof p.markdown === "string")
    .map((p, i) => ({ n: Number(p.page_number) || i + 1, markdown: String(p.markdown) }));
  return { id, status, error, pages };
}

const isRule = (cells: string[]) => cells.length > 0 && cells.every((c) => /^:?-{2,}:?$/.test(c.trim()));
const pipeCells = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.replace(/\\\|/g, "|").replace(/\*\*/g, "").trim());

/**
 * A page of Markdown as parts: "#" headings, paragraphs, pipe tables (the row under a header is a rule
 * of dashes) and HTML tables (LlamaParse writes merged cells that way). Emphasis marks and image links
 * are dropped. Pure.
 */
export function partsFromMarkdown(md: string): Part[] {
  const out: Part[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  const flush = () => {
    const text = para.join(" ").replace(/!\[[^\]]*\]\([^)]*\)/g, "").replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim();
    if (text) out.push({ kind: "text", text });
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trim();
    if (!t) { flush(); continue; }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) { flush(); const text = h[2].replace(/\*\*|__/g, "").replace(/#+\s*$/, "").trim(); if (text) out.push({ kind: "heading", text }); continue; }
    if (/^<table\b/i.test(t)) {
      flush();
      const block: string[] = [line];
      while (!/<\/table>/i.test(block[block.length - 1]) && i + 1 < lines.length) block.push(lines[++i]);
      out.push(...partsFromHtml(block.join("\n")));
      continue;
    }
    if (t.startsWith("|")) {
      flush();
      const rows: string[][] = [];
      let header = 0;
      for (; i < lines.length && lines[i].trim().startsWith("|"); i++) {
        const cells = pipeCells(lines[i]);
        if (isRule(cells)) { header = rows.length; continue; }
        rows.push(cells);
      }
      i--;
      const parts = tableParts(rows);
      // Keep the header Markdown marked when the table finder found none of its own.
      out.push(...parts.map((p) => (p.kind === "table" && !p.head && header ? { ...p, head: Math.min(header, p.rows.length - 1) } : p)));
      continue;
    }
    // A list item is its own paragraph, so a list of risks does not run together.
    if (/^([-*+]|\d+[.)])\s+/.test(t)) flush();
    para.push(t.replace(/^[-*+]\s+/, "• "));
  }
  flush();
  return out;
}
