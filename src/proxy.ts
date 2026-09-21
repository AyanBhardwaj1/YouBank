import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth/server";

const protect = auth.middleware({ loginUrl: "/sign-in" });

/** Redirect unauthenticated visitors to sign-in for app pages. API routes check sessions themselves and return 401. */
export default function proxy(req: NextRequest, ...rest: unknown[]) {
  // Development-only bypass, mirrored in currentUser(); never active in production builds.
  if (process.env.NODE_ENV !== "production" && process.env.YOUBANK_DEV_USER) return NextResponse.next();
  return (protect as unknown as (r: NextRequest, ...a: unknown[]) => unknown)(req, ...rest);
}

export const config = {
  matcher: ["/app/:path*", "/onboarding/:path*"],
};
