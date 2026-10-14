/**
 * The Voice Analyst (E13) answering: an utterance routed (router.ts) to one of Edge's tools, the companies it
 * names resolved (a watched company by its name first, then tickers and names, then spoken words matched
 * against SEC's list), the tool run, and a short script with its citations; saved to the person's answers
 * (mode "voice"). Audio is never stored. Free: the tools are Edge's own stored data; a document question
 * costs what Ask costs (the default answer model, in the person's AI allowance). Voice notes go onto the
 * person's CRM contact at the named company when there is exactly one; nothing is ever sent.
 */
import { and, eq, ilike } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { resolveTicker, tickerByName } from "@/lib/edgar/tickers";
import { logError } from "@/lib/errors";
import { edgeProfile } from "../access";
import { listTheses } from "../agent/store";
import { TOOL_DEFS } from "../agent/tools";
import { askDocuments } from "../docs/answer";
import { edgeFeed } from "../feed";
import { listWatches } from "../watches";
import { routeUtterance, scriptFor, type Citation, type Intent, type Routed } from "./router";

export type VoiceAnswer = { intent: Intent; reason: string; ticker: string | null; company: string | null; script: string; citations: Citation[]; answerId: number | null; heard: string };

const STOP = new Set("what whats is are the a an at on for of to in and or me my tell about how does did will would could odds chance chances sold sale acquired hiring jobs postings deals precedents like this week today going new happening brief digest read note please edge".split(" "));

