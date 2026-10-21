/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * UX smoke crawl: signs up through the real form, completes onboarding, then opens every page and
 * every tab in the navigation at desktop (1440×900) and phone (390×844) widths. For each it records
 * console errors and warnings, uncaught exceptions, failed requests (with their bodies), raw or
 * technical text on screen, horizontal overflow, elements pushed off-screen, low-contrast text, and
 * timings; then it checks every internal link it saw for a 404.
 *
 * Run against a production build with a throwaway database, never production:
 *
 *   pnpm build && pnpm start -p 3101
 *   pnpm exec tsx scripts/e2e-ux.ts [--base http://localhost:3101] [--out /tmp/ux] [--only /app/news,/app/crm] [--mobile-only|--desktop-only] [--fresh] [--allow-upstream]
 *
 * --fresh signs up a new account even when OUT/state.json exists. --allow-upstream does not fail on
 * 502/503/504 answers (a data provider not answering: expected on a machine without outbound access).
 *
 * Playwright is not a dependency of the app: the script loads it from PLAYWRIGHT_MODULE, or the global
 * install, and Chromium from PW_CHROMIUM (default /opt/pw-browsers/chromium). Exits 1 when a page shows
 * raw text, throws, overflows sideways or answers 5xx, so it can gate a deploy.
 */
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { join } from "node:path";
import { FEATURES } from "@/lib/nav";
import { TOOL_CATALOG } from "@/lib/workflows/catalog";

const arg = (name: string) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : undefined; };
const flag = (name: string) => process.argv.includes(`--${name}`);
const BASE = (arg("base") ?? "http://localhost:3101").replace(/\/$/, "");
const OUT = arg("out") ?? "/tmp/youbank-ux";
const ONLY = arg("only")?.split(",").map((s) => s.trim()).filter(Boolean);
mkdirSync(OUT, { recursive: true });

function loadPlaywright(): any {
  const candidates = [process.env.PLAYWRIGHT_MODULE, "playwright", "playwright-core"].filter(Boolean) as string[];
  try { candidates.push(join(execSync("npm root -g", { encoding: "utf8" }).trim(), "playwright")); } catch { /* no npm */ }
  const req = createRequire(import.meta.url);
  for (const c of candidates) { try { return req(c); } catch { /* next */ } }
  throw new Error("Playwright not found: set PLAYWRIGHT_MODULE to its install path");
}

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844, isMobile: true, hasTouch: true },
].filter((v) => (flag("mobile-only") ? v.name === "mobile" : flag("desktop-only") ? v.name === "desktop" : true));

/** Every page, plus every tab link in the navigation. Dynamic pages get a real id where one is known. */
function routes(): string[] {
  const pub = ["/", "/pricing", "/download", "/privacy", "/terms", "/refunds", "/news", "/sign-in", "/for/banker", "/for/vc", "/office/connect", "/desktop/connect", "/no-such-page"];
  const app = ["/app", "/app/terminal", "/app/news", "/app/tools", "/app/studio", "/app/edge", "/app/vc", "/app/crypto", "/app/copy", "/app/algo", "/app/quant", "/app/crm",
    "/app/calendar", "/app/collab", "/app/library", "/app/team", "/app/team/join", "/app/settings", "/app/profile", "/app/office", "/app/no-such-page"];
  const tabs = FEATURES.flatMap((f) => (f.links ?? []).map((l) => l.href));
  const tools = TOOL_CATALOG.slice(0, 3).map((t) => `/app/tools/${t.id}`);
  const settings = ["/app/settings?tab=plan", "/app/settings?tab=billing", "/app/terminal?q=AAPL", "/app/copy/fund/1067983", "/app/copy/fund/9999999", "/app/tools/not-a-tool", "/app/studio/999999999", "/app/collab/999999999", "/app/news/story/999999999"];
  const all = [...new Set([...pub, ...app, ...tabs, ...tools, ...settings])];
  return ONLY ? all.filter((r) => ONLY.some((o) => r === o || r.startsWith(o))) : all;
}

