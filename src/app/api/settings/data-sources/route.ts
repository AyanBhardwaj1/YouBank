import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { checkKeyShape, PostBody, settingsView, testChain, testKey, validateOrder } from "@/lib/market/byo/settings";
import { noteKeyTest, removeKey, saveKey, saveOrder, savedKey } from "@/lib/market/byo/store";
import { isKeyProvider } from "@/lib/market/sources-meta";

export const dynamic = "force-dynamic";

/** Key and chain tests reach providers: a few a minute per person. */
const TESTS_PER_MINUTE = 10;
const MINUTE_MS = 60_000;
/**
 * A pasted key is checked against its provider from YouBank's own address, so the check could be used
 * to try stolen keys, and many accounts are cheap to make. A person adds a handful of keys, ever: a day's
 * cap per person and an hour's cap per address keep the check from being an oracle (or getting YouBank's
 * address blocked by a provider, which would cut off everyone's own keys).
 */
const PASTED_KEY_CHECKS_PER_DAY = 20;
const PASTED_KEY_CHECKS_PER_IP_HOUR = 30;
const HOUR_MS = 60 * MINUTE_MS, DAY_MS = 24 * HOUR_MS;
const NO_STORE = { "Cache-Control": "no-store" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const bad = (message: string) => Object.assign(new Error(message), { status: 400 });
const limited = (userId: string) => rateLimit(`data-sources-test:${userId}`, TESTS_PER_MINUTE, MINUTE_MS, "That is a lot of tests in a minute. Wait a moment and try again.");
/** The caller's address as the platform reports it (Vercel sets x-real-ip; the first x-forwarded-for hop otherwise). */
const callerIp = (req: Request) => req.headers.get("x-real-ip")?.trim() || req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
async function pastedKeyLimited(userId: string, req: Request) {
  const message = "That is a lot of new keys to check. Try again later, or test a key you have already saved.";
  await rateLimit(`data-sources-key:${userId}`, PASTED_KEY_CHECKS_PER_DAY, DAY_MS, message);
  await rateLimit(`data-sources-key-ip:${callerIp(req)}`, PASTED_KEY_CHECKS_PER_IP_HOUR, HOUR_MS, message);
}

/**
 * Settings → Data sources, for the signed-in person only (every read and write is keyed by the session's
 * user, never by anything in the request):
 * - GET: their sources per dataset in their order, with licence badges and why a source cannot answer,
 *   and their keys (last four characters and plan only; a key is never sent back);
 * - PUT { order: { dataset: [sourceId…] } }: save their order (zod-checked against the registry);
 * - POST { action: "test-key" | "save-key" | "test-chain" }: test a key (new or saved), test and save one,
 *   or run a dataset's sample through their chain (rate-limited);
 * - DELETE ?provider=tiingo: remove a key and purge the data cached with it.
 */
export async function GET() {
  return guarded(async (user) => json(await settingsView(user.id)));
}

export async function PUT(req: Request) {
  return guarded(async (user) => {
    const order = validateOrder(await req.json().catch(() => null));
    await saveOrder(user.id, order);
    return json(await settingsView(user.id));
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    const parsed = PostBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) throw bad("That request was not in the expected shape. Reload the page and try again.");
    const body = parsed.data;
    await limited(user.id);
    if (body.action === "test-chain") return json(await testChain(user.id, body.dataset));
    if (body.action === "test-key") {
      const key = body.key ?? (await savedKey(user.id, body.provider))?.key;
      if (!key) throw bad("There is no saved key for that provider. Paste one to test it.");
      if (body.key) {
        checkKeyShape(body.provider, key);
        await pastedKeyLimited(user.id, req);
      }
      const r = await testKey(body.provider, key);
      if (!body.key) await noteKeyTest(user.id, body.provider, { ok: r.ok, at: new Date().toISOString(), ms: r.ms });
      return json(r);
    }
    checkKeyShape(body.provider, body.key);
    await pastedKeyLimited(user.id, req);
    const r = await testKey(body.provider, body.key);
    if (!r.ok) throw bad(`That key did not work: ${r.message ?? "the provider refused it"}`);
    await saveKey(user.id, body.provider, body.key, body.plan, { ok: true, at: new Date().toISOString(), ms: r.ms });
    return json({ test: r, settings: await settingsView(user.id) });
  });
}

export async function DELETE(req: Request) {
  return guarded(async (user) => {
    const provider = new URL(req.url).searchParams.get("provider");
    if (!isKeyProvider(provider)) throw bad("Say which provider's key to remove.");
    const r = await removeKey(user.id, provider);
    return json({ ...r, settings: await settingsView(user.id) });
  });
}
