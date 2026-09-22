/** Parser checks for the Gmail connector: pnpm exec tsx --env-file=.env.local scripts/test-gmail-parse.ts */
import { parseAddresses, stripQuoted } from "@/lib/crm/gmail";
let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
ok('name + angle brackets', parseAddresses('Maya Ruiz <maya@ledgerline.io>'), [{ name: "Maya Ruiz", address: "maya@ledgerline.io" }]);
ok('bare address', parseAddresses('bob@y.io'), [{ name: "", address: "bob@y.io" }]);
ok('quoted name with comma', parseAddresses('"Ruiz, Maya" <maya@x.io>, bob@y.io'),
   [{ name: "Ruiz, Maya", address: "maya@x.io" }, { name: "", address: "bob@y.io" }]);
ok('three recipients, one quoted', parseAddresses('a@x.io, "Doe, J" <j@y.io>, Kim <k@z.io>'),
   [{ name: "", address: "a@x.io" }, { name: "Doe, J", address: "j@y.io" }, { name: "Kim", address: "k@z.io" }]);
ok('uppercase normalised', parseAddresses('<Maya@X.IO>'), [{ name: "", address: "maya@x.io" }]);
ok('empty', parseAddresses(''), []);
ok("drops 'On ... wrote:' history",
   stripQuoted("Thanks, that works.\n\nOn Mon, Sep 1, 2026 at 9:00 AM Maya <m@x.io> wrote:\n> the original pitch"),
   "Thanks, that works.");
ok("short reply above a quote", stripQuoted("Yes.\nOn Tue Bob <b@x.io> wrote:\n> hi"), "Yes.");
ok("drops > quoted lines", stripQuoted("New reply.\n> old line"), "New reply.");
ok("keeps an unquoted body", stripQuoted("Just a normal email."), "Just a normal email.");
ok("does not eat a body that merely starts with 'On'",
   stripQuoted("On the topic of pricing, we charge per seat."), "On the topic of pricing, we charge per seat.");
ok("handles Original Message marker", stripQuoted("Sure.\n-----Original Message-----\nfrom before"), "Sure.");
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
