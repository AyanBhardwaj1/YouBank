import { guarded } from "@/lib/auth/user";
import { csvRow } from "@/lib/csv";
import { rateLimit } from "@/lib/locks";
import { journalRows } from "@/lib/book/decisions";
import { loadBook, loadJournal } from "@/lib/book/store";

export const dynamic = "force-dynamic";

/** GET: every position's decision journal, open and closed, as CSV: one dated row per entry, with who wrote it. */
export async function GET() {
  return guarded(async (user) => {
    await rateLimit(`book-export:${user.id}`, 60, 3_600_000, "The book was exported many times this hour. Try again later.");
    const [open, closed] = await Promise.all([loadBook(user.id), loadJournal(user.id)]);
    const csv = journalRows(open, closed).map(csvRow).join("\r\n") + "\r\n";
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="youbank-decision-journal-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store" } });
  });
}
