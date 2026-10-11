import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

/**
 * App pages: send visitors without a session cookie to sign-in, before rendering anything.
 *
 * Only the cookie's presence is checked here (no database read); every page and API route still checks
 * the session itself (currentUser), so a stale or forged cookie gets no further than the page's own
 * redirect or a 401. API routes are not matched: they answer 401 rather than redirect.
 */
export default function proxy(req: NextRequest) {
  // Development-only bypass, mirrored in currentUser(); never active in production builds.
  if (process.env.NODE_ENV !== "production" && process.env.YOUBANK_DEV_USER) return NextResponse.next();
  if (getSessionCookie(req)) return NextResponse.next();
  return NextResponse.redirect(new URL("/sign-in", req.url));
}

export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*"],
};
