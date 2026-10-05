import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";

const protect = auth.middleware({ loginUrl: "/sign-in" });

/**
 * App pages: redirect unauthenticated visitors to sign-in.
 *
 * API routes check sessions themselves and return 401, but they pass through here too, for one reason:
 * the short-lived signed session cookie is only re-minted here (and by the auth routes). Without it,
 * someone who keeps a page open, with the bell, the feed or the terminal polling, would make every
 * poll ask Neon Auth for their session once the cookie expired, and Neon Auth rate-limits those calls
 * from our servers (the load test signed people out that way). A sign-in redirect is never applied to
 * an API route. Stripe's webhook (`/api/billing/webhook`) carries no session and skips this entirely.
 */
export default async function proxy(req: NextRequest, ...rest: unknown[]) {
  // Development-only bypass, mirrored in currentUser(); never active in production builds.
  if (process.env.NODE_ENV !== "production" && process.env.YOUBANK_DEV_USER) return NextResponse.next();
  const res = (await (protect as unknown as (r: NextRequest, ...a: unknown[]) => Promise<Response>)(req, ...rest)) as NextResponse;
  if (req.nextUrl.pathname.startsWith("/api/") && res.headers.get("location")) return NextResponse.next();
  return res;
}

export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*", "/api/((?!auth/|cron/|health/|market/health|office/pair/|inngest|billing/webhook$).*)"],
};
