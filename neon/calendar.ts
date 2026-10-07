/**
 * Calendar heartbeat relay: a Neon Function with a fifteen-minute schedule trigger.
 *
 * Vercel's Hobby plan runs cron at most once a day, which is too slow for a calendar. This function,
 * deployed on the production branch, calls YouBank's /api/cron/calendar (sync, free) and then
 * /api/cron/calendar-briefs (morning briefs, only for people who switched them on) with
 * AUTOPILOT_SECRET. Only a real trigger delivery is relayed, as in neon/autopilot.ts.
 *
 * Deploy:   neon functions deploy calendar --src neon/calendar.ts --env YOUBANK_URL=https://youbank-nu.vercel.app --env AUTOPILOT_SECRET=...
 * Schedule: neon triggers create --function-slug calendar --name calendar-heartbeat --cron '*\/15 * * * *'
 */
const relay = {
  async fetch(req: Request): Promise<Response> {
    const invocation = req.headers.get("x-neon-trigger-invocation-id");
    const body = (await req.json().catch(() => null)) as { invocation_id?: string } | null;
    if (!invocation || body?.invocation_id !== invocation) {
      return new Response("Only the schedule trigger may call this function.", { status: 403 });
    }
    const base = process.env.YOUBANK_URL;
    const secret = process.env.AUTOPILOT_SECRET;
    if (!base || !secret) return new Response("YOUBANK_URL and AUTOPILOT_SECRET must be set on this function.", { status: 500 });
    const call = (path: string) => fetch(`${base.replace(/\/$/, "")}${path}`, { method: "POST", headers: { authorization: `Bearer ${secret}`, "x-calendar-invocation": invocation } })
      .then(async (r) => ({ status: r.status, body: (await r.text()).slice(0, 2000) }), (e) => ({ status: 0, body: String(e) }));
    const sync = await call("/api/cron/calendar");
    const briefs = await call("/api/cron/calendar-briefs");
    return new Response(JSON.stringify({ sync, briefs }), { status: sync.status === 200 ? 200 : 502, headers: { "content-type": "application/json" } });
  },
};

export default relay;
