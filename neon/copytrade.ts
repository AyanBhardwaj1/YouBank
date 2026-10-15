/**
 * Copy-trading heartbeat relay: a Neon Function with a fifteen-minute schedule trigger, like the
 * Newsroom's (Vercel's Hobby plan runs cron at most once a day). Each call runs one copy-trading pass:
 * look for new 13F filings on EDGAR (every pass in the weeks around the 45-day deadlines, otherwise every
 * three hours), alert followers, rebalance paper copies, tell live copies' owners a proposal is ready
 * (it never trades) and refresh sent orders' statuses.
 *
 * Only a real trigger delivery is relayed. Neon's proxy strips any x-neon-* header a caller sends, so a
 * present x-neon-trigger-invocation-id that matches the body's invocation_id can only come from a trigger.
 *
 * Deploy:   neon functions deploy copytrade --src neon/copytrade.ts --env YOUBANK_URL=https://youbank-nu.vercel.app --env AUTOPILOT_SECRET=...
 * Schedule: neon triggers create --function-slug copytrade --name copytrade-heartbeat --cron '*\/15 * * * *'
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

    // The pass runs at most 300 s (Vercel's limit); a little more and the connection is given up rather than held.
    const res = await fetch(`${base.replace(/\/$/, "")}/api/cron/copytrade`, {
      method: "POST",
      headers: { authorization: `Bearer ${secret}`, "x-copytrade-invocation": invocation },
      signal: AbortSignal.timeout(310_000),
    }).catch((e: unknown) => e as Error);
    if (res instanceof Error) return new Response(JSON.stringify({ error: `YouBank did not answer: ${res.name}` }), { status: 502, headers: { "content-type": "application/json" } });
    return new Response(await res.text(), { status: res.status, headers: { "content-type": "application/json" } });
  },
};

export default relay;
