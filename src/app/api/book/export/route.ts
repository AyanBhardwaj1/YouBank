import { guarded } from "@/lib/auth/user";
import { csvRow } from "@/lib/csv";
import { rateLimit } from "@/lib/locks";
import { bookRows } from "@/lib/book/position";
import { evaluateBook, loadBook } from "@/lib/book/store";

export const dynamic = "force-dynamic";

/** GET: the book as CSV, one row per kill criterion with its figure, headroom, state and source. */
export async function GET() {
  return guarded(async (user) => {
    await rateLimit(`book-export:${user.id}`, 60, 3_600_000, "The book was exported many times this hour. Try again later.");
    const positions = await loadBook(user.id);
    const evals = await evaluateBook(positions);
    const csv = bookRows(evals, positions).map(csvRow).join("\r\n") + "\r\n";
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="youbank-book-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  });
}
