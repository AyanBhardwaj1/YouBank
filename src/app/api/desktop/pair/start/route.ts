import { callerIp, cleanName, cleanPlatform, startDesktopPairing } from "@/lib/desktop/auth";
import { errorResponse } from "@/lib/errors";
import { withinRate } from "@/lib/locks";

export const dynamic = "force-dynamic";

/**
 * The desktop app asks to connect: a code to show the person, and a secret only the app holds to
 * collect its token. `approveUrl` is the page the app opens (in its own window, where the person is
 * usually signed in already) so approving is one click.
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { platform?: unknown; name?: unknown } | null;
  // Anyone can call this, so one caller gets a few codes a minute and cannot use up everyone's.
  if (!(await withinRate(`desktop-pair:${callerIp(req)}`, 10, 60_000))) return Response.json({ error: "Too many connection attempts. Try again in a minute." }, { status: 429 });
  try {
    const p = await startDesktopPairing(cleanPlatform(body?.platform), cleanName(body?.name));
    return Response.json({ ...p, approveUrl: `${new URL(req.url).origin}/desktop/connect?code=${p.code}` }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
