import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/user";
import { encryptionReady } from "@/lib/crm/crypto";
import { authUrl, googleConfig } from "@/lib/crm/gmail";

export const dynamic = "force-dynamic";

export const OAUTH_STATE_COOKIE = "yb-gmail-state";

/** Start the Google consent flow. The state nonce is held in an httpOnly cookie and checked on return. */
export async function GET(req: Request) {
  const user = await currentUser();
  const origin = new URL(req.url).origin;
  if (!user) return NextResponse.redirect(`${origin}/sign-in`);
  if (!encryptionReady()) {
    return NextResponse.redirect(`${origin}/app/crm?error=${encodeURIComponent("EMAIL_TOKEN_SECRET is not set, so a mailbox cannot be connected safely.")}`);
  }
  let url: string;
  try {
    const state = randomBytes(16).toString("base64url");
    url = authUrl(googleConfig(origin), state);
    (await cookies()).set(OAUTH_STATE_COOKIE, state, { httpOnly: true, secure: origin.startsWith("https"), sameSite: "lax", path: "/", maxAge: 600 });
  } catch (e) {
    return NextResponse.redirect(`${origin}/app/crm?error=${encodeURIComponent(e instanceof Error ? e.message : String(e))}`);
  }
  return NextResponse.redirect(url);
}
