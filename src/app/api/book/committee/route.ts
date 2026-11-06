import { NextResponse } from "next/server";
import { runChat, structured } from "@/lib/ai/agent";
import { loadUserContext } from "@/lib/ai/persona";
import { runAsUser } from "@/lib/ai/usage";
import { isAdmin } from "@/lib/auth/admin";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { evaluateBook, loadBook, setCommittee } from "@/lib/book/store";
import { redTeamPrompt, type RedTeam } from "@/lib/book/position";
import { bullPrompt, CHAIR_SYSTEM, ChairSchema, chairPrompt, committeeFrom } from "@/lib/book/committee";
import { record } from "@/lib/ledger/store";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST { id }: the investment committee for a position. A bull and a bear each write a sourced brief alone
 * and in parallel (independent briefs, not a debate, so they cannot drift into one consensus), then a chair
 * reads both with the kill-criteria evidence and decides add, hold, trim or exit, with a 90-day forecast
 * that is scored like the PM's own. Advice only: nothing in the Book changes but the record of the sitting.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const { id } = ((await req.json().catch(() => ({}))) ?? {}) as { id?: string };
    const position = (await loadBook(user.id)).find((t) => t.id === id);
    if (!position) return NextResponse.json({ error: "That position was not found." }, { status: 404 });
    await rateLimit(`book-committee:${user.id}`, 10, 3_600_000, "The committee has sat many times this hour. Try again later.");
    const [ev] = await evaluateBook([position]);
    const { persona, prefs } = await loadUserContext(user.id);
    const admin = isAdmin(user);
    const deadline = Date.now() + 170_000;
    let error = "";
    const side = (prompt: string, label: string, feature: string): Promise<RedTeam | null> =>
      runAsUser(user.id, () => runChat({
        messages: [{ role: "user", content: prompt }],
        context: { ticker: position.ticker, panels: [], subject: `Committee ${label}: ${position.ticker}`, persona },
        prefs, feature, maxTurns: 8, deadline, parallelTools: true, signal: req.signal,
        emit: (e) => { if (e.type === "error") error = e.message; },
      }), { admin }).then(({ text, sources }) => (text.trim() ? { at: new Date().toISOString(), text: text.slice(0, 8000), sources: sources.filter((s) => /^https:\/\//.test(s.url)).slice(0, 30) } : null));
    const [bull, bear] = await Promise.all([side(bullPrompt(position, ev ?? null), "bull", "book.committee.bull"), side(redTeamPrompt(position, ev ?? null), "bear", "book.committee.bear")]);
    if (!bull || !bear) return NextResponse.json({ error: error || "The committee could not finish its briefs just now. Try again in a minute." }, { status: 502 });
    const prompt = chairPrompt(position, ev ?? null, bull.text, bear.text);
    let chair;
    try {
      chair = await runAsUser(user.id, () => structured(ChairSchema, "book_committee", CHAIR_SYSTEM, prompt, { prefs, task: "chat", timeoutMs: 90_000 }), { admin });
    } catch {
      return NextResponse.json({ error: "The chair could not decide just now. Try again in a minute." }, { status: 502 });
    }
    const committee = committeeFrom(chair.data, bull, bear);
    await setCommittee(user.id, position.id, committee);
    await record(user.id, {
      kind: "red_team", subject: `Committee: ${position.ticker}`, model: `${chair.provider}/${chair.model}`, prompt: prompt.slice(0, 4000),
      output: JSON.stringify({ decision: committee.decision, probability: committee.forecast?.p ?? null, rationale: committee.rationale, dissent: committee.dissent, watch: committee.watch }),
      sources: [...bull.sources, ...bear.sources].slice(0, 60), meta: { feature: "book.committee.chair" },
    }).catch(() => {});
    return NextResponse.json({ committee });
  });
}
