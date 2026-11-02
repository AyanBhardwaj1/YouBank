import { optOutAddress, readUnsubscribeToken } from "@/lib/crm/compliance";
import { logError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * The unsubscribe link in campaign and nurture mail (src/lib/crm/compliance.ts).
 *
 * GET shows a one-button page: link scanners and previews open links, so opening it changes nothing.
 * POST unsubscribes, from that button or from a mail client's one-click unsubscribe (RFC 8058 sends
 * `List-Unsubscribe=One-Click` here). No sign-in: the signed token names the sender and the address.
 */
const page = (title: string, body: string, status = 200) =>
  new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body><main><h1>${title}</h1>${body}</main></body></html>`, {
    status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });

const INVALID = () => page("This link is not valid", "<p>It may have been cut off when it was copied. Reply to the email with the word \"unsubscribe\" instead, and the sender will stop.</p>", 400);
const UNAVAILABLE = () => page("Something went wrong", "<p>Your request was not saved. Try again in a minute, or reply to the email with the word \"unsubscribe\".</p>", 503);

/** Who a link is for; null for a bad link; "unavailable" when it cannot be checked here (the signing key is not set). */
function who(token: string): { userId: string; email: string } | null | "unavailable" {
  try { return readUnsubscribeToken(token); } catch (e) { logError(e, { where: "unsubscribe-key" }); return "unavailable"; }
}

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const w = who(token);
  if (w === "unavailable") return UNAVAILABLE();
  if (!w) return INVALID();
  return page("Unsubscribe", `<p>Stop outreach emails from this sender to ${w.email.replace(/[<>&"]/g, "")}?</p><form method="post"><button type="submit">Unsubscribe</button></form>`);
}

export async function POST(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const w = who(token);
  if (w === "unavailable") return UNAVAILABLE();
  if (!w) return INVALID();
  try {
    await optOutAddress(w.userId, w.email);
  } catch (e) {
    logError(e, { where: "unsubscribe" });
    return UNAVAILABLE();
  }
  return page("You are unsubscribed", "<p>This sender's outreach emails will stop. Replies in a conversation you started are not affected.</p>");
}
