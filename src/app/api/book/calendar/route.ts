import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { bookCalendar } from "@/lib/book/calendar";
import { evaluateBook, loadBook } from "@/lib/book/store";
import { siteLink } from "@/lib/site";

export const dynamic = "force-dynamic";

/** GET: the book's earnings dates and catalysts as an iCalendar file, for Outlook, Google or Apple Calendar. */
export async function GET() {
  return guarded(async (user) => {
    await rateLimit(`book-calendar:${user.id}`, 60, 3_600_000, "The calendar was downloaded many times this hour. Try again later.");
    const evals = await evaluateBook(await loadBook(user.id));
    const ics = bookCalendar(evals, siteLink("/").replace(/\/$/, ""));
    return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Content-Disposition": `attachment; filename="youbank-book-${new Date().toISOString().slice(0, 10)}.ics"`, "Cache-Control": "no-store" } });
  });
}
