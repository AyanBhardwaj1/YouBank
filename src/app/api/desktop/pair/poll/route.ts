import { pollDesktopPairing } from "@/lib/desktop/auth";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** Has the person approved the code? The first answer after approval carries the device token, once. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { poll?: unknown } | null;
  if (typeof body?.poll !== "string" || body.poll.length < 20 || body.poll.length > 100) return Response.json({ error: "bad request" }, { status: 400 });
  try {
    return Response.json(await pollDesktopPairing(body.poll, req.headers.get("x-youbank-desktop") ?? ""), { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
