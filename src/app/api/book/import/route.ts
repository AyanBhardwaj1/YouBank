import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { SAMPLE_SOURCE } from "@/lib/book/forecast";
import { defaultTemplate, newId, parseImport, SAMPLE_BOOK, SAMPLE_CONVICTION, TEMPLATES } from "@/lib/book/position";
import { addPositions } from "@/lib/book/store";

export const dynamic = "force-dynamic";

/**
 * POST { text, template } adds positions from pasted spreadsheet rows (src/lib/book/position.ts parseImport),
 * each starting with a template's kill criteria ("auto": growth for longs, the short template for shorts;
 * "none": none, to write later). POST { sample: true } adds the sample book. Existing tickers are kept.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    await rateLimit(`book-import:${user.id}`, 30, 3_600_000, "Many imports this hour. Try again later.");
    const b = ((await req.json().catch(() => ({}))) ?? {}) as { text?: unknown; template?: unknown; sample?: unknown };
    if (b.sample === true) {
      const by = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
      const r = await addPositions(user.id, SAMPLE_BOOK.map((p) => (SAMPLE_CONVICTION[p.ticker] ? { ...p, conviction: { p: SAMPLE_CONVICTION[p.ticker], by, source: SAMPLE_SOURCE } } : p)));
      return NextResponse.json({ ...r, problems: [] });
    }
    if (typeof b.text !== "string" || !b.text.trim()) return NextResponse.json({ error: "Paste at least one line with a ticker." }, { status: 400 });
    const { rows, problems } = parseImport(b.text.slice(0, 50_000));
    if (!rows.length) return NextResponse.json({ error: problems[0] ?? "No positions were found in what you pasted." }, { status: 400 });
    const pick = (d: "long" | "short") => (b.template === "none" ? null : TEMPLATES.find((t) => t.id === b.template) ?? defaultTemplate(d));
    const r = await addPositions(user.id, rows.map((row) => {
      const t = pick(row.direction);
      return { ...row, thesis: row.thesis || t?.thesis || `${row.direction === "long" ? "Long" : "Short"} ${row.ticker}: write the thesis.`, criteria: (t?.criteria ?? []).map((c) => ({ ...c, id: newId() })) };
    }));
    return NextResponse.json({ ...r, problems });
  });
}
