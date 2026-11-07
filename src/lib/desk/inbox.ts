/**
 * The desk inbox (Home's "Waiting for you", GET /api/desk/inbox): one queue of what the agents left for
 * the person to decide. Pure: the item shape, the order, and which existing endpoint carries out each
 * decision, so nothing here gets around the rules those endpoints keep (sending learns trust, approving a
 * suggestion only ever makes a draft, the autopilot gate). Tested in scripts/test-inbox.ts.
 */

export type InboxKind = "question" | "draft" | "action" | "alert";

export type InboxItem = {
  key: string;
  kind: InboxKind;
  id: number;
  title: string;
  /** Why it is here: the agent's reasoning, why autopilot held it, the question's context. */
  detail: string;
  at: string;
  /** Drafts. */
  body?: string; to?: string; held?: boolean; sensitive?: boolean; confidence?: string; scheduledFor?: string | null;
  /** Suggestions that need an email address typed in (adding a person a meeting introduced). */
  needsEmail?: boolean; name?: string;
  /** Alerts. */
  href?: string; urgent?: boolean;
};

export type InboxVerb = "send" | "discard" | "unschedule" | "answer" | "dismiss" | "approve" | "read";

/**
 * Most pressing first: a draft autopilot is about to send (the last chance to stop it), questions the
 * agent is blocked on, urgent alerts, drafts autopilot held back, other drafts, suggestions, then alerts.
 * Newest first within each.
 */
export function rankOf(i: InboxItem, now = Date.now()): number {
  if (i.kind === "draft" && i.scheduledFor && Date.parse(i.scheduledFor) - now < 6 * 3600_000) return 0;
  if (i.kind === "question") return 1;
  if (i.kind === "alert" && i.urgent) return 2;
  if (i.kind === "draft") return i.held || i.sensitive ? 3 : 4;
  if (i.kind === "action") return 5;
  return 6;
}

export function inboxOrder(items: InboxItem[], now = Date.now()): InboxItem[] {
  return items
    .map((it, idx) => ({ it, idx, r: rankOf(it, now), t: Date.parse(it.at) || 0 }))
    .sort((a, b) => a.r - b.r || b.t - a.t || a.idx - b.idx)
    .map((x) => x.it);
}

/** What each kind can do, in the order the buttons appear. */
export function verbsFor(i: InboxItem): InboxVerb[] {
  switch (i.kind) {
    case "question": return ["answer", "dismiss"];
    case "draft": return i.scheduledFor ? ["unschedule", "send", "discard"] : ["send", "discard"];
    case "action": return ["approve", "dismiss"];
    case "alert": return ["read"];
  }
}

/**
 * The request that carries out a decision, on the endpoint that owns the item. `input` is what the card
 * collected: the answer to a question, the email address for a new contact. Null when the decision does
 * not apply to the item or what it needs is missing.
 */
export function inboxRequest(i: InboxItem, verb: InboxVerb, input: { answer?: string; email?: string } = {}): { url: string; method: "POST" | "PATCH" | "DELETE"; body?: unknown } | null {
  if (!verbsFor(i).includes(verb)) return null;
  const id = encodeURIComponent(String(i.id));
  switch (verb) {
    case "answer": {
      const answer = (input.answer ?? "").trim();
      return answer ? { url: `/api/crm/questions/${id}`, method: "POST", body: { answer, remember: true } } : null;
    }
    case "dismiss": return { url: i.kind === "question" ? `/api/crm/questions/${id}` : `/api/crm/actions/${id}`, method: "DELETE" };
    case "send": return { url: `/api/crm/drafts/${id}/send`, method: "POST", body: {} };
    case "discard": return { url: `/api/crm/drafts/${id}`, method: "DELETE" };
    case "unschedule": return { url: `/api/crm/drafts/${id}`, method: "PATCH", body: { action: "unschedule" } };
    case "approve": {
      if (i.needsEmail) {
        const email = (input.email ?? "").trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
        return { url: `/api/crm/actions/${id}`, method: "POST", body: { email } };
      }
      return { url: `/api/crm/actions/${id}`, method: "POST", body: {} };
    }
    case "read": return { url: "/api/news/notifications", method: "POST", body: { ids: [i.id] } };
  }
}

/** Where the item opens in full (to edit a draft, read the thread, see the story). */
export function inboxHref(i: InboxItem): string {
  if (i.kind === "alert") return i.href && /^\/(?![/\\])/.test(i.href) ? i.href : "/app/news";
  if (i.kind === "question") return "/app/crm?tab=agent";
  if (i.kind === "action") return "/app/crm?tab=pipeline";
  return "/app/crm";
}
