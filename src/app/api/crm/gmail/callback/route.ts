import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { currentUser } from "@/lib/auth/user";
import { addressFor, saveAccount } from "@/lib/crm/accounts";
import { exchangeCode, googleConfig } from "@/lib/crm/gmail";
import { OAUTH_STATE_COOKIE } from "../connect/route";

export const dynamic = "force-dynamic";

/** Google sends the user back here with a code. Exchange it, store the mailbox, and return to the app. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const origin = url.origin;
  const back = (params: Record<string, string>) =>
    NextResponse.redirect(`${origin}/app/crm?${new URLSearchParams(params)}`);

  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${origin}/sign-in`);

  const denied = url.searchParams.get("error");
  if (denied) return back({ error: `Google returned "${denied}". The mailbox was not connected.` });

  const jar = await cookies();
  const expected = jar.get(OAUTH_STATE_COOKIE)?.value;
  jar.delete(OAUTH_STATE_COOKIE);
  const state = url.searchParams.get("state");
  if (!expected || !state || state !== expected) {
    return back({ error: "That sign-in could not be verified. Start the connection again from this page." });
  }

  const code = url.searchParams.get("code");
  if (!code) return back({ error: "Google did not return an authorisation code." });

  try {
    const cfg = googleConfig(origin);
    const tokens = await exchangeCode(cfg, code);
    const address = await addressFor(tokens.access_token);
    await saveAccount(user.id, {
      address,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? "",
      expiresIn: tokens.expires_in,
      scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
    });
    return back({ connected: address });
  } catch (e) {
    return back({ error: e instanceof Error ? e.message : String(e) });
  }
}
