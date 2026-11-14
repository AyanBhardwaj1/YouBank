/**
 * Sign-in end to end in a real browser, against a running YouBank (a local production build is best):
 *   DATABASE_URL=… BETTER_AUTH_SECRET=<the server's> pnpm exec tsx scripts/e2e-auth.ts --base http://localhost:3301
 * Signs up, saves the recovery key, onboards, signs out and in, is refused a wrong password, resets the
 * password with the recovery key (the old password then fails, the new one works), gets a fresh key from
 * scripts/admin-recovery-key.ts as the founder would and resets with that, sees the founder's address on the
 * reset page, and is stopped after too many wrong keys. Every page is checked for raw error text.
 */
import { createRequire } from "node:module";
import { execSync, spawnSync } from "node:child_process";
import { join } from "node:path";

const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : undefined; };
const BASE = (arg("base") ?? "http://localhost:3301").replace(/\/$/, "");
let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => { if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}`, detail ?? ""); } };

function loadPlaywright(): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright", "playwright-core"].filter(Boolean) as string[];
  try { candidates.push(join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright")); } catch { /* no npm */ }
  const req = createRequire(import.meta.url);
  for (const c of candidates) { try { return req(c); } catch { /* next */ } }
  throw new Error("Playwright not found: set PLAYWRIGHT_MODULE to its install path");
}

const RAW = /(Error:|TypeError|at [\w.]+ \(|ECONNREFUSED|stack|undefined is not|Cannot read properties|postgres:|SELECT |Failed query)/;

(async () => {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const email = `auth-${Date.now()}@example.com`;
  const pw1 = "first-password-123", pw2 = "second-password-456", pw3 = "third-password-789";
  const clean = async (where: string) => { const t = await page.locator("body").innerText(); ok(`${where}: no raw error text`, !RAW.test(t), t.match(RAW)?.[0]); };
  const signIn = async (password: string) => {
    await page.goto(`${BASE}/sign-in`);
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder(/Password/).fill(password);
    await page.getByRole("button", { name: /^sign in$/i }).click();
  };
  const signOut = async () => {
    await page.getByRole("button", { name: "Account" }).click();
    await page.getByRole("menuitem", { name: /sign out/i }).click();
    await page.waitForURL((u: URL) => !u.pathname.startsWith("/app"), { timeout: 30_000 });
  };

  console.log("sign up");
  await page.goto(`${BASE}/sign-in`, { timeout: 120_000 });
  await clean("sign-in page");
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByPlaceholder("Your name").fill("Robin Recruiter");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Password/).fill(pw1);
  await page.getByRole("button", { name: /create account/i }).click();
  const keyEl = page.getByLabel("Recovery key");
  await keyEl.waitFor({ timeout: 60_000 });
  const key1 = (await keyEl.innerText()).trim();
  ok("a recovery key is shown once after sign-up", /^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/.test(key1), key1);
  await page.getByText(/I have saved it/i).first().click();
  await page.waitForURL(/\/onboarding/, { timeout: 60_000 });
  ok("then onboarding", page.url().includes("/onboarding"));
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("main button.ctl.border").first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("main button.ctl.border").first().click();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /open my workspace/i }).click();
  await page.waitForURL(/\/app$/, { timeout: 60_000 });
  ok("onboarding finishes in the workspace", /\/app$/.test(page.url()));
  await clean("home");

  console.log("sign out and back in");
  await signOut();
  const back = await page.goto(`${BASE}/app`);
  ok("signed out, the app sends you to sign in", page.url().includes("/sign-in") || (back?.status() ?? 0) >= 300);
  await signIn("not-the-password-1");
  // Next.js keeps an empty route announcer with role="alert"; read the one that has words.
  const alertText = async () => { await page.getByRole("alert").filter({ hasText: /\w/ }).first().waitFor({ timeout: 30_000 }).catch(() => undefined); return (await page.getByRole("alert").filter({ hasText: /\w/ }).allInnerTexts()).join(" ").trim(); };
  const wrong = await alertText();
  ok("a wrong password is refused with a plain message", page.url().includes("/sign-in") && wrong.length > 5 && !RAW.test(wrong), wrong);
  await signIn(pw1);
  await page.waitForURL(/\/app/, { timeout: 60_000 });
  ok("the right password signs in", page.url().includes("/app"));
  await signOut();

  console.log("forgot password: the recovery key");
  await page.goto(`${BASE}/sign-in`);
  await page.getByRole("link", { name: /forgot your password/i }).click();
  await page.waitForURL(/\/sign-in\/reset/);
  await clean("reset page");
  ok("the reset page names the founder for anyone without a key", (await page.locator("body").innerText()).includes("bhardwajayan000@gmail.com"));
  await page.getByPlaceholder("Your account's email").first().fill(email);
  await page.getByPlaceholder("XXXX-XXXX-XXXX-XXXX-XXXX").fill(key1.toLowerCase().replace(/-/g, " "));
  await page.getByPlaceholder(/New password/).fill(pw2);
  await page.getByPlaceholder(/The same password again/).fill(pw2);
  await page.getByRole("button", { name: /set the new password/i }).click();
  const key2El = page.getByLabel("Recovery key");
  await key2El.waitFor({ timeout: 30_000 });
  const key2 = (await key2El.innerText()).trim();
  ok("the key resets the password (typed in lower case with spaces) and a new key replaces it", key2 !== key1 && /^[A-Z0-9]{4}(-[A-Z0-9]{4}){4}$/.test(key2));
  await signIn(pw1);
  await page.waitForTimeout(3_000);
  ok("the old password no longer works", page.url().includes("/sign-in"));
  await signIn(pw2);
  await page.waitForURL(/\/app/, { timeout: 60_000 });
  ok("the new password does", page.url().includes("/app"));
  await signOut();

  console.log("forgot password: the founder's key");
  const admin = spawnSync("pnpm", ["exec", "tsx", "scripts/admin-recovery-key.ts", email], { encoding: "utf8", env: process.env });
  const key3 = /([A-Z0-9]{4}(?:-[A-Z0-9]{4}){4})/.exec(admin.stdout)?.[1] ?? "";
  ok("the admin script issues a fresh key for the email", admin.status === 0 && !!key3, admin.stderr.slice(0, 300));
  await page.goto(`${BASE}/sign-in/reset`);
  await page.getByPlaceholder("Your account's email").first().fill(email);
  await page.getByPlaceholder("XXXX-XXXX-XXXX-XXXX-XXXX").fill(key2);
  await page.getByPlaceholder(/New password/).fill(pw3);
  await page.getByPlaceholder(/The same password again/).fill(pw3);
  await page.getByRole("button", { name: /set the new password/i }).click();
  await page.getByRole("alert").filter({ hasText: /do not match/ }).first().waitFor({ timeout: 30_000 }).catch(() => undefined);
  ok("the key it replaced no longer works", (await page.getByRole("alert").filter({ hasText: /\w/ }).allInnerTexts()).join(" ").includes("do not match"));
  await page.getByPlaceholder("XXXX-XXXX-XXXX-XXXX-XXXX").fill(key3);
  await page.getByRole("button", { name: /set the new password/i }).click();
  await page.getByLabel("Recovery key").waitFor({ timeout: 30_000 });
  await signIn(pw3);
  await page.waitForURL(/\/app/, { timeout: 60_000 });
  ok("the founder's key resets the password and the person is back in", page.url().includes("/app"));
  await signOut();

  console.log("too many wrong keys");
  let limited = "";
  for (let i = 0; i < 7 && !limited; i++) {
    const r = await page.request.post(`${BASE}/api/account/recovery/reset`, { data: { email, key: "AAAA-BBBB-CCCC-DDDD-EEEE", password: "whatever-password-1" }, headers: { origin: BASE } });
    if (r.status() === 429) limited = String((await r.json().catch(() => ({}))).error ?? "");
  }
  ok("guessing keys is stopped after a few tries, in plain words", limited.includes("Too many tries"), limited);

  await browser.close();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
