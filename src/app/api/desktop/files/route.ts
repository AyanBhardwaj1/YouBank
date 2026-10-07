import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { checkFiles, fileQuota, removeFile, startFile, type CheckItem } from "@/lib/desktop/files";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

/**
 * Local files into Edge documents. Two steps share this route:
 * - { check: [{ pathKey, sha256 }] }: which of a folder's files are new or changed (nothing is sent for the rest);
 * - { pathKey, sha256, name, mime, bytes }: start one upload; the parts then go to /files/:id/part and
 *   /files/:id/complete. A new file past the free allowance needs the plan, checked here first.
 */
export async function POST(req: Request) {
  return guardedDesktop(req, async (user, device) => {
    if (!device) return NextResponse.json({ error: "bad request" }, { status: 400 });
    const body = (await req.json().catch(() => null)) as ({ check?: CheckItem[] } & Partial<{ pathKey: string; sha256: string; name: string; mime: string; bytes: number }>) | null;
    if (!body) return NextResponse.json({ error: "bad request" }, { status: 400 });
    if (Array.isArray(body.check)) {
      const [states, quota] = await Promise.all([checkFiles(user.id, device.id, body.check), fileQuota(user)]);
      return NextResponse.json({ states, quota });
    }
    await rateLimit(`desktop-files:${user.id}`, 300, 3_600_000, "Many files have been indexed in the last hour. The app will carry on later.");
    if (!body.name || !body.bytes || !body.pathKey || !body.sha256) return NextResponse.json({ error: "Name, size and hashes are needed." }, { status: 400 });
    return NextResponse.json(await startFile(user, device, { pathKey: body.pathKey, sha256: body.sha256, name: body.name, mime: body.mime ?? "", bytes: Number(body.bytes) }));
  }, { device: "required" });
}

/** Remove a local file from YouBank (?pathKey=): its document is deleted unless a copy elsewhere still uses it. */
export async function DELETE(req: Request) {
  return guardedDesktop(req, async (user, device) => {
    if (!device) return NextResponse.json({ error: "bad request" }, { status: 400 });
    await removeFile(user.id, device.id, new URL(req.url).searchParams.get("pathKey") ?? "");
    return NextResponse.json({ ok: true });
  }, { device: "required" });
}
