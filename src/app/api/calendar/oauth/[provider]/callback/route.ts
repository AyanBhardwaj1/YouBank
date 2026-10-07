import { cookies } from "next/headers";
import { NextResponse, after } from "next/server";
import { currentUser } from "@/lib/auth/user";
import { checkAccountLimit, saveOAuthAccount } from "@/lib/calendar/accounts";
import { googleAddress, googleCalendarConfig, googleExchange } from "@/lib/calendar/providers/google";
import { microsoftAddress, microsoftConfig, microsoftExchange } from "@/lib/calendar/providers/microsoft";
import { syncAccount } from "@/lib/calendar/sync";
import { describeFailure } from "@/lib/errors";
import { CALENDAR_STATE_COOKIE } from "../connect/route";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The provider sends the person back here with a code: exchange it, store the account, sync after. */
export async function GET(req: Request, ctx: { params: Promise<{ provider: string }> }) {
  const url = new URL(req.url);
  const origin = url.origin;
  const back = (params: Record<string, string>) => NextResponse.redirect(`${origin}/app/settings?${new URLSearchParams({ tab: "calendar", ...params })}`);
  const user = await currentUser();
  if (!user) return NextResponse.redirect(`${origin}/sign-in`);
  const provider = (await ctx.params).provider;
  if (provider !== "google" && provider !== "microsoft") return back({ error: "Unknown calendar provider." });

  const denied = url.searchParams.get("error");
  if (denied) return back({ error: `The sign-in was cancelled (${denied.slice(0, 60)}). The calendar was not connected.` });
  const jar = await cookies();
  const expected = jar.get(CALENDAR_STATE_COOKIE)?.value;
  jar.delete(CALENDAR_STATE_COOKIE);
  const state = url.searchParams.get("state");
  if (!expected || !state || expected !== `${provider}.${state}`) return back({ error: "That sign-in could not be verified. Start the connection again." });
  const code = url.searchParams.get("code");
  if (!code) return back({ error: "No authorisation code came back." });

  try {
    let address: string;
    let tokens;
    if (provider === "google") {
      const cfg = googleCalendarConfig(origin);
      if (!cfg) return back({ error: "Google Calendar is not set up on this server." });
      tokens = await googleExchange(fetch, cfg, code);
      address = await googleAddress(fetch, tokens.access_token, tokens.id_token);
    } else {
      const cfg = microsoftConfig(origin);
      if (!cfg) return back({ error: "Microsoft 365 is not set up on this server." });
      tokens = await microsoftExchange(fetch, cfg, code);
      address = await microsoftAddress(fetch, tokens.access_token, tokens.id_token);
    }
    if (!address) return back({ error: "The provider did not say which account this is." });
    await checkAccountLimit(user, provider, address);
    const account = await saveOAuthAccount(user.id, provider, address, tokens);
    after(() => syncAccount(account).then(() => undefined, () => undefined));
    return back({ connected: address });
  } catch (e) {
    // Never put internal error text in a URL (browser history, request logs, Referer).
    return back({ error: describeFailure(e, 400, "calendar-oauth-callback").message });
  }
}
