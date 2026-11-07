import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { isThemeId } from "@/lib/themes";
import { MODELS, normalizePrefs } from "@/lib/ai/models";
import { normalizeNavPrefs } from "@/lib/nav";
import type { RoleId } from "@/lib/roles";
import { normalizeDesk, normalizeLook, normalizePresets } from "@/lib/desk/desk";
import { updateExtra } from "@/lib/prefs/extra";
import { normalizeStarred, normalizeWatchlist } from "@/lib/desk/watchlist";

export const dynamic = "force-dynamic";

/**
 * Per-account preferences kept in profiles.extra: { theme, ai: { provider, model, effort }, nav: { pinned, labels, dock },
 * desk: { layout, widgets, hidden, notes } (src/lib/desk/desk.ts), look: { scale, radius, font, accent, background, motion, contrast },
 * looks: [{ name, theme, look }] (saved looks, sent whole), watchlist: [tickers] (sent whole; null for the role's), starredTools: [tool ids] (sent whole) }.
 * desk and look are merged into what is stored, so one setting (or the notes) can be sent alone.
 */
export async function GET() {
  return guarded(async (user) => {
    const [row] = await requireDb().select({ extra: schema.profiles.extra }).from(schema.profiles).where(eq(schema.profiles.userId, user.id));
    return NextResponse.json(row?.extra ?? {});
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { theme?: string; ai?: unknown; nav?: unknown; desk?: unknown; look?: unknown; looks?: unknown; watchlist?: unknown; starredTools?: unknown } | null;
    if (!body) return NextResponse.json({ error: "That request was incomplete. Reload the page and try again." }, { status: 400 });
    if (body.ai !== undefined) {
      const ai = normalizePrefs(body.ai);
      if (ai.model && !MODELS.some((m) => m.id === ai.model)) return NextResponse.json({ error: `Unknown model ${ai.model}` }, { status: 400 });
    }
    const apply = (extra: Record<string, unknown>, role: RoleId) => {
      if (typeof body.theme === "string" && isThemeId(body.theme)) extra.theme = body.theme;
      if (body.ai !== undefined) extra.ai = { ...((extra.ai as object) ?? {}), ...normalizePrefs(body.ai) };
      if (body.desk !== undefined && body.desk && typeof body.desk === "object") {
        const patch = body.desk as Record<string, unknown>;
        // A change made here is the person's own, unless the setup routine says otherwise.
        extra.desk = normalizeDesk({ ...((extra.desk as object) ?? {}), ...patch, source: patch.source ?? ((Object.keys(patch).length === 1 && "notes" in patch) ? (extra.desk as { source?: string } | undefined)?.source : "you") }, role);
      }
      if (body.look !== undefined && body.look && typeof body.look === "object") extra.look = normalizeLook({ ...((extra.look as object) ?? {}), ...(body.look as object) });
      if (body.looks !== undefined) extra.looks = normalizePresets(body.looks);
      if (body.starredTools !== undefined) extra.starredTools = normalizeStarred(body.starredTools);
      // null goes back to the watchlist the role suggests.
      if (body.watchlist !== undefined) { const w = normalizeWatchlist(body.watchlist); if (w) extra.watchlist = w; else delete extra.watchlist; }
      const hidden = normalizeDesk(extra.desk, role).hidden;
      if (body.nav !== undefined) extra.nav = normalizeNavPrefs(body.nav, role, hidden);
      // Features just taken out of the navigation also leave the top bar.
      else if (body.desk !== undefined && extra.nav) extra.nav = normalizeNavPrefs(extra.nav, role, hidden);
      return extra;
    };
    // Locked while merging, so saves sent together (a style and a look in one click) all land.
    const saved = await updateExtra(user.id, (extra, row) => apply(extra, row.role as RoleId));
    if (saved) return NextResponse.json(saved);
    // Preferences before onboarding completes: create a stub profile row.
    const extra = apply({}, "banker");
    await requireDb().insert(schema.profiles).values({ userId: user.id, email: user.email, name: user.name, role: "banker", extra }).onConflictDoUpdate({ target: schema.profiles.userId, set: { extra } });
    return NextResponse.json(extra);
  });
}
