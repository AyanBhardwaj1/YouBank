import { withinRate } from "@/lib/locks";
import { startPairing } from "@/lib/office/auth";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/** The add-in asks to connect: a code to show the person, and a secret only the add-in holds to collect its token. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { host?: string } | null;
  const host = body?.host === "PowerPoint" ? "PowerPoint" : body?.host === "Excel" ? "Excel" : "Office";
  // Anyone can call this, so one caller gets a few codes a minute and cannot use up everyone's.
  const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (!(await withinRate(`office-pair:${ip}`, 10, 60_000))) return Response.json({ error: "Too many connection attempts. Try again in a minute." }, { status: 429 });
  try {
    const p = await startPairing(host);
    return Response.json({ ...p, approveUrl: `${new URL(req.url).origin}/office/connect?code=${p.code}` });
  } catch (e) {
    return errorResponse(e);
  }
}
