export const dynamic = "force-dynamic";

/**
 * Liveness for uptime monitors: the deployment is up and serving functions. It touches nothing (no
 * database, no session, no upstream), so it is cheap to call every minute and never wakes Neon from
 * scale-to-zero. /api/health is the readiness check that does look at the database and settings.
 */
export function GET() {
  return Response.json(
    { status: "ok", time: new Date().toISOString(), commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export function HEAD() {
  return new Response(null, { headers: { "Cache-Control": "no-store" } });
}
