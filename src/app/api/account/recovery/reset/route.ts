import { NextResponse } from "next/server";
import { resetWithRecoveryKey } from "@/lib/auth/recovery";
import { setupState } from "@/lib/setup";
import { errorResponse } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * POST { email, key, password }: set a new password with the recovery key (src/lib/auth/recovery.ts).
 * Signed out by definition. Answers { newKey } on success: the old key is spent and this one replaces it.
 */
export async function POST(req: Request) {
  try {
    await setupState().catch(() => undefined);
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === "string" ? v : "");
    const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const r = await resetWithRecoveryKey({ email: str(body.email).slice(0, 320), key: str(body.key).slice(0, 80), password: str(body.password), ip });
    if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status });
    return NextResponse.json({ ok: true, newKey: r.newKey }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
