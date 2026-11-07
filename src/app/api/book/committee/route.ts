import { NextResponse } from "next/server";
import { runChat, structured } from "@/lib/ai/agent";
import { loadUserContext } from "@/lib/ai/persona";
import { runAsUser } from "@/lib/ai/usage";
import { isAdmin } from "@/lib/auth/admin";
import { guarded } from "@/lib/auth/user";
import { cacheGetShared, cacheSet, inBackground } from "@/lib/cache";
import { rateLimit } from "@/lib/locks";
import { logError } from "@/lib/errors";
import { evaluateBook, loadBook, noteCommittee, setCommittee } from "@/lib/book/store";
import { redTeamPrompt, type Position, type RedTeam } from "@/lib/book/position";
import { bullPrompt, chairPrompt, committeeFrom, poolChairs } from "@/lib/book/committee";
import { CHAIR_SYSTEM, ChairSchema } from "@/lib/book/committee-chair";
import { record } from "@/lib/ledger/store";
import { cachedRisk } from "@/lib/book/risk-store";
import { priceBaseRate } from "@/lib/book/baserate";
import type { AiPrefs } from "@/lib/ai/models";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Where a sitting stands, kept ten minutes: running, done, or failed with a reason the person can read. */
type Sitting = { state: "running" | "done" | "failed"; at: string; error?: string };
const KEY = (userId: string, id: string) => `book-committee:${userId}:${id}`;
const TTL = 10 * 60_000;
const status = async (userId: string, id: string): Promise<Sitting | null> => {
  const raw = await cacheGetShared(KEY(userId, id)).catch(() => null);
  try { return raw ? (JSON.parse(raw) as Sitting) : null; } catch { return null; }
};

/** GET ?id=: whether a sitting is running for the position, or how the last one ended. */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const id = new URL(req.url).searchParams.get("id") ?? "";
    return NextResponse.json((await status(user.id, id)) ?? { state: "idle" }, { headers: { "Cache-Control": "private, no-store" } });
  });
}

/**
 * POST { id }: convene the investment committee for a position. It sits in the background (about two to
 * three minutes), so the person can leave the page: GET says when it is done, and the Book shows it.
 * A bull and a bear each write a sourced brief alone and in parallel (independent briefs, not a debate,
 * so they cannot drift into one consensus), then a chair reads both with the kill-criteria evidence and
 * decides add, hold, trim or exit, with a 90-day forecast scored like the PM's own. Advice only: nothing in
 * the Book changes but the record of the sitting.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const { id } = ((await req.json().catch(() => ({}))) ?? {}) as { id?: string };
    const position = (await loadBook(user.id)).find((t) => t.id === id);
    if (!position) return NextResponse.json({ error: "That position was not found." }, { status: 404 });
    const now = await status(user.id, position.id);
    if (now?.state === "running" && Date.now() - Date.parse(now.at) < 6 * 60_000) return NextResponse.json(now, { status: 202 });
    await rateLimit(`book-committee:${user.id}`, 10, 3_600_000, "The committee has sat many times this hour. Try again later.");
    const started: Sitting = { state: "running", at: new Date().toISOString() };
    await cacheSet(KEY(user.id, position.id), JSON.stringify(started), TTL);
    const { persona, prefs } = await loadUserContext(user.id);
    inBackground(sit(user.id, isAdmin(user), position, persona, prefs).then(
      () => cacheSet(KEY(user.id, position.id), JSON.stringify({ state: "done", at: new Date().toISOString() } satisfies Sitting), TTL),
      (e: unknown) => {
        const error = e instanceof SittingError ? e.message : "The committee could not finish just now. Try again in a minute.";
        if (!(e instanceof SittingError)) logError(e, { where: "book.committee" });
        return cacheSet(KEY(user.id, position.id), JSON.stringify({ state: "failed", at: new Date().toISOString(), error } satisfies Sitting), TTL);
      },
    ));
    return NextResponse.json(started, { status: 202 });
  });
}

/** A failure with a message fit to show the person. */
class SittingError extends Error {}

