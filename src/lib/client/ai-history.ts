/**
 * The terminal AI's last conversation per ticker (or subject), kept in this browser so a reload or a trip
 * to another page does not lose it. Finished messages only, the last 12, for a week; cleared on sign-out
 * (clearAiHistory) and by "New chat". The cleaning is pure and tested (scripts/test-ai-history.ts).
 */
export const AI_HISTORY_PREFIX = "yb-ai:";
const KEEP = 12;
const WEEK = 7 * 24 * 3600_000;

export type StoredMsg = { role: "user" | "assistant"; content: string; sources?: { id: string; label: string; url: string }[]; figures?: unknown };
type Stored = { at: number; messages: StoredMsg[] };

const keyOf = (scope: string) => `${AI_HISTORY_PREFIX}${scope.toUpperCase().slice(0, 80)}`;

/** What is worth keeping: finished, non-empty messages, the last KEEP, starting with a question. */
export function keepable(messages: { role: string; content: string; streaming?: boolean; error?: string; sources?: StoredMsg["sources"]; figures?: unknown }[]): StoredMsg[] {
  const done = messages.filter((m) => !m.streaming && !m.error && m.content.trim() && (m.role === "user" || m.role === "assistant"))
    .map((m) => ({ role: m.role as StoredMsg["role"], content: m.content.slice(0, 20_000), ...(m.sources?.length ? { sources: m.sources.slice(0, 40) } : {}), ...(m.figures ? { figures: m.figures } : {}) }));
  const tail = done.slice(-KEEP);
  return tail[0]?.role === "assistant" ? tail.slice(1) : tail;
}

/** A stored conversation, or [] when there is none, it is older than a week, or it is not ours. */
export function parseStored(raw: string | null, now: number): StoredMsg[] {
  if (!raw) return [];
  try {
    const s = JSON.parse(raw) as Stored;
    if (!s || typeof s.at !== "number" || now - s.at > WEEK || !Array.isArray(s.messages)) return [];
    return s.messages.filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string");
  } catch { return []; }
}

export function loadAiHistory(scope: string): StoredMsg[] {
  try { return parseStored(localStorage.getItem(keyOf(scope)), Date.now()); } catch { return []; }
}
export function saveAiHistory(scope: string, messages: StoredMsg[]): void {
  try {
    if (messages.length) localStorage.setItem(keyOf(scope), JSON.stringify({ at: Date.now(), messages } satisfies Stored));
    else localStorage.removeItem(keyOf(scope));
  } catch { /* storage full or refused: the conversation just is not kept */ }
}
/** On sign-out: no one else on this browser sees what was asked. */
export function clearAiHistory(): void {
  try { for (const k of Object.keys(localStorage)) if (k.startsWith(AI_HISTORY_PREFIX)) localStorage.removeItem(k); } catch { /* fine */ }
}
