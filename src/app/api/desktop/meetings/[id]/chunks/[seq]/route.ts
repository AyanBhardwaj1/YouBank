import { NextResponse } from "next/server";
import { guardedDesktop } from "@/lib/desktop/auth";
import { recordChunk } from "@/lib/meetings/pipeline";
import { parseLevels } from "@/lib/meetings/stitch";

export const dynamic = "force-dynamic";
export const maxDuration = 180;

/**
 * One chunk of meeting audio (about 30 seconds of 16 kHz mono WAV) as the raw body, with
 * ?start=<seconds into the meeting>&duration=<seconds>&frame=<seconds>&mic=<hex levels>&sys=<hex levels>.
 * It is transcribed now and the audio is dropped; the answer is its segments in meeting time, for the
 * copilot's rolling transcript. Sending the same chunk again replaces it.
 */
export async function PUT(req: Request, ctx: { params: Promise<{ id: string; seq: string }> }) {
  return guardedDesktop(req, async (user) => {
    const p = await ctx.params;
    const id = Number(p.id), seq = Number(p.seq);
    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(seq)) return NextResponse.json({ error: "bad request" }, { status: 400 });
    const q = new URL(req.url).searchParams;
    const frame = Number(q.get("frame"));
    const mic = parseLevels(q.get("mic")), sys = parseLevels(q.get("sys"));
    const r = await recordChunk(user, id, {
      seq, startSec: Number(q.get("start")), durationSec: Number(q.get("duration")),
      bytes: new Uint8Array(await req.arrayBuffer()), mime: (req.headers.get("content-type") ?? "audio/wav").split(";")[0].trim() || "audio/wav",
      activity: frame > 0 && mic.length ? { frameSec: frame, mic, sys } : null,
    });
    return NextResponse.json(r);
  }, { device: "required" });
}
