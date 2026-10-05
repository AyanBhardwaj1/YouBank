import { callerIp, pollDesktopPairing } from "@/lib/desktop/auth";
import { errorResponse } from "@/lib/errors";
import { withinRate } from "@/lib/locks";

export const dynamic = "force-dynamic";

/** Has the person approved the code? The first answer after approval carries the device token, once. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { poll?: unknown } | null;
  if (typeof body?.poll !== "string" || body.poll.length < 20 || body.poll.length > 100) return Response.json({ error: "bad request" }, { status: 400 });
  // Anyone can call this. The app polls every three seconds; this leaves room for several computers
  // connecting behind one address, and the app simply tries again after a 429.
  if (!(await withinRate(`desktop-poll:${callerIp(req)}`, 120, 60_000))) return Response.json({ error: "Too many checks. Try again in a minute." }, { status: 429 });
  try {
    return Response.json(await pollDesktopPairing(body.poll, req.headers.get("x-youbank-desktop") ?? ""), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
