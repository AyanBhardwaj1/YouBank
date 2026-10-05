/**
 * Who was in the meeting, as contacts. Pure functions, tested in scripts/test-meetings.ts.
 *
 * People arrive as a meeting app shows them: "Maya Chen", "Maya Chen (Ledgerline)", "maya.chen",
 * "Dr. Maya Chen | Ledgerline", "Maya C.", sometimes with an email (a bot's participant list, a calendar
 * invite, a contact picked by hand). An email settles it. Without one, a name links to a contact only
 * when exactly one contact fits it well; anything weaker or ambiguous is left for the person to pick,
 * because a meeting filed under the wrong person is worse than one not filed.
 */
export type Person = { name: string; email?: string };
export type ContactLite = { id: number; name: string; email: string; company?: string };
export type How = "email" | "name" | "none";
export type Match = { person: Person; contactId: number | null; how: How; confidence: number; candidates: number[]; self: boolean };

/** Confidence needed to link a contact on a name alone. */
export const LINK_AT = 0.75;

const TITLES = /^(mr|mrs|ms|mx|dr|prof|sir|dame)\.?$/;
const SUFFIXES = /^(jr|sr|ii|iii|iv|phd|md|cfa|cpa|mba)\.?$/;

/** A display name as comparable words: no titles, no "(Company)" or "| Company", no punctuation, no accents. Pure. */
export function nameTokens(raw: string): string[] {
  let s = raw.normalize("NFKD").replace(/\p{M}/gu, "");
  s = s.replace(/\(.*?\)|\[.*?\]/g, " ").split(/\s[|•·–—-]\s|\s@\s/)[0] ?? "";
  // A bare address or handle ("maya.chen", "maya_chen@x.io") reads as its words.
  if (!/\s/.test(s.trim())) s = s.replace(/@.*$/, "").replace(/[._]+/g, " ");
  return s.toLowerCase().replace(/[^a-z0-9' ]+/g, " ").split(/\s+/)
    .map((t) => t.replace(/^'+|'+$/g, ""))
    .filter((t) => t && !TITLES.test(t) && !SUFFIXES.test(t));
}

/** How well a meeting name fits a contact's name, 0 to 1. Pure. */
export function nameScore(meetingName: string, contactName: string): number {
  const a = nameTokens(meetingName), b = nameTokens(contactName);
  if (!a.length || !b.length) return 0;
  if (a.join(" ") === b.join(" ")) return 0.95;
  const [af, al] = [a[0], a[a.length - 1]], [bf, bl] = [b[0], b[b.length - 1]];
  // Same first and last names, a middle name on one side only.
  if (a.length > 1 && b.length > 1 && af === bf && al === bl) return 0.9;
  // "Maya C" or "Maya C." against "Maya Chen".
  if (a.length === 2 && b.length > 1 && af === bf && al.length === 1 && bl.startsWith(al)) return 0.78;
  // "Chen, Maya" (last name first).
  if (a.length === 2 && b.length === 2 && af === bl && al === bf) return 0.85;
  // A first name alone: weak, never enough by itself.
  if (a.length === 1 && af === bf) return 0.5;
  return 0;
}

const lower = (s: string | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Match each person to at most one contact. `self` lists the person's own addresses and name, so they
 * are never filed as their own contact. Pure.
 */
export function matchParticipants(people: Person[], contacts: ContactLite[], self: { emails?: string[]; name?: string } = {}): Match[] {
  const selfEmails = new Set((self.emails ?? []).map(lower).filter(Boolean));
  const selfName = nameTokens(self.name ?? "").join(" ");
  const byEmail = new Map(contacts.filter((c) => c.email).map((c) => [lower(c.email), c]));
  const taken = new Set<number>();
  const out: Match[] = people.map((person) => {
    const email = lower(person.email);
    const toks = nameTokens(person.name).join(" ");
    const isSelf = (email && selfEmails.has(email)) || person.name.trim() === "You" || (!!selfName && toks === selfName);
    if (isSelf) return { person, contactId: null, how: "none", confidence: 1, candidates: [], self: true };
    if (email) {
      const c = byEmail.get(email);
      if (c) { taken.add(c.id); return { person, contactId: c.id, how: "email", confidence: 1, candidates: [c.id], self: false }; }
    }
    return { person, contactId: null, how: "none", confidence: 0, candidates: [], self: false };
  });
  // Names second, scored against every contact: a name that fits two contacts is ambiguous even when
  // an email already placed one of them, and a contact claimed by an email is never handed to a namesake.
  for (const m of out) {
    if (m.self || m.contactId || !m.person.name.trim()) continue;
    const scored = contacts
      .map((c) => ({ id: c.id, score: Math.max(nameScore(m.person.name, c.name), c.name ? 0 : nameScore(m.person.name, c.email.split("@")[0] ?? "")) }))
      .filter((x) => x.score > 0)
      .sort((x, y) => y.score - x.score);
    if (!scored.length) continue;
    const best = scored[0];
    const tied = scored.filter((x) => x.score >= best.score - 0.02);
    m.candidates = scored.filter((x) => !taken.has(x.id)).slice(0, 5).map((x) => x.id);
    if (tied.length > 1 || best.score < LINK_AT || taken.has(best.id)) { m.confidence = best.score; continue; }
    m.contactId = best.id; m.how = "name"; m.confidence = best.score;
    taken.add(best.id);
  }
  return out;
}

/** The same person listed twice (a bot and a calendar both name them): one entry, the email kept. Pure. */
export function dedupePeople(people: Person[]): Person[] {
  const out: Person[] = [];
  for (const p of people) {
    const email = lower(p.email), toks = nameTokens(p.name).join(" ");
    const same = out.find((q) => (email && lower(q.email) === email) || (toks && nameTokens(q.name).join(" ") === toks));
    if (!same) { out.push({ name: p.name.trim(), ...(email ? { email } : {}) }); continue; }
    if (!same.email && email) same.email = email;
    if (p.name.trim().length > same.name.length && toks === nameTokens(same.name).join(" ")) same.name = p.name.trim();
  }
  return out.filter((p) => p.name || p.email);
}