/** The company an utterance means: a watched company named, a ticker, a name, or spoken words in SEC's list. */
async function resolveCompany(userId: string, r: Routed): Promise<{ ticker: string; name: string } | null> {
  const watches = await listWatches(userId).catch(() => []);
  const low = r.question.toLowerCase();
  for (const w of watches) {
    const t = w.target.ticker;
    if (!t) continue;
    const first = (w.label ?? "").toLowerCase().split(/\s+/)[0] ?? "";
    if (new RegExp(`\\b${t.toLowerCase().replace(".", "\\.")}\\b`).test(low) || (first.length >= 4 && new RegExp(`\\b${first}\\b`).test(low))) return { ticker: t, name: w.label };
  }
  for (const t of r.tickers) { const x = await resolveTicker(t).catch(() => null); if (x) return { ticker: x.ticker, name: x.name }; }
  for (const n of r.names) { const x = await tickerByName(n).catch(() => null); if (x) return { ticker: x.ticker, name: x.name }; }
  // Speech arrives in lower case: try runs of one to three spoken words that are not common words.
  const words = r.question.replace(/[^A-Za-z0-9&.' ]+/g, " ").split(/\s+/).filter(Boolean);
  for (let len = 3; len >= 1; len--) for (let i = 0; i + len <= words.length; i++) {
    const run = words.slice(i, i + len);
    if (run.some((w) => STOP.has(w.toLowerCase()))) continue;
    const x = await tickerByName(run.join(" ")).catch(() => null);
    if (x) return { ticker: x.ticker, name: x.name };
  }
  return null;
}

/** Answer a spoken (or typed) question. `forced` comes from the realtime session's function call. */
export async function answerVoice(userId: string, text: string, forced?: { intent?: Intent; ticker?: string }): Promise<VoiceAnswer> {
  const heard = text.trim().slice(0, 600);
  const r: Routed = { ...routeUtterance(heard), ...(forced?.intent ? { intent: forced.intent } : {}) };
  const company = forced?.ticker ? await resolveTicker(forced.ticker).then((x) => (x ? { ticker: x.ticker, name: x.name } : null)).catch(() => null) : ["odds", "pulse", "precedents", "company", "note", "ask"].includes(r.intent) ? await resolveCompany(userId, r) : null;
  let data: Record<string, unknown> | null = null;
  let citations: Citation[] = [];
  try {
    if ((r.intent === "odds" || r.intent === "pulse" || r.intent === "precedents") && company) {
      const tool = TOOL_DEFS[r.intent === "odds" ? "deal_odds" : r.intent];
      const o = await tool.run({ ticker: company.ticker });
      data = { ...(o.data as Record<string, unknown>), text: o.text };
      citations = [{ label: o.header, ...(o.url ? { url: o.url } : {}) }];
    } else if (r.intent === "company" && company) {
      const [odds, pulse] = await Promise.all([TOOL_DEFS.deal_odds.run({ ticker: company.ticker }).catch(() => null), TOOL_DEFS.pulse.run({ ticker: company.ticker }).catch(() => null)]);
      data = { text: [odds?.text, pulse?.text].filter(Boolean).join(" ") || null };
      citations = [odds, pulse].filter((x): x is NonNullable<typeof x> => !!x).map((o) => ({ label: o.header, ...(o.url ? { url: o.url } : {}) }));
      if (!data.text) data = null;
    } else if (r.intent === "feed") {
      const p = await edgeProfile(userId);
      const f = await edgeFeed(userId, await listWatches(userId), p?.prefs.blend ?? { relevance: 0.45, size: 0.2, novelty: 0.15, confidence: 0.2 }, { scope: "all", limit: 5 });
      data = { items: f.cards.map((c) => ({ title: c.title })) };
      citations = f.cards.slice(0, 5).map((c) => ({ label: c.title.slice(0, 80), url: "/app/edge?view=feed" }));
    } else if (r.intent === "thesis") {
      const list = await listTheses(userId);
      data = { items: list.filter((t) => t.mine).map((t) => ({ title: t.title, overall: t.overall, status: t.status })) };
      citations = list.slice(0, 3).map((t) => ({ label: t.title, url: `/app/edge?view=theses&thesis=${t.id}` }));
    } else if (r.intent === "note") {
      data = { text: await voiceNote(userId, company, r.note ?? heard) };
    } else if (r.intent === "send") {
      data = {};
    } else if (r.intent === "ask") {
      const a = await askDocuments(userId, { question: heard, mode: "strict", form: "direct", scope: { ...(company ? { tickers: [company.ticker] } : {}), sources: ["sec", "uploads", "audio"] } }, { deadline: Date.now() + 100_000 });
      data = { text: a.text, notFound: a.notFound };
      citations = a.citations.slice(0, 5).map((c) => ({ label: `${c.title}${c.page ? `, p. ${c.page}` : ""}`, ...(c.url ? { url: c.url } : {}) }));
    }
  } catch (e) {
    logError(e, { where: "edge-voice" });
    data = null;
  }
  const who = company ? company.name : "";
  const needsCompany = ["odds", "pulse", "precedents", "company"].includes(r.intent) && !company;
  const script = needsCompany ? "Which company? Say its name or ticker." : scriptFor(r.intent, data, who);
  let answerId: number | null = null;
  try {
    const [row] = await requireDb().insert(schema.edgeAnswers).values({ ownerId: userId, question: heard, mode: "voice", scope: { source: "voice", intent: r.intent, ...(company ? { ticker: company.ticker } : {}) }, answer: { script, citations, intent: r.intent } }).returning({ id: schema.edgeAnswers.id });
    answerId = row.id;
  } catch (e) { logError(e, { where: "edge-voice-save" }); }
  return { intent: r.intent, reason: r.reason, ticker: company?.ticker ?? null, company: company?.name ?? null, script, citations, answerId, heard };
}

/** A voice note onto the person's one CRM contact at the company; otherwise kept in their voice history only. */
async function voiceNote(userId: string, company: { ticker: string; name: string } | null, note: string): Promise<string> {
  if (!company) return "I kept that note in your voice history; say which company it is about to file it on a contact.";
  const first = company.name.split(/\s+/)[0];
  const contacts = await requireDb().select({ id: schema.crmContacts.id, name: schema.crmContacts.name, notes: schema.crmContacts.notes }).from(schema.crmContacts)
    .where(and(eq(schema.crmContacts.userId, userId), ilike(schema.crmContacts.company, `%${first.replace(/[%_]/g, "")}%`))).limit(3);
  if (contacts.length !== 1) return contacts.length ? `You have ${contacts.length} contacts at ${company.name}; I kept the note in your voice history to file by hand.` : `No contact at ${company.name} in Relationships; I kept the note in your voice history.`;
  const c = contacts[0];
  const line = `${new Date().toISOString().slice(0, 10)} (voice): ${note.slice(0, 800)}`;
  await requireDb().update(schema.crmContacts).set({ notes: c.notes ? `${c.notes}\n${line}` : line, updatedAt: new Date() }).where(eq(schema.crmContacts.id, c.id));
  return `Noted on ${c.name || "your contact"} at ${company.name}.`;
}
