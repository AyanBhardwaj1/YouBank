import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { ingestThread, listThreads, processThread } from "@/lib/crm/db";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  return guarded(async (user) => NextResponse.json(await listThreads(user.id)));
}

/**
 * Take in a thread and, unless asked not to, immediately read it.
 * Used by the mailbox sync and by pasting an email in by hand.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as {
      providerThreadId?: string; subject?: string; accountId?: number;
      messages?: { fromAddress?: string; fromName?: string; body?: string; direction?: string; sentAt?: string }[];
      process?: boolean;
    } | null;
    const messages = (body?.messages ?? []).filter((m) => m?.fromAddress && typeof m.body === "string");
    if (messages.length === 0) return NextResponse.json({ error: "At least one message with a sender and a body is required" }, { status: 400 });

    const thread = await ingestThread(user.id, {
      providerThreadId: body?.providerThreadId?.trim() || `manual-${Date.now()}`,
      accountId: body?.accountId ?? null,
      subject: body?.subject,
      messages: messages.map((m) => ({
        fromAddress: m.fromAddress!.trim(),
        fromName: m.fromName ?? "",
        body: m.body!,
        direction: m.direction === "outbound" ? "outbound" : "inbound",
        sentAt: m.sentAt ? new Date(m.sentAt) : null,
      })),
    });

    if (body?.process === false) return NextResponse.json({ thread }, { status: 201 });
    const result = await processThread(user.id, thread.id);
    return NextResponse.json(result, { status: 201 });
  });
}
