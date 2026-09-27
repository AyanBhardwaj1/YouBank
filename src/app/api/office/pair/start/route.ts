import { startPairing } from "@/lib/office/auth";

export const dynamic = "force-dynamic";

/** The add-in asks to connect: a code to show the person, and a secret only the add-in holds to collect its token. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { host?: string } | null;
  const host = body?.host === "PowerPoint" ? "PowerPoint" : body?.host === "Excel" ? "Excel" : "Office";
  try {
    const p = await startPairing(host);
    return Response.json({ ...p, approveUrl: `${new URL(req.url).origin}/office/connect?code=${p.code}` });
  } catch (e) {
    const status = typeof (e as { status?: unknown })?.status === "number" ? (e as { status: number }).status : 500;
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status });
  }
}
