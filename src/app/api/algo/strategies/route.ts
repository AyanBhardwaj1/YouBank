import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { CROSS_SITE, requestMeta, requireConsent, sameSiteJson } from "@/lib/algo/access";
import { createStrategy } from "@/lib/algo/store";
import { templateSpec } from "@/lib/algo/strategy";
import { hubView } from "@/lib/algo/views";
import { rateLimit } from "@/lib/locks";

export const dynamic = "force-dynamic";

/** GET — the person's strategies, plan, switches, consents and the templates. Free. */
export async function GET() {
  return guarded(async (user) => NextResponse.json(await hubView(user)));
}

/** POST { spec } or { templateId } — create a strategy in paper mode. Free (up to the plan's count). */
export async function POST(req: Request) {
  if (!sameSiteJson(req)) return NextResponse.json(CROSS_SITE, { status: 403 });
  return guarded(async (user) => {
    await rateLimit(`algo-create:${user.id}`, 20, 60_000, "Too many new strategies at once. Wait a moment.");
    await requireConsent(user.id, "terms");
    const body = (await req.json().catch(() => ({}))) as { spec?: unknown; templateId?: unknown };
    const spec = typeof body.templateId === "string" ? templateSpec(body.templateId) : body.spec;
    if (!spec) return NextResponse.json({ error: "Choose a template or write a strategy." }, { status: 400 });
    const row = await createStrategy(user, spec, requestMeta(req), typeof body.templateId === "string" ? "template" : "user");
    return NextResponse.json({ id: row.id });
  });
}
