import { NextResponse, after } from "next/server";
import { guarded } from "@/lib/auth/user";
import { connectCalDav, connectIcs, toSafe } from "@/lib/calendar/accounts";
import { syncAccount } from "@/lib/calendar/sync";
import { errorResponse } from "@/lib/errors";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Connect a CalDAV account ({ kind: "caldav", preset?, serverUrl?, username, password, name? }) or
 * subscribe to an ICS link ({ kind: "ics", url, name? }). Signed in and checked before anything is
 * saved; the first sync runs after the response.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { kind?: string; preset?: string; serverUrl?: string; username?: string; password?: string; url?: string; name?: string } | null;
    if (!body?.kind) return NextResponse.json({ error: "Choose what to connect." }, { status: 400 });
    await rateLimit(`calendar-connect:${user.id}`, 10, 3_600_000, "Too many connection attempts this hour. Check the details and try again later.");
    try {
      const account = body.kind === "ics"
        ? await connectIcs(user, { url: body.url ?? "", name: body.name })
        : await connectCalDav(user, { preset: body.preset, serverUrl: body.serverUrl, username: body.username ?? "", password: body.password ?? "", name: body.name });
      after(() => syncAccount(account).then(() => undefined, () => undefined));
      return NextResponse.json(toSafe(account), { status: 201 });
    } catch (e) {
      return errorResponse(e, 400);
    }
  });
}
