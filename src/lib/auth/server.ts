import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { twoFactor } from "better-auth/plugins";
import { requireDb, schema } from "@/db";
import { authBaseUrl, authTrustedOrigins } from "./origins";
import { mailConfigured, resetEmail, sendMail } from "./mail";
import { ACCOUNT_LIMITED, AUTH_RATE_RULES, accountLimit, authRateStorage } from "./rate-limit";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { botCheck } from "./bot";

/**
 * How long the signed session cookie is trusted before the session is read from the database again
 * (seconds). Fifteen minutes keeps polling pages from costing a query each; the cost is that a session
 * revoked elsewhere keeps working for up to that long.
 */
export const SESSION_DATA_TTL = Math.min(Math.max(Number(process.env.AUTH_SESSION_DATA_TTL) || 900, 60), 3_600);

/** Whether Google sign-in is offered: only with both halves of an OAuth client. */
export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

function build() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("Sign-in is not configured: BETTER_AUTH_SECRET must be set");
  const clientId = process.env.GOOGLE_CLIENT_ID, clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  // Google sends people back here, so it must be the address registered with the OAuth client. On a
  // preview deployment it is the preview's own address (src/lib/auth/origins).
  const baseURL = authBaseUrl(process.env);
  return betterAuth({
    baseURL,
    // Every address this deployment answers on may post to sign-in (the custom domain, the vercel.app
    // address, this deployment's own URLs); anything else is refused as cross-site.
    trustedOrigins: authTrustedOrigins(process.env),
    secret,
    database: drizzleAdapter(requireDb(), {
      provider: "pg",
      schema: { user: schema.authUsers, session: schema.authSessions, account: schema.authAccounts, verification: schema.authVerifications, twoFactor: schema.authTwoFactor },
    }),
    // Email and password always; Google when its OAuth client is set. A forgotten password is reset with the
    // recovery key (src/lib/auth/recovery.ts), or by an emailed link when a mail sender is set (./mail.ts).
    emailAndPassword: {
      enabled: true, minPasswordLength: 10, maxPasswordLength: 128, autoSignIn: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      revokeSessionsOnPasswordReset: true,
      ...(mailConfigured() ? {
        sendResetPassword: async ({ user, url }: { user: { email: string; name?: string | null }; url: string }) => {
          const m = resetEmail(user.name ?? "", url);
          await sendMail(user.email, m.subject, m.text, m.html);
        },
      } : {}),
    },
    socialProviders: clientId && clientSecret ? { google: { clientId, clientSecret, prompt: "select_account" } } : {},
    session: { cookieCache: { enabled: true, maxAge: SESSION_DATA_TTL } },
    account: { encryptOAuthTokens: true },
    // Limits shared by every instance (the default memory store is per instance on serverless). On in
    // production builds only, as Better Auth's default is.
    rateLimit: { customStorage: authRateStorage, customRules: AUTH_RATE_RULES },
    // Per account as well as per address: password guessing against one account stops after a few tries,
    // from any number of addresses, while a room sharing one address can still all sign in.
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-in/email" && !(await accountLimit((ctx.body as { email?: unknown } | undefined)?.email))) {
          throw new APIError("TOO_MANY_REQUESTS", { message: ACCOUNT_LIMITED });
        }
        // Bots: sign-up and reset-link requests pass Turnstile (when set up) and the honeypot (./bot.ts).
        const refused = await botCheck(ctx.path, ctx.headers);
        if (refused) throw new APIError("FORBIDDEN", { message: refused });
      }),
    },
    advanced: {
      // Secure (HTTPS-only) cookies wherever the site is served over HTTPS; plain http only on localhost.
      useSecureCookies: baseURL.startsWith("https://"),
      // Vercel sets x-real-ip to the caller's address; the limits are counted per address.
      ipAddress: { ipAddressHeaders: ["x-real-ip", "x-forwarded-for"] },
    },
    plugins: [
      // An authenticator app (TOTP) and backup codes. Password sign-in with it on stops at
      // /sign-in/two-factor for a code; Google sign-in is not challenged by the plugin, so risky actions
      // ask for a fresh code themselves (src/lib/auth/step-up). Google-only accounts have no password,
      // so they enrol and disable without one (a password is still asked for when the account has one).
      twoFactor({ issuer: "YouBank", allowPasswordless: true }),
      // Lets server actions and route handlers set the refreshed session cookie through next/headers.
      // Must stay last.
      nextCookies(),
    ],
  });
}

type Auth = ReturnType<typeof build>;
let instance: Auth | null = null;

/**
 * Sign-in (Better Auth, self-hosted on our own database): the handler and session access.
 *
 * Built on first use, not at import: a missing setting would otherwise fail every module that touches
 * the session (every API route) before any of them could answer, leaving bare 500 pages and a health
 * check that cannot report the missing setting. Built lazily, the error is thrown from the call, where
 * guarded() and the error pages turn it into a referenced "our side" message and /api/health names it.
 */
export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop) {
    instance ??= build();
    const value = Reflect.get(instance, prop, instance) as unknown;
    return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(instance) : value;
  },
});
