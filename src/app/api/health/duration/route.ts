export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Measures the platform's real function duration limit, which depends on the plan. Requires the cron secret
 * so it cannot be used to burn function minutes: curl -H "Authorization: Bearer $CRON_SECRET" ".../api/health/duration?s=75"
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const seconds = Math.min(120, Math.max(1, Number(new URL(req.url).searchParams.get("s") ?? 5)));
  const started = Date.now();
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for (let i = 0; i < seconds; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        controller.enqueue(encoder.encode(`tick ${i + 1} at ${((Date.now() - started) / 1000).toFixed(1)}s\n`));
      }
      controller.enqueue(encoder.encode(`done after ${((Date.now() - started) / 1000).toFixed(1)}s\n`));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}
