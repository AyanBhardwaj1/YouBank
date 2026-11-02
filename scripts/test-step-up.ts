/** Two-factor step-up checks (the pure parts, no database): pnpm exec tsx scripts/test-step-up.ts */
import { NEEDS_CODE_MESSAGE, NOT_ENABLED_MESSAGE, readStepUp, signStepUp, STEP_UP_TTL_MS, stepUpCookieOptions, stepUpVerdict, twoFactorRequired, TWO_FACTOR_REQUIRED } from "@/lib/auth/step-up";
import { errorResponse } from "@/lib/errors";
import { totpSecret } from "@/lib/client/step-up";
import { twoFactorPage } from "@/lib/auth/client";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};

void (async () => {
  const secret = "s".repeat(40), now = 1_800_000_000_000;

  console.log("step-up cookie");
  const v = signStepUp("user_1", secret, now);
  ok("round trip: good until ten minutes out", readStepUp(v, "user_1", secret, now + 1_000), now + STEP_UP_TTL_MS);
  ok("still good a moment before it runs out", readStepUp(v, "user_1", secret, now + STEP_UP_TTL_MS - 1) !== null, true);
  ok("expired at ten minutes", readStepUp(v, "user_1", secret, now + STEP_UP_TTL_MS), null);
  ok("another person's cookie does not count", readStepUp(v, "user_2", secret, now), null);
  ok("signed under another secret does not count", readStepUp(v, "user_1", "t".repeat(40), now), null);
  const [payload, mac] = v.split(".");
  const forged = Buffer.from(JSON.stringify({ u: "user_1", x: now + 9 * STEP_UP_TTL_MS })).toString("base64url");
  ok("a payload swapped under the same signature is refused", readStepUp(`${forged}.${mac}`, "user_1", secret, now), null);
  const other = Buffer.from(JSON.stringify({ u: "user_2", x: now + STEP_UP_TTL_MS })).toString("base64url");
  ok("another person's id under this signature is refused", readStepUp(`${other}.${mac}`, "user_2", secret, now), null);
  ok("a cut-off signature is refused", readStepUp(`${payload}.${mac.slice(0, 10)}`, "user_1", secret, now), null);
  ok("a flipped signature character is refused", readStepUp(`${payload}.${mac.slice(0, -1)}${mac.endsWith("A") ? "B" : "A"}`, "user_1", secret, now), null);
  ok("junk and empty are refused", [readStepUp("", "user_1", secret, now), readStepUp(undefined, "user_1", secret, now), readStepUp("abc", "user_1", secret, now), readStepUp(".x", "user_1", secret, now)], [null, null, null, null]);
  ok("no secret, no step-up", readStepUp(v, "user_1", "", now), null);
  const far = signStepUp("user_1", secret, now + 5 * STEP_UP_TTL_MS);
  ok("a cookie dated far ahead (clock trouble) does not stretch the window", readStepUp(far, "user_1", secret, now), null);
  ok("the cookie is httpOnly, lax, site-wide, ten minutes", stepUpCookieOptions(true), { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
  ok("secure only over https", stepUpCookieOptions(false).secure, false);

  console.log("requireRecentTwoFactor's decision");
  const decide = (enabled: boolean, cookie: string | undefined, userId = "user_1", at = now + 1_000) => stepUpVerdict(enabled, enabled && readStepUp(cookie, userId, secret, at) !== null);
  ok("2FA off: turn it on first, whatever the cookie", decide(false, v), { ok: false, reason: "not_enabled", message: NOT_ENABLED_MESSAGE });
  ok("2FA on, no cookie: enter a code", decide(true, undefined), { ok: false, reason: "needs_code", message: NEEDS_CODE_MESSAGE });
  ok("2FA on, fresh cookie: go ahead", decide(true, v), { ok: true });
  ok("2FA on, expired cookie: enter a code", decide(true, v, "user_1", now + STEP_UP_TTL_MS + 1).ok, false);
  ok("2FA on, someone else's cookie: enter a code", decide(true, v, "user_2").ok, false);
  ok("the messages say what to do", [NOT_ENABLED_MESSAGE, NEEDS_CODE_MESSAGE], ["Turn on two-factor authentication in Settings → Security first.", "Enter your authenticator code to continue."]);

  console.log("the refusal reaches the browser");
  const e = twoFactorRequired(NEEDS_CODE_MESSAGE);
  ok("a 403 with the code", [(e as { status?: number }).status, (e as { code?: string }).code], [403, TWO_FACTOR_REQUIRED]);
  const res = errorResponse(e);
  ok("guarded()'s answer carries error and code", [res.status, await res.json()], [403, { error: NEEDS_CODE_MESSAGE, code: TWO_FACTOR_REQUIRED }]);
  const pg = errorResponse(Object.assign(new Error("duplicate key"), { status: 409, code: "23505" }));
  ok("a database code never does", "code" in (await pg.json()), false);
  const sys = errorResponse(Object.assign(new Error("Too many"), { status: 429, code: "ECONNRESET" }));
  ok("nor a system one", "code" in (await sys.json()), false);

  console.log("browser helpers");
  ok("the secret from an otpauth link, in fours", totpSecret("otpauth://totp/YouBank:a%40b.io?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=YouBank&digits=6&period=30"), "JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
  ok("no secret, nothing shown", totpSecret("otpauth://totp/x?issuer=YouBank"), "");
  ok("the code page keeps a safe next", twoFactorPage("?next=%2Fapp%2Falgo%3Ftab%3Dbrokers"), "/sign-in/two-factor?next=%2Fapp%2Falgo%3Ftab%3Dbrokers");
  ok("an outside next is dropped", [twoFactorPage("?next=https://evil.example"), twoFactorPage("")], ["/sign-in/two-factor", "/sign-in/two-factor"]);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
