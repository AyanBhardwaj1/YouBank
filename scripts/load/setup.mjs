/**
 * Create the load test's signed-in users against a LOCAL server running on a Neon test branch:
 * sign up (or in) through the app's own auth route, finish onboarding with a role, and give every
 * third user a blank Studio document to follow. Writes the users and their session cookies to --out
 * (keep it outside the repo: the cookies are live sessions on the test branch).
 *
 *   node scripts/load/setup.mjs --base http://localhost:3999 --users 60 --out /tmp/loadtest-users.json
 */
import { writeFileSync } from "node:fs";
import { guardTarget, parseArgs } from "./common.mjs";

const args = parseArgs(process.argv.slice(2), { base: "http://localhost:3999", users: "60", out: "", password: "LoadTest-2026-only!" });
if (!args.out) throw new Error("--out is required (a path outside the repo)");
const base = guardTarget(args.base);
const ROLES = ["banker", "pe", "vc", "markets", "corpfin", "consultant", "accountant", "student"];

const jar = (res, prev = "") => {
  const cookies = new Map(prev.split("; ").filter(Boolean).map((c) => [c.split("=")[0], c]));
  for (const c of res.headers.getSetCookie?.() ?? []) { const pair = c.split(";")[0]; cookies.set(pair.split("=")[0], pair); }
  return [...cookies.values()].join("; ");
};

/** POST to the auth route, waiting out its rate limit (a few sign-ups per ten seconds per address). */
async function authPost(path, body) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(`${base}/api/auth/${path}`, { method: "POST", headers: { "content-type": "application/json", origin: base }, body: JSON.stringify(body), redirect: "manual" });
    if (res.status !== 429 || attempt >= 8) return res;
    await new Promise((r) => setTimeout(r, 5_000 * (attempt + 1)));
  }
}

async function signIn(email, name) {
  let res = await authPost("sign-up/email", { email, password: args.password, name });
  if (!res.ok) res = await authPost("sign-in/email", { email, password: args.password });
  if (!res.ok) throw new Error(`sign-in failed for ${email}: ${res.status} ${(await res.text()).slice(0, 200)}`);
  return jar(res);
}

const users = [];
const n = Number(args.users);
for (let i = 1; i <= n; i++) {
  const email = `loadtest+${String(i).padStart(3, "0")}@youbank-loadtest.dev`;
  const role = ROLES[i % ROLES.length];
  let cookie = await signIn(email, `Load Test ${i}`);
  const p = await fetch(`${base}/api/profile`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ role, sectors: ["energy", "tech"], firmName: "Load Test Capital" }) });
  if (!p.ok) throw new Error(`onboarding failed for ${email}: ${p.status} ${(await p.text()).slice(0, 200)}`);
  cookie = jar(p, cookie);
  const user = { email, role, cookie };
  if (i % 3 === 0) {
    const d = await fetch(`${base}/api/studio`, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify({ template: "blank", title: `Load test ${i}` }) });
    if (!d.ok) throw new Error(`document failed for ${email}: ${d.status} ${(await d.text()).slice(0, 200)}`);
    const { id } = await d.json();
    const doc = await (await fetch(`${base}/api/studio/${id}`, { headers: { cookie } })).json();
    Object.assign(user, { docId: id, sheetId: doc.doc.workbook.order[0] });
  }
  users.push(user);
  process.stdout.write(`\r${i}/${n} users ready`);
}
writeFileSync(args.out, JSON.stringify(users, null, 2));
console.log(`\nwrote ${users.length} users (${users.filter((u) => u.docId).length} with documents) to ${args.out}`);
