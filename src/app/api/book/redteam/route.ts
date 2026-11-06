import { NextResponse } from "next/server";
import { runChat } from "@/lib/ai/agent";
import { loadUserContext } from "@/lib/ai/persona";
import { runAsUser } from "@/lib/ai/usage";
import { isAdmin } from "@/lib/auth/admin";
import { guarded } from "@/lib/auth/user";
import { rateLimit } from "@/lib/locks";
import { evaluateBook, loadBook, setRedTeam } from "@/lib/book/store";
import { redTeamPrompt } from "@/lib/book/position";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * POST { id }: the red team for a position. An agent briefed to argue the other side of its thesis, with the same tools
 * and the same rule as every answer (cite every figure), names the strongest counter-arguments, the
 * weakest pillar and the signals that would prove the thesis wrong. Kept on the position until run again.
 * A separate adversary on purpose: research on multi-agent debate finds agents drift toward a shared,
 * often biased consensus, so the case against is written alone, not negotiated.
 */
export async function POST(req: Request) {
  return guarded(async (user) => {
    const { id } = ((await req.json().catch(() => ({}))) ?? {}) as { id?: string };
    const position = (await loadBook(user.id)).find((t) => t.id === id);
    if (!position) return NextResponse.json({ error: "That position was not found." }, { status: 404 });
    await rateLimit(`book-redteam:${user.id}`, 20, 3_600_000, "The red team has run many times this hour. Try again later.");
    const [ev] = await evaluateBook([position]);
    const { persona, prefs } = await loadUserContext(user.id);
    let error = "";
    const { text, sources } = await runAsUser(user.id, () => runChat({
      messages: [{ role: "user", content: redTeamPrompt(position, ev ?? null) }],
      context: { ticker: position.ticker, panels: [], subject: `Red team: ${position.ticker}`, persona },
      prefs, feature: "book.red-team", maxTurns: 10, deadline: Date.now() + 240_000, parallelTools: true, signal: req.signal,
      emit: (e) => { if (e.type === "error") error = e.message; },
    }), { admin: isAdmin(user) });
    if (!text.trim()) return NextResponse.json({ error: error || "The red team could not finish just now. Try again in a minute." }, { status: 502 });
    const redTeam = { at: new Date().toISOString(), text: text.slice(0, 8000), sources: sources.filter((s) => /^https:\/\//.test(s.url)).slice(0, 30) };
    await setRedTeam(user.id, position.id, redTeam);
    return NextResponse.json({ redTeam });
  });
}
