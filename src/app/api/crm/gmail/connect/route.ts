import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/user";
import { encryptionReady } from "@/lib/crm/crypto";
import { authUrl, googleConfig } from "@/lib/crm/gmail";
import { describeFailure, logError } from "@/lib/errors";

export const dynamic = "force-dynamic";

export const OAUTH_STATE_COOKIE = "yb-gmail-state";

/** Start the Google consent flow. The state nonce is held in an httpOnly cookie and checked on return. */
export async function GET(req: Request) {
  const origin = new URL(req.url).origin;
  const user = await currentUser().catch((e) => { logError(e, { where: "gmail-connect-session" }); return null; });
  if (!user) return NextResponse.redirect(`${origin}/sign-in`);
  if (!encryptionReady()) {
    // The setting's name is for the operator's log, not the page.
    logError(new Error("EMAIL_TOKEN_SECRET is not set, so a mailbox cannot be connected"), { where: "gmail-connect" });
    return NextResponse.redirect(`${origin}/app/crm?error=${encodeURIComponent("Mailbox connections are not set up on this server yet, so a mailbox cannot be connected safely.")}`);
  }
  let url: string;
  try {
    const state = randomBytes(16).toString("base64url");
    url = authUrl(googleConfig(origin), state);
    (await cookies()).set(OAUTH_STATE_COOKIE, state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/", maxAge: 600 });
  } catch (e) {
    return NextResponse.redirect(`${origin}/app/crm?error=${encodeURIComponent(describeFailure(e, 400, "gmail-connect").message)}`);
  }
  return NextResponse.redirect(url);
}
