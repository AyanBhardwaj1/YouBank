/** Commercial email compliance checks: pnpm exec tsx scripts/test-compliance.ts */
process.env.EMAIL_TOKEN_SECRET ||= "test-secret-at-least-sixteen-chars";
import { complianceFooter, isCommercial, launchChecks, readUnsubscribeToken, senderAuth, unsubscribeHeaders, unsubscribeToken } from "@/lib/crm/compliance";
import { buildRaw } from "@/lib/crm/gmail";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};

void (async () => {
  console.log("which mail is commercial");
  ok("campaign and nurture are", [isCommercial("campaign"), isCommercial("nurture")], [true, true]);
  ok("replies, follow-ups, compose and intros are not", ["reply", "follow_up", "compose", "intro"].map(isCommercial), [false, false, false, false]);

  console.log("unsubscribe tokens");
  const t = unsubscribeToken("user_1", " Maya@Ledgerline.io ");
  ok("round trip, address lower-cased", readUnsubscribeToken(t), { userId: "user_1", email: "maya@ledgerline.io" });
  const [payload, mac] = t.split(".");
  const other = Buffer.from(JSON.stringify({ u: "user_1", e: "someone@else.io" })).toString("base64url");
  ok("a payload swapped under the same signature is refused", readUnsubscribeToken(`${other}.${mac}`), null);
  ok("a cut-off signature is refused", readUnsubscribeToken(`${payload}.${mac.slice(0, 10)}`), null);
  ok("junk is refused", [readUnsubscribeToken(""), readUnsubscribeToken("abc"), readUnsubscribeToken("a.b")], [null, null, null]);

  console.log("footer and headers");
  ok("footer carries the address on one line and the link", complianceFooter("548 Market St\nSan Francisco, CA 94104", "https://x.io/u/t"),
    '\n\n--\n548 Market St, San Francisco, CA 94104\nTo stop these emails, reply "unsubscribe" or open https://x.io/u/t');
  ok("RFC 8058 headers", unsubscribeHeaders("https://x.io/u/t", "me@fund.vc"),
    { "List-Unsubscribe": "<https://x.io/u/t>, <mailto:me@fund.vc?subject=unsubscribe>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" });
  const raw = Buffer.from(buildRaw({ to: ["a@b.io"], subject: "Hi", body: "Hello", headers: unsubscribeHeaders("https://x.io/u/t", "me@fund.vc") }), "base64url").toString("utf8");
  ok("Gmail raw message carries both headers", [/\r\nList-Unsubscribe: <https:\/\/x\.io\/u\/t>, <mailto:me@fund\.vc\?subject=unsubscribe>\r\n/.test(raw), /\r\nList-Unsubscribe-Post: List-Unsubscribe=One-Click\r\n/.test(raw)], [true, true]);
  const injected = Buffer.from(buildRaw({ to: ["a@b.io"], subject: "Hi", body: "Hello", headers: { "List-Unsubscribe": "<x>\r\nBcc: evil@x.io" } }), "base64url").toString("utf8");
  ok("a line break in a header value cannot add a header", /\r\nBcc:/.test(injected), false);

  console.log("sender domain checks");
  const dns = (records: Record<string, string[][]>) => ({ resolveTxt: async (name: string) => { if (records[name]) return records[name]; throw Object.assign(new Error("ENODATA"), { code: "ENODATA" }); } });
  ok("a public mailbox domain is the provider's to authenticate", (await senderAuth("me@gmail.com", dns({}))).hosted, true);
  const good = await senderAuth("me@fund.vc", dns({ "fund.vc": [["v=spf1 include:_spf.google.com ~all"]], "_dmarc.fund.vc": [["v=DMARC1; p=none"]], "google._domainkey.fund.vc": [["v=DKIM1; k=rsa; p=MIIB"]] }));
  ok("SPF, DMARC and DKIM found", [good.spf, good.dmarc, good.dkim], [true, true, true]);
  ok("a well set-up domain launches with no warnings", launchChecks([good]), { blockers: [], warnings: [] });
  const bare = await senderAuth("me@new.co", dns({ "new.co": [["google-site-verification=abc"]] }));
  ok("nothing published", [bare.spf, bare.dmarc, bare.dkim], [false, false, null]);
  ok("no SPF and no DKIM blocks the launch", launchChecks([bare]).blockers.length, 1);
  const flaky = { resolveTxt: async () => { throw Object.assign(new Error("timeout"), { code: "ETIMEOUT" }); } };
  const unknown = await senderAuth("me@slow.co", flaky);
  ok("a DNS timeout is unknown, not absent", unknown.unchecked, true);
  ok("an unknown domain warns but does not block", [launchChecks([unknown]).blockers.length, launchChecks([unknown]).warnings.length], [0, 1]);
  const noDmarc = await senderAuth("me@ok.co", dns({ "ok.co": [["v=spf1 -all"]] }));
  ok("no DMARC only warns", [launchChecks([noDmarc]).blockers.length, launchChecks([noDmarc]).warnings.length], [0, 1]);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
