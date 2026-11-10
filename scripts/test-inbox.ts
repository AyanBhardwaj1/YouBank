/** Desk inbox order and requests (src/lib/desk/inbox.ts): pnpm exec tsx scripts/test-inbox.ts */
import { inboxHref, inboxOrder, inboxRequest, verbsFor, type InboxItem } from "@/lib/desk/inbox";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const now = Date.parse("2026-11-04T12:00:00Z");
const item = (p: Partial<InboxItem> & Pick<InboxItem, "key" | "kind">): InboxItem => ({ id: 7, title: "t", detail: "", at: "2026-11-04T10:00:00Z", ...p });

console.log("order");
const list = [
  item({ key: "alert", kind: "alert" }),
  item({ key: "action", kind: "action" }),
  item({ key: "draft-old", kind: "draft", at: "2026-11-03T10:00:00Z" }),
  item({ key: "draft-new", kind: "draft", at: "2026-11-04T11:00:00Z" }),
  item({ key: "held", kind: "draft", held: true }),
  item({ key: "urgent", kind: "alert", urgent: true }),
  item({ key: "question", kind: "question" }),
  item({ key: "sending", kind: "draft", scheduledFor: "2026-11-04T13:00:00Z" }),
  item({ key: "later", kind: "draft", scheduledFor: "2026-11-06T13:00:00Z", at: "2026-11-01T10:00:00Z" }),
];
ok("about-to-send, questions, urgent, held, drafts newest first, suggestions, alerts",
  inboxOrder(list, now).map((i) => i.key), ["sending", "question", "urgent", "held", "draft-new", "draft-old", "later", "action", "alert"]);
ok("the order is stable and does not change the input", list[0].key, "alert");

console.log("decisions go to the endpoint that owns the item");
const q = item({ key: "q", kind: "question", id: 5 });
ok("answering needs words", inboxRequest(q, "answer", { answer: "  " }), null);
ok("an answer is remembered", inboxRequest(q, "answer", { answer: " Yes, 2x " }), { url: "/api/crm/questions/5", method: "POST", body: { answer: "Yes, 2x", remember: true } });
ok("a question is dismissed on its own route", inboxRequest(q, "dismiss")?.url, "/api/crm/questions/5");
ok("a question cannot be sent", inboxRequest(q, "send"), null);
const dr = item({ key: "d", kind: "draft", id: 9 });
ok("send goes through the send route (trust is learned there)", inboxRequest(dr, "send"), { url: "/api/crm/drafts/9/send", method: "POST", body: {} });
ok("discard deletes the draft", inboxRequest(dr, "discard")?.method, "DELETE");
ok("only a scheduled draft can be unscheduled", [inboxRequest(dr, "unschedule"), inboxRequest({ ...dr, scheduledFor: "2026-11-04T13:00:00Z" }, "unschedule")?.body], [null, { action: "unschedule" }]);
ok("stopping autopilot is offered first", verbsFor({ ...dr, scheduledFor: "x" })[0], "unschedule");
const ac = item({ key: "a", kind: "action", id: 3 });
ok("approving a suggestion", inboxRequest(ac, "approve"), { url: "/api/crm/actions/3", method: "POST", body: {} });
ok("dismissing a suggestion", inboxRequest(ac, "dismiss")?.url, "/api/crm/actions/3");
const add = { ...ac, needsEmail: true };
ok("a new contact needs a real address", [inboxRequest(add, "approve", { email: "nope" }), inboxRequest(add, "approve", { email: " a@b.co " })?.body], [null, { email: "a@b.co" }]);
const al = item({ key: "n", kind: "alert", id: 4, href: "https://evil.example/x" });
ok("an alert is marked read on the bell's route", inboxRequest(al, "read"), { url: "/api/news/notifications", method: "POST", body: { ids: [4] } });
ok("an alert only opens inside the app", [inboxHref(al), inboxHref({ ...al, href: "/story/abc" })], ["/app/news", "/story/abc"]);
ok("…not a protocol-relative link either", [inboxHref({ ...al, href: "//evil.example" }), inboxHref({ ...al, href: "/\\evil.example" })], ["/app/news", "/app/news"]);
ok("an id is encoded into the path", inboxRequest({ ...dr, id: "1/../x" as unknown as number }, "discard")?.url, "/api/crm/drafts/1%2F..%2Fx");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