async function sit(userId: string, admin: boolean, position: Position, persona: Awaited<ReturnType<typeof loadUserContext>>["persona"], prefs: AiPrefs | null): Promise<void> {
  // The whole sitting fits in maxDuration (300 s): briefs to about 150 s, the chair what is left, less a margin.
  const t0 = Date.now();
  const deadline = t0 + 150_000;
  const [ev] = await evaluateBook([position]);
  let error = "";
  const side = (prompt: string, label: string, feature: string): Promise<RedTeam | null> =>
    runAsUser(userId, () => runChat({
      messages: [{ role: "user", content: prompt }],
      context: { ticker: position.ticker, panels: [], subject: `Committee ${label}: ${position.ticker}`, persona },
      prefs, feature, maxTurns: 8, deadline, parallelTools: true,
      emit: (e) => { if (e.type === "error") error = e.message; },
    }), { admin }).then(({ text, sources }) => (text.trim() ? { at: new Date().toISOString(), text: text.slice(0, 8000), sources: sources.filter((s) => /^https:\/\//.test(s.url)).slice(0, 30) } : null));
  const [bull, bear] = await Promise.all([side(bullPrompt(position, ev ?? null), "bull", "book.committee.bull"), side(redTeamPrompt(position, ev ?? null), "bear", "book.committee.bear")]);
  if (!bull || !bear) throw new SittingError(error || "The committee could not finish its briefs just now. Try again in a minute.");
  // A price base rate for the chairs to start from (baserate.ts), when today's risk is already worked out.
  const by = new Date(Date.now() + 90 * 86_400_000).toISOString().slice(0, 10);
  const vol = (await loadBook(userId).then((b) => cachedRisk(b)).catch(() => null))?.positions.find((x) => x.ticker === position.ticker)?.vol ?? null;
  const base = priceBaseRate(position, ev?.price ?? null, vol, by, new Date());
  const prompt = chairPrompt(position, ev ?? null, bull.text, bear.text, base ? { p: base.p, by } : null);
  const left = 285_000 - (Date.now() - t0);
  if (left < 20_000) throw new SittingError("The briefs took too long for the chair to sit. Try again in a minute.");
  // Three chairs sit independently, in parallel, and are pooled (committee.ts poolChairs): an ensemble of
  // forecasts is better calibrated than one, and their spread shows how settled the call is.
  const runs = await Promise.allSettled([0, 1, 2].map(() => runAsUser(userId, () => structured(ChairSchema, "book_committee", CHAIR_SYSTEM, prompt, { prefs, task: "chat", timeoutMs: Math.min(90_000, left) }), { admin })));
  const done = runs.flatMap((r) => (r.status === "fulfilled" ? [r.value] : []));
  const pooled = poolChairs(done.map((r) => r.data));
  if (!pooled) throw new SittingError("The chair could not decide just now. Try again in a minute.");
  const chair = done[0];
  const committee = committeeFrom(pooled.chair, bull, bear, new Date(), pooled.samples, base?.p ?? null, ev?.verdict === "broken");
  // The position may have been closed or deleted while the committee sat: then nothing is kept or announced.
  if (!(await setCommittee(userId, position.id, committee))) throw new SittingError("The position was closed or removed while the committee sat, so its decision was not kept.");
  await noteCommittee(userId, position, committee).catch(() => undefined);
  await record(userId, {
    kind: "red_team", subject: `Committee: ${position.ticker}`, model: `${chair.provider}/${chair.model}`, prompt: prompt.slice(0, 4000),
    output: JSON.stringify({ decision: committee.decision, probability: committee.forecast?.p ?? committee.brokenP ?? null, chairs: pooled.samples, rationale: committee.rationale, dissent: committee.dissent, watch: committee.watch }),
    sources: [...bull.sources, ...bear.sources].slice(0, 60), meta: { feature: "book.committee.chair" },
  }).catch(() => {});
}
