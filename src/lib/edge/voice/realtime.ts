/**
 * The live voice analyst (premium edge.voice-realtime): a short-lived key for OpenAI's realtime model, minted
 * only when the person presses "Live conversation". The browser talks to the model over WebRTC with that key;
 * the model has one tool, `edge_tool`, which the browser answers through /api/edge/voice/ask (the same free
 * tools as hold-to-talk). The ledger records a two-minute minimum when the key is minted and the minutes the
 * browser reports at the end, capped at the ten-minute session limit.
 */
import { emptyUsage } from "@/lib/ai/pricing";
import { recordUsage } from "@/lib/ai/usage";
import { logError } from "@/lib/errors";

export const REALTIME_MODEL = () => process.env.EDGE_REALTIME_MODEL?.trim() || "gpt-realtime-2.1";
/** List price per minute of conversation, the top of OpenAI's published range (audio in and out). */
export const USD_PER_MINUTE = 0.11;
export const MIN_SECONDS = 120;
export const MAX_SECONDS = 600;
export const SESSIONS_PER_DAY = 3;

const INSTRUCTIONS = [
  "You are Edge, a careful research analyst speaking with a banker or investor. Keep every reply under 25 seconds.",
  "Answer only from the edge_tool results. If the tool finds nothing, say the data in scope does not answer it.",
  "Say probabilities as model estimates with their interval, never as certainties, and never call anyone a liar.",
  "You cannot send emails or messages. If asked to, say you kept it as a note to review.",
  "Do not give investment advice.",
].join(" ");

export const EDGE_TOOL = {
  type: "function",
  name: "edge_tool",
  description: "Look something up in Edge: sale odds, alternative data, precedent deals, a company overview, the person's feed or theses, a note, or a question for their documents and filings.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "The person's question in their words." },
      intent: { type: "string", enum: ["odds", "pulse", "precedents", "company", "feed", "thesis", "note", "ask"] },
      ticker: { type: "string", description: "The company's ticker when known." },
    },
    required: ["text"],
  },
} as const;

/** The session settings sent when minting a key. Pure. */
export function sessionConfig(model = REALTIME_MODEL()) {
  return {
    expires_after: { anchor: "created_at", seconds: 60 },
    session: { type: "realtime", model, instructions: INSTRUCTIONS, tools: [EDGE_TOOL], tool_choice: "auto", audio: { output: { voice: "marin" } } },
  };
}

/** The cost of a session of `seconds` (at least the minimum, at most the cap). Pure. */
export function sessionCost(seconds: number): number {
  const s = Math.min(MAX_SECONDS, Math.max(MIN_SECONDS, Number.isFinite(seconds) ? seconds : MIN_SECONDS));
  return Math.round((s / 60) * USD_PER_MINUTE * 10_000) / 10_000;
}

/** Mint a short-lived key; a refusal is logged and the person gets a plain 502. */
export async function mintKey(): Promise<{ key: string; expiresAt: number; model: string }> {
  const model = REALTIME_MODEL();
  const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(15_000),
    headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(sessionConfig(model)),
  });
  const j = (await res.json().catch(() => null)) as { value?: string; expires_at?: number } | null;
  if (!res.ok || !j?.value) {
    logError(new Error(`realtime client_secrets ${res.status}`), { status: 502, where: "edge-voice-realtime" });
    throw Object.assign(new Error("The live voice service did not answer. Try again, or use hold-to-talk."), { status: 502 });
  }
  return { key: j.value, expiresAt: j.expires_at ?? Math.floor(Date.now() / 1000) + 60, model };
}

/** Record minutes of a session against the person's AI allowance (runs inside `guarded`, so it is theirs). */
export function recordMinutes(seconds: number, model = REALTIME_MODEL()): number {
  const usd = Math.round((Math.max(0, seconds) / 60) * USD_PER_MINUTE * 10_000) / 10_000;
  if (usd > 0) recordUsage({ feature: "edge.voice-realtime", provider: "openai", model, usage: emptyUsage(), extraCostUsd: usd });
  return usd;
}
