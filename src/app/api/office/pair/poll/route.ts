import { pollPairing } from "@/lib/office/auth";
import { handled } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** Has the person approved the code? The first answer after approval carries the device token, once. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { poll?: unknown } | null;
  if (typeof body?.poll !== "string" || body.poll.length < 20 || body.poll.length > 100) return Response.json({ error: "bad request" }, { status: 400 });
  const poll = body.poll;
  return handled(async () => Response.json(await pollPairing(poll), { headers: { "Cache-Control": "no-store" } }));
}
