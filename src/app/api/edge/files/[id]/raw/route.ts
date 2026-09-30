import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { currentUser } from "@/lib/auth/user";
import { getObject, partKey, partsForRange, PART_BYTES } from "@/lib/edge/infra/r2";
import { myTeamIds } from "@/lib/teams/db";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A stored file's bytes for the viewer (PDF pages, audio with seeking), to its owner or their team.
 * Supports byte ranges, read from the 4 MB parts that hold them.
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) return new Response("Sign in required", { status: 401 });
  const id = Number((await ctx.params).id);
  const [f] = await requireDb().select().from(schema.edgeFiles).where(eq(schema.edgeFiles.id, id));
  if (!f || (f.ownerId !== user.id && !(f.teamId && (await myTeamIds(user.id)).includes(f.teamId)))) return new Response("Not found", { status: 404 });
  const size = Number(f.bytes);
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.get("range") ?? "");
  const start = m && m[1] ? Number(m[1]) : m && m[2] ? Math.max(0, size - Number(m[2])) : 0;
  const end = m && m[1] && m[2] ? Math.min(size - 1, Number(m[2])) : m && !m[1] ? size - 1 : Math.min(size - 1, m ? start + 2 * PART_BYTES - 1 : size - 1);
  if (start >= size) return new Response(null, { status: 416, headers: { "content-range": `bytes */${size}` } });
  const pieces = partsForRange(size, start, end);
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const p of pieces) {
          const res = await getObject(partKey(f.r2Key, p.n), `bytes=${p.from}-${p.to}`);
          if (!res) throw new Error("missing part");
          controller.enqueue(new Uint8Array(await res.arrayBuffer()));
        }
        controller.close();
      } catch (e) { controller.error(e); }
    },
  });
  const headers: Record<string, string> = {
    "content-type": f.mime || "application/octet-stream", "accept-ranges": "bytes", "content-length": String(end - start + 1),
    "cache-control": "private, max-age=3600", "content-disposition": `inline; filename="${f.name.replace(/["\\]/g, "")}"`,
  };
  if (m) headers["content-range"] = `bytes ${start}-${end}/${size}`;
  return new Response(stream, { status: m ? 206 : 200, headers });
}
