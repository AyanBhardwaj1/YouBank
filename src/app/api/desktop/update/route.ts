import { latestDesktopRelease } from "@/lib/desktop/release";

export const dynamic = "force-dynamic";

/**
 * The desktop app's update check (the first endpoint in desktop/src-tauri/tauri.conf.json). It points
 * the updater at the signed `latest.json` of the newest published desktop release, so other releases
 * in the repository never shadow it. 204 means "no update"; the app checks the signature itself, so
 * this route cannot make it install anything that was not signed with the release key.
 */
export async function GET() {
  const r = await latestDesktopRelease();
  if (!r?.updaterJson) return new Response(null, { status: 204, headers: { "Cache-Control": "public, max-age=300" } });
  return Response.redirect(r.updaterJson, 302);
}
