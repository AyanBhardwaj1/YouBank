import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/user";
import { requestMeta } from "@/lib/algo/access";
import { alpacaCallback } from "@/lib/algo/connections";
import { describeFailure } from "@/lib/errors";
import { siteLink } from "@/lib/site";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * GET ?code&state — Alpaca sends the person back here. A top-level navigation from Alpaca, so it is not a
 * JSON request; it is protected by the signed state (this person, ten minutes) instead. Back to the page
 * either way, with a plain message on failure.
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(siteLink("/sign-in"));
  const back = (q: string) => NextResponse.redirect(siteLink(`/app/algo?tab=brokers&${q}`));
  if (u.searchParams.get("error")) return back("connected=0");
  try {
    await alpacaCallback(user, u.searchParams.get("code") ?? "", u.searchParams.get("state") ?? "", requestMeta(req));
    return back("connected=1");
  } catch (e) {
    return back(`connected=0&reason=${encodeURIComponent(describeFailure(e, 400, "alpaca-callback").message.slice(0, 200))}`);
  }
}
