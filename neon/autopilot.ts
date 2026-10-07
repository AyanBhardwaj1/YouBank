/**
 * Autopilot heartbeat relay: a Neon Function with a five-minute schedule trigger.
 *
 * Vercel's Hobby plan runs cron at most once a day, which is too slow for an agent that answers email.
 * Neon Function Triggers can fire every minute, so this function, deployed on the production branch,
 * calls YouBank's /api/cron/autopilot every five minutes with AUTOPILOT_SECRET.
 *
 * Only a real trigger delivery is relayed. Neon's proxy strips any x-neon-* header a caller sends, so a
 * present x-neon-trigger-invocation-id that matches the body's invocation_id can only come from a trigger.
 *
 * Deploy:   neon functions deploy autopilot --src neon/autopilot.ts --env YOUBANK_URL=https://<your domain, the same as NEXT_PUBLIC_SITE_URL> --env AUTOPILOT_SECRET=...
 * Schedule: neon triggers create --function-slug autopilot --name autopilot-heartbeat --cron '*\/5 * * * *'
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

    const res = await fetch(`${base.replace(/\/$/, "")}/api/cron/autopilot`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "x-autopilot-invocation": invocation },
    });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  },
};

export default handler;
