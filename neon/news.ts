/**
 * Newsroom heartbeat relay: a Neon Function with a ten-minute schedule trigger, like the autopilot
 * heartbeat (Vercel's Hobby plan runs cron at most once a day). Each call runs one Newsroom pass:
 * poll the sources that are due, cluster, summarize, alert, write and deliver the morning briefs.
 *
 * Only a real trigger delivery is relayed. Neon's proxy strips any x-neon-* header a caller sends, so a
 * present x-neon-trigger-invocation-id that matches the body's invocation_id can only come from a trigger.
 *
 * Deploy:   neon functions deploy news --src neon/news.ts --env YOUBANK_URL=https://<your domain, the same as NEXT_PUBLIC_SITE_URL> --env AUTOPILOT_SECRET=...
 * Schedule: neon triggers create --function-slug news --name news-heartbeat --cron '*\/10 * * * *'
 */
const handler = {
  async fetch(req: Request): Promise<Response> {
    const invocation = req.headers.get("x-neon-trigger-invocation-id");
    const body = (await req.json().catch(() => null)) as { invocation_id?: string } | null;
    if (!invocation || body?.invocation_id !== invocation) {
      return new Response("Only the schedule trigger may call this function.", { status: 403 });
    }
    const base = process.env.YOUBANK_URL;
    const secret = process.env.AUTOPILOT_SECRET;
    if (!base || !secret) return new Response("YOUBANK_URL and AUTOPILOT_SECRET must be set on this function.", { status: 500 });

    const res = await fetch(`${base.replace(/\/$/, "")}/api/cron/news`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "x-news-invocation": invocation },
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  },
};

export default handler;