const RAW = [
  /\bTypeError\b/, /\bReferenceError\b/, /\bSyntaxError\b/, /\[object Object\]/, /Internal Server Error/i, /\bundefined\b/, /\bNaN\b/, /\bnull\b(?! ?(hypothesis|island))/,
  /\bat [\w.<>]+ \(.*:\d+:\d+\)/, /\b(select|insert|update|delete)\b .*\b(from|into|set)\b .*\bwhere\b/i, /relation "[^"]+" does not exist/i, /\bECONN(REFUSED|RESET)\b/,
  /\b[A-Z][A-Z0-9_]*_(API_KEY|SECRET|TOKEN|URL|KEY|ID)\b/, /\.env(\.local)?\b|pnpm exec|drizzle-kit/, /^\s*[{[]"[\w]+":/m, /\bPostgresError\b/, /\bstack\b.*\bline\b/i, /Unexpected token/, /Failed to fetch/,
];

type Result = {
  route: string; viewport: string; status: number | null; finalUrl: string; title: string;
  console: string[]; pageErrors: string[]; failed: { url: string; status: number; body: string }[]; requestFailed: string[];
  raw: string[]; overflow: { scrollWidth: number; clientWidth: number; wide?: string[] } | null; offscreen: string[]; lowContrast: string[];
  timings: { ttfb: number; fcp: number | null; lcp: number | null; dcl: number; load: number; idle: number }; links: string[]; focus?: string; empty: boolean;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Waits until no request has been in flight for `quiet` ms (or `cap` ms passed). Returns the time spent. */
async function settle(page: any, inflight: { n: number; last: number }, quiet = 800, cap = 15_000) {
  const start = Date.now();
  while (Date.now() - start < cap) {
    if (inflight.n <= 0 && Date.now() - inflight.last > quiet) break;
    await sleep(100);
  }
  return Date.now() - start;
}

async function inspect(page: any, vw: { width: number }) {
  return page.evaluate((vwWidth: number) => {
    const doc = document.scrollingElement ?? document.documentElement;
    const overflow = doc.scrollWidth > window.innerWidth + 1 ? { scrollWidth: doc.scrollWidth, clientWidth: window.innerWidth } : null;
    const describe = (el: Element) => {
      const h = el as HTMLElement;
      const label = (h.getAttribute("aria-label") || h.innerText || h.getAttribute("placeholder") || "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${el.tagName.toLowerCase()}${h.id ? `#${h.id}` : ""}${label ? ` "${label}"` : ""}`;
    };
    // "scroll": inside a container meant to scroll sideways (a table, a strip of tabs): fine.
    // "cut": clipped by a hidden-overflow container it does not fit in. null: past the screen edge.
    const container = (el: Element): "scroll" | "cut" | null => {
      const r = el.getBoundingClientRect();
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        const s = getComputedStyle(p);
        if ((s.overflowX === "auto" || s.overflowX === "scroll") && p.scrollWidth > p.clientWidth + 1) return "scroll";
        if (s.overflowX === "hidden" || s.overflowX === "clip") {
          const pr = p.getBoundingClientRect();
          if (r.right > pr.right + 2 || r.left < pr.left - 2) return pr.right > vwWidth + 2 ? null : "cut";
          return "scroll"; // fits inside its clipping box
        }
      }
      return null;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const s = getComputedStyle(el);
      return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none" && Number(s.opacity) > 0.05;
    };
    const offscreen: string[] = [];
    for (const el of Array.from(document.querySelectorAll("button, a, input, select, textarea, h1, h2, h3, [role=tab]"))) {
      if (!visible(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.right > vwWidth + 2 || r.left < -2) {
        const c = container(el);
        if (c !== "scroll") offscreen.push(`${c === "cut" ? "cut off: " : ""}${describe(el)}`);
      }
      if (offscreen.length >= 8) break;
    }
    // Content below the fold that nothing can scroll to (no scrolling ancestor, and the document itself
    // does not scroll): the person can never reach it.
    const scrollsY = (p: Element) => { const s = getComputedStyle(p); return (s.overflowY === "auto" || s.overflowY === "scroll") && p.scrollHeight > p.clientHeight + 1; };
    const docScrolls = doc.scrollHeight > window.innerHeight + 1 && getComputedStyle(document.body).overflowY !== "hidden";
    let unreachable = "";
    if (!docScrolls) {
      for (const el of Array.from(document.querySelectorAll("button, a, input, textarea, h1, h2, h3, p, td"))) {
        if (!visible(el) || el.getBoundingClientRect().top < window.innerHeight + 4) continue;
        if (el.closest("[aria-hidden=true], [hidden], dialog:not([open])")) continue;
        let ok = false;
        for (let p = el.parentElement; p; p = p.parentElement) if (scrollsY(p)) { ok = true; break; }
        if (!ok) { unreachable = `unreachable below the fold: ${describe(el)}`; break; }
      }
    }
    if (unreachable) offscreen.unshift(unreachable);
    // A page-wide container that scrolls sideways on its own (the app shell scrolls inside <main>, so the
    // document never overflows): the page is wider than the screen.
    const wide: string[] = [];
    for (const el of Array.from(document.querySelectorAll("main, main *, [data-page], body > div *"))) {
      const s = getComputedStyle(el);
      if (s.overflowX !== "auto" && s.overflowX !== "scroll") continue;
      const h = el as HTMLElement;
      if (h.clientWidth < window.innerWidth * 0.85 || h.scrollWidth <= h.clientWidth + 4 || el.closest("table, .table-scroll, [role=tablist], .no-scrollbar")) continue;
      if (el.querySelector(":scope > table, :scope > div > table")) continue;
      // A row of tabs or chips that scrolls sideways on purpose.
      if (el.tagName === "NAV" || [...el.children].every((c) => c.matches("button, a, [role=tab]"))) continue;
      wide.push(`${el.tagName.toLowerCase()}.${(h.className || "").toString().split(" ").slice(0, 4).join(".")} ${h.scrollWidth}>${h.clientWidth}`);
      if (wide.length >= 3) break;
    }
    // Contrast of text against the first opaque background behind it (WCAG ratio, flags under 3:1).
    const rgb = (c: string) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
    const lum = (c: { r: number; g: number; b: number }) => { const f = (v: number) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
    const bgOf = (el: Element) => { for (let p: Element | null = el; p; p = p.parentElement) { const c = rgb(getComputedStyle(p).backgroundColor); if (c && c.a > 0.9) return c; } return rgb(getComputedStyle(document.body).backgroundColor) ?? { r: 0, g: 0, b: 0, a: 1 }; };
    const lowContrast: string[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set<Element>();
    for (let n = walker.nextNode(); n && lowContrast.length < 6; n = walker.nextNode()) {
      const el = n.parentElement;
      if (!el || seen.has(el) || !(n.textContent ?? "").trim() || !visible(el)) continue;
      seen.add(el);
      const s = getComputedStyle(el);
      const fg = rgb(s.color); if (!fg || fg.a < 0.5) continue;
      if (el.closest("[aria-hidden=true], [disabled], svg, canvas")) continue;
      const bg = bgOf(el);
      const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x);
      const ratio = (a + 0.05) / (b + 0.05);
      if (ratio < 3) lowContrast.push(`${ratio.toFixed(2)}:1 "${(n.textContent ?? "").trim().slice(0, 30)}"`);
    }
    const links = Array.from(document.querySelectorAll("a[href]")).map((a) => (a as HTMLAnchorElement).href).filter((h) => h.startsWith(location.origin));
    const main = (document.querySelector("main") ?? document.body) as HTMLElement;
    return { overflow: overflow ?? (wide.length ? { scrollWidth: -1, clientWidth: window.innerWidth, wide } : null), offscreen, lowContrast, links, text: document.body.innerText, empty: main.innerText.trim().length < 20, title: document.title };
  }, vw.width);
}

async function focusCheck(page: any): Promise<string | undefined> {
  const seen = new Set<string>();
  for (let i = 0; i < 25; i++) {
    await page.keyboard.press("Tab");
    seen.add(await page.evaluate(() => { const a = document.activeElement as HTMLElement | null; return a ? `${a.tagName}:${a.textContent?.slice(0, 20) ?? ""}:${a.getAttribute("href") ?? ""}` : "none"; }));
  }
  const focusable = await page.evaluate(() => document.querySelectorAll("a[href], button:not([disabled]), input, select, textarea").length);
  return focusable > 6 && seen.size <= 2 ? `focus stuck on ${[...seen].join(" | ")}` : undefined;
}

async function crawlOne(context: any, route: string, vp: (typeof VIEWPORTS)[number]): Promise<Result> {
  const page = await context.newPage();
  const res: Result = { route, viewport: vp.name, status: null, finalUrl: "", title: "", console: [], pageErrors: [], failed: [], requestFailed: [], raw: [], overflow: null, offscreen: [], lowContrast: [], timings: { ttfb: 0, fcp: null, lcp: null, dcl: 0, load: 0, idle: 0 }, links: [], empty: false };
  const inflight = { n: 0, last: Date.now() };
  page.on("console", (m: any) => { if (m.type() === "error" || m.type() === "warning") res.console.push(`${m.type()}: ${m.text().slice(0, 400)}`); });
  page.on("pageerror", (e: Error) => res.pageErrors.push(`${e.name}: ${e.message.slice(0, 400)}`));
  page.on("request", () => { inflight.n++; inflight.last = Date.now(); });
  const done = () => { inflight.n--; inflight.last = Date.now(); };
  page.on("requestfinished", done);
  page.on("requestfailed", (r: any) => { done(); const f = r.failure()?.errorText ?? ""; if (!/ERR_ABORTED|NS_BINDING_ABORTED/.test(f)) res.requestFailed.push(`${r.method()} ${r.url().replace(BASE, "")} ${f}`); });
  page.on("response", async (r: any) => {
    if (r.status() < 400) return;
    let body = ""; try { body = (await r.text()).slice(0, 300); } catch { /* streamed */ }
    res.failed.push({ url: `${r.request().method()} ${r.url().replace(BASE, "")}`, status: r.status(), body });
  });
  // tsx (esbuild) names inner functions with a `__name` helper that does not exist in the page.
  await page.addInitScript("window.__name = (f) => f;");
  await page.addInitScript(() => {
    (window as any).__lcp = null;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) (window as any).__lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch { /* unsupported */ }
  });
  try {
    const resp = await page.goto(BASE + route, { waitUntil: "load", timeout: 45_000 });
    res.status = resp?.status() ?? null;
    res.timings.idle = await settle(page, inflight);
    await sleep(300);
    const t = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
      return { ttfb: Math.round(n?.responseStart ?? 0), dcl: Math.round(n?.domContentLoadedEventEnd ?? 0), load: Math.round(n?.loadEventEnd ?? 0), fcp: fcp && Math.round(fcp), lcp: (window as any).__lcp && Math.round((window as any).__lcp) };
    });
    res.timings = { ...res.timings, ...t, idle: t.load + res.timings.idle };
    const ins = await inspect(page, vp);
    res.finalUrl = page.url().replace(BASE, ""); res.title = ins.title; res.overflow = ins.overflow; res.offscreen = ins.offscreen; res.lowContrast = ins.lowContrast; res.links = ins.links; res.empty = ins.empty;
    for (const re of RAW) {
      const m = ins.text.match(re);
      if (m) { const i = m.index ?? 0; res.raw.push(`${re.source.slice(0, 24)} → "${ins.text.slice(Math.max(0, i - 40), i + 60).replace(/\s+/g, " ")}"`); }
    }
    if (vp.name === "desktop") res.focus = await focusCheck(page);
    await page.screenshot({ path: join(OUT, `${vp.name}${route.replace(/[^a-z0-9]+/gi, "_")}.png`), fullPage: false });
  } catch (e) {
    res.pageErrors.push(`crawl: ${(e as Error).message.split("\n")[0]}`);
  }
  await page.close();
  return res;
}

async function signUp(browser: any, email: string, password: string) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(`${BASE}/sign-in`);
  await page.getByRole("button", { name: /create an account/i }).click();
  await page.getByPlaceholder("Your name").fill("Avery Analyst");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder(/Password/).fill(password);
  await page.getByRole("button", { name: /create account/i }).click();
  await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
  // Role (default), specialty, experience, then through to the end.
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("main button.ctl.border").first().click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.locator("main button.ctl.border").first().click();
  for (let i = 0; i < 3; i++) await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: /open my workspace/i }).click();
  await page.waitForURL(/\/app$/, { timeout: 30_000 });
  // Edge is an opt-in beta: turn it on so its views are crawled too.
  await page.goto(`${BASE}/app/edge`);
  await page.getByRole("button", { name: /try the edge beta/i }).click({ timeout: 15_000 }).catch(() => undefined);
  await page.waitForTimeout(2_000);
  await context.storageState({ path: join(OUT, "state.json") });
  await context.close();
}

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM ?? "/opt/pw-browsers/chromium" });
  const statePath = join(OUT, "state.json");
  if (!existsSync(statePath) || flag("fresh")) {
    const email = `ux-${Date.now()}@example.com`;
    await signUp(browser, email, "correct-horse-battery");
    console.log(`signed up ${email}`);
  }
  const results: Result[] = [];
  const list = routes();
  for (const vp of VIEWPORTS) {
    const opts = { viewport: { width: vp.width, height: vp.height }, isMobile: !!vp.isMobile, hasTouch: !!vp.hasTouch, deviceScaleFactor: 1 };
    const context = await browser.newContext({ ...opts, storageState: statePath });
    // Public pages as a visitor sees them: signed out.
    const visitor = await browser.newContext(opts);
    for (const r of list) {
      const out = await crawlOne(r.startsWith("/app") ? context : visitor, r, vp);
      results.push(out);
      const bad = out.pageErrors.length + out.raw.length + (out.overflow ? 1 : 0) + out.failed.filter((f) => f.status >= 500).length;
      console.log(`${bad ? "!!" : "ok"} ${vp.name.padEnd(7)} ${r.padEnd(44)} ${out.status} ${String(out.timings.lcp ?? out.timings.fcp ?? "-").padStart(5)}ms idle ${out.timings.idle}ms  console ${out.console.length} err ${out.pageErrors.length} raw ${out.raw.length} 4xx/5xx ${out.failed.length} ovf ${out.overflow ? out.overflow.scrollWidth : "-"} off ${out.offscreen.length}`);
    }
    await context.close();
    await visitor.close();
  }
  // Every internal link seen, checked once with the signed-in cookies.
  const ctx = await browser.newContext({ storageState: statePath });
  const links = [...new Set(results.flatMap((r) => r.links.map((l) => l.split("#")[0])))].filter((l) => !/\/api\/auth\/|sign-out|\.(pdf|xlsx|pptx|zip|dmg|exe)$/.test(l));
  const broken: { url: string; status: number; from: string[] }[] = [];
  for (const l of links) {
    try {
      const r = await ctx.request.get(l, { maxRedirects: 5, timeout: 30_000 });
      if (r.status() >= 400) broken.push({ url: l.replace(BASE, ""), status: r.status(), from: [...new Set(results.filter((x) => x.links.includes(l)).map((x) => x.route))].slice(0, 4) });
    } catch (e) { broken.push({ url: l.replace(BASE, ""), status: 0, from: [(e as Error).message.slice(0, 80)] }); }
  }
  await ctx.close();
  await browser.close();
  writeFileSync(join(OUT, "results.json"), JSON.stringify({ results: results.map((r) => ({ ...r, links: undefined })), broken }, null, 1));
  console.log(`\n${links.length} internal links checked, ${broken.length} broken${broken.length ? ":" : ""}`);
  for (const b of broken) console.log(`  ${b.status} ${b.url}  (from ${b.from.join(", ")})`);
  const upstream = (status: number) => flag("allow-upstream") && status >= 502 && status <= 504;
  const gate = results.filter((r) => r.pageErrors.length || r.raw.length || r.offscreen.some((o) => o.startsWith("unreachable")) || r.overflow
    || r.failed.some((f) => f.status >= 500 && !upstream(f.status) && !/\/api\/health/.test(f.url)));
  console.log(`\n${results.length} page views, ${gate.length} with blocking issues. Details: ${join(OUT, "results.json")}`);
  process.exit(gate.length || broken.some((b) => b.status >= 500) ? 1 : 0);
}

if (existsSync(join(OUT, "results.json")) && flag("summary")) {
  console.log(readFileSync(join(OUT, "results.json"), "utf8").slice(0, 2000));
} else {
  main().catch((e) => { console.error(e); process.exit(1); });
}
