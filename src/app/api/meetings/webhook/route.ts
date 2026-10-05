import { NextResponse } from "next/server";
import { errorResponse } from "@/lib/errors";
import { botProvider } from "@/lib/meetings/bot";
import { onBotWebhook } from "@/lib/meetings/pipeline";
import { meetingOwner } from "@/lib/meetings/views";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * The notetaker service's webhooks (Recall.ai, signed with RECALL_WEBHOOK_SECRET under the Svix
 * scheme). Unsigned or stale deliveries are refused. A bot's progress updates its meeting; a finished
 * recording brings in the transcript and starts the notes.
 */
export async function POST(req: Request) {
  const provider = botProvider();
  const body = await req.text();
  if (!provider.verifyWebhook(req.headers, body)) return NextResponse.json({ error: "bad signature" }, { status: 401 });
  try {
    const event = provider.parseWebhook(JSON.parse(body));
    if (event) await onBotWebhook(event, meetingOwner);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
