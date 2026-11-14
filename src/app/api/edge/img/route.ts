import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { cacheableImage } from "@/lib/edge/imgsrc";
import { getObject, putObject, r2Ready } from "@/lib/edge/infra/r2";
import { logError } from "@/lib/errors";
import { withinRate } from "@/lib/locks";
import { fetchRetry } from "@/lib/net";

export const dynamic = "force-dynamic";

const MAX_BYTES = 12 * 1024 * 1024;
const FOREVER = "private, max-age=31536000, immutable";

/**
 * GET ?u= — one satellite picture (src/lib/edge/imgsrc.ts), kept in R2 after the first view. Without R2 the
 * browser is sent to the source as before. Only pictures from the allowed hosts, only for signed-in people,
 * and never more than 12 MB; anything else is refused, so this is never an open proxy.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const src = new URL(req.url).searchParams.get("u") ?? "";
    if (!cacheableImage(src)) return NextResponse.json({ error: "That picture cannot be shown here." }, { status: 400 });
    if (!r2Ready()) return NextResponse.redirect(src, { status: 302 });
    if (!(await withinRate(`edge-img:${user.id}`, 900, 10 * 60_000))) return NextResponse.redirect(src, { status: 302 });
    const key = `img/v1/${createHash("sha256").update(src).digest("hex")}`;
    try {
      const hit = await getObject(key);
      if (hit?.body) return new Response(hit.body, { headers: { "content-type": hit.headers.get("content-type") ?? "image/png", "cache-control": FOREVER, "x-cache": "r2" } });
    } catch (e) { logError(e, { where: "edge-img-get" }); }
    const res = await fetchRetry(src, { cache: "no-store", timeoutMs: 20_000 }).catch(() => null);
    const type = res?.headers.get("content-type") ?? "";
    if (!res?.ok || !type.startsWith("image/")) return NextResponse.redirect(src, { status: 302 });
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return NextResponse.redirect(src, { status: 302 });
    await putObject(key, bytes, type, FOREVER).catch((e) => logError(e, { where: "edge-img-put" }));
    return new Response(bytes, { headers: { "content-type": type, "cache-control": FOREVER, "x-cache": "source" } });
  });
}
