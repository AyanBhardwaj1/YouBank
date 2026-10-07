import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/user";
import { canUse } from "@/lib/billing/entitlements";
import { getAccount, listAccounts } from "@/lib/calendar/accounts";
import { googleAuthUrl, googleCalendarConfig } from "@/lib/calendar/providers/google";
import { microsoftAuthUrl, microsoftConfig } from "@/lib/calendar/providers/microsoft";
import { encryptionReady } from "@/lib/crm/crypto";

export const dynamic = "force-dynamic";

export const CALENDAR_STATE_COOKIE = "yb-cal-state";

/**
 * Start Google or Microsoft consent. The state nonce (with the provider and, for a reconnect, the
 * account) is held in an httpOnly cookie and checked on return. `?reconnect=<id>` signs an existing
 * account in again, which is always allowed; a new second account needs the plan that includes it.
 */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const url = new URL(req.url);
  const origin = url.origin;
  const back = (error: string) => NextResponse.redirect(`${origin}/app/settings?tab=calendar&error=${encodeURIComponent(error)}`);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${origin}/sign-in`);
  const provider = (await ctx.params).provider;
  if (provider !== "google" && provider !== "microsoft") return back("Unknown calendar provider.");
  if (!encryptionReady()) return back("EMAIL_TOKEN_SECRET is not set on the server, so a calendar cannot be connected safely.");
  const cfg = provider === "google" ? googleCalendarConfig(origin) : microsoftConfig(origin);
  if (!cfg) return back(`${provider === "google" ? "Google Calendar" : "Microsoft 365"} is not set up on this server yet.`);

  const reconnect = Number(url.searchParams.get("reconnect") ?? 0);
  const existing = reconnect > 0 ? await getAccount(user.id, reconnect).catch(() => null) : null;
  if (!existing && (await listAccounts(user.id).catch(() => [])).length >= 1 && !(await canUse(user, "calendar.multi_account"))) {
    return back("Connecting more than one calendar account is part of the Pro plan. Upgrade in Settings, under Plan.");
  }
  const nonce = randomBytes(16).toString("base64url");
  (await cookies()).set(CALENDAR_STATE_COOKIE, `${provider}.${nonce}`, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/", maxAge: 600 });
  const hint = existing?.address;
  return NextResponse.redirect(provider === "google" ? googleAuthUrl(cfg as Parameters<typeof googleAuthUrl>[0], nonce, hint) : microsoftAuthUrl(cfg as Parameters<typeof microsoftAuthUrl>[0], nonce, hint));
}
