import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { lease } from "@/lib/locks";
import { botProvider } from "@/lib/meetings/bot";
import { onBotWebhook } from "@/lib/meetings/pipeline";
import { meetingOwner } from "@/lib/meetings/views";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The notetaker service's webhooks (Recall.ai, signed with RECALL_WEBHOOK_SECRET under the Svix
 * scheme). Unsigned or stale deliveries are refused, and a delivery already handled (the same message
 * id, within the signature's five-minute window and a margin) is acknowledged without acting again. A
 * bot's progress updates its meeting; a finished recording brings in the transcript and starts the notes.
 */
export async function POST(req: Request) {
  const provider = botProvider();
  const body = await req.text();
  if (!provider.verifyWebhook(req.headers, body)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  const messageId = (req.headers.get("svix-id") ?? req.headers.get("webhook-id") ?? "").slice(0, 200);
  // Held for longer than the timestamp tolerance, so a replayed message is refused for as long as its
  // signature would still pass. Released on failure, so the sender's retry (same id) is handled.
  const release = await lease(`recall-webhook:${messageId}`, 15 * 60_000);
  if (!release) return NextResponse.json({ ok: true, duplicate: true });
  let event;
  try {
    event = provider.parseWebhook(JSON.parse(body));
  } catch {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }
  try {
    if (event) await onBotWebhook(event, meetingOwner);
    return NextResponse.json({ ok: true });
  } catch (e) {
    await release();
    return errorResponse(e);
  }
}
