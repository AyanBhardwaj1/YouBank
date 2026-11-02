import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { isAPIError } from "better-auth/api";
import { guarded } from "@/lib/auth/user";
import { auth } from "@/lib/auth/server";
import { grantStepUp, NOT_ENABLED_MESSAGE, STEP_UP_ATTEMPTS, STEP_UP_WINDOW_MS, stepUpState, TWO_FACTOR_REQUIRED, twoFactorEnabled } from "@/lib/auth/step-up";
import { rateLimit } from "@/lib/locks";
import { sameSiteJson, CROSS_SITE } from "@/lib/copytrade/access";

export const dynamic = "force-dynamic";

/** GET: `{ enabled, recent }`: whether 2FA is on, and whether a code was entered here in the last ten minutes. */
export async function GET() {
  return guarded(async (user) => NextResponse.json(await stepUpState(user)));
}

/**
 * POST { code }: check an authenticator code for the signed-in person and, when it matches, unlock risky
 * actions on this browser for ten minutes (src/lib/auth/step-up). Better Auth's own check has no attempt
 * limit for a signed-in person, so this route counts tries itself, per person, before checking.
 */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await rateLimit(`step-up:${user.id}`, STEP_UP_ATTEMPTS, STEP_UP_WINDOW_MS, "Too many codes tried. Wait 15 minutes and try again.");
    const body = (await req.json().catch(() => ({}))) as { code?: unknown };
    const code = String(body.code ?? "").replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code)) return NextResponse.json({ error: "Enter the 6-digit code from your authenticator app." }, { status: 400 });
    // Checked first: the plugin's check would otherwise finish a half-done enrolment on its own.
    if (!(await twoFactorEnabled(user.id))) return NextResponse.json({ error: NOT_ENABLED_MESSAGE, code: TWO_FACTOR_REQUIRED }, { status: 403 });
    try {
      await auth.api.verifyTOTP({ body: { code }, headers: await headers() });
    } catch (e) {
      // A wrong or stale code is the plugin's 401, which would read as "your session ended": a 400 instead.
      if (isAPIError(e) && e.statusCode < 500) return NextResponse.json({ error: "That code did not match. Check the time on your phone and try a new code." }, { status: 400 });
      throw e;
    }
    const until = await grantStepUp(user, new URL(req.url).protocol === "https:");
    return NextResponse.json({ ok: true, until: new Date(until).toISOString() });
  });
}
