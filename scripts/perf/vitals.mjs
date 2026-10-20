/**
 * Page-load and interaction timings for the main signed-in pages, from headless Chromium (Playwright)
 * against a LOCAL production build: FCP, LCP, CLS, total blocking time and long tasks, the JavaScript
 * transferred, the API requests a page makes in its first seconds (duplicates and polling show up
 * here), and the slowest input-to-paint delay (Event Timing, INP-like) of scripted interactions.
 *
 * Two profiles: desktop (1440x900) and mobile (390x844 with 4x CPU throttling). Every run uses a fresh
 * browser context (a first visit, nothing cached); the median of --runs is reported.
 *
 *   node scripts/perf/vitals.mjs --base http://localhost:3201 --users /tmp/users.json --out /tmp/vitals.json
 *     [--runs 3] [--profiles desktop,mobile] [--routes /app,/app/news] [--chromium /path/to/chrome]
 *
 * Needs Playwright (global or local install) and the users file from scripts/load/setup.mjs.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execSync } from "node:child_process";

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const base = arg("base", "http://localhost:3201");
if (!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) throw new Error("vitals.mjs measures a local build only");
const runs = Number(arg("runs", "3"));
const profiles = arg("profiles", "desktop,mobile").split(",");
const users = JSON.parse(readFileSync(arg("users", ""), "utf8"));
const user = users.find((u) => u.docId) ?? users[0];

let chromium;
try { ({ chromium } = await import("playwright")); } catch {
  const req = createRequire(`${execSync("npm root -g").toString().trim()}/`);
  ({ chromium } = req("playwright"));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => { const s = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };

/** Scripted interactions per route (each gets the page and whether it is the phone profile); each is measured as the slowest Event Timing entry it caused. */
const typeInto = (selector, text) => async (page) => { const el = page.locator(selector).first(); await el.click({ timeout: 4000 }); await page.keyboard.type(text, { delay: 60 }); };
const clickText = (text, scope = "button") => async (page) => { await page.locator(scope, { hasText: text }).first().click({ timeout: 4000 }); };
const key = (combo) => async (page) => { await page.keyboard.press(combo); };
const openSidebar = async (page, mobile) => { if (mobile) await page.locator("nav button, nav a", { hasText: "More" }).last().click({ timeout: 4000 }); else await page.keyboard.press("Control+Backslash"); };
const closeSidebar = async (page, mobile) => { if (mobile) await page.keyboard.press("Escape"); else await page.keyboard.press("Control+Backslash"); };
const gridCell = async (page) => { const g = page.locator('div[style*="cursor: cell"]').first(); const b = await g.boundingBox({ timeout: 4000 }); await page.mouse.click(b.x + Math.min(220, b.width / 2), b.y + 70); };

const ROUTES = [
  { path: "/app", name: "home", interactions: [["open sidebar", openSidebar], ["sidebar search", typeInto('input[placeholder="Jump to a feature or tool"]', "comps")], ["close sidebar", closeSidebar]] },
  { path: "/app/terminal", name: "terminal", interactions: [["type command", typeInto("header input", "AAPL")], ["escape", key("Escape")]] },
  { path: "/app/news", name: "newsroom", interactions: [["type search", typeInto('input[type="search"], input[placeholder*="Search" i]', "energy")], ["deals tab", clickText("deals")], ["radar tab", clickText("radar")], ["today tab", clickText("Today")]] },
  { path: `/app/studio/${user.docId}`, name: "studio", interactions: [["select cell", gridCell], ["type cell", async (page) => { await page.keyboard.type("12345", { delay: 60 }); await page.keyboard.press("Enter"); }], ["arrow keys", async (page) => { for (const k of ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"]) await page.keyboard.press(k); }], ["deck tab", clickText("Deck")]] },
  { path: "/app/edge", name: "edge", interactions: [["documents view", clickText("Documents")], ["scenarios view", clickText("Scenarios")]] },
  { path: "/app/copy", name: "copy", interactions: [["copies tab", clickText("copies")], ["discover tab", clickText("Discover")]] },
  { path: "/app/algo", name: "algo", interactions: [["new strategy", clickText("New strategy")]] },
  { path: "/app/quant", name: "quant", interactions: [["factors tab", clickText("Factors")], ["risk tab", clickText("Risk")]] },
  { path: "/app/crm", name: "crm", interactions: [["contacts tab", clickText("Contacts")], ["pipeline tab", clickText("Pipeline")]] },
  { path: "/app/calendar", name: "calendar", interactions: [["day view", clickText("Day")], ["agenda view", clickText("Agenda")]] },
  { path: "/app/settings", name: "settings", interactions: [["AI model tab", clickText("AI model")], ["news tab", clickText("News and alerts")], ["plan tab", clickText("Plan")]] },
];
const only = arg("routes", "").split(",").filter(Boolean);
const routes = only.length ? ROUTES.filter((r) => only.includes(r.path) || only.includes(r.name)) : ROUTES;

const INIT = `
  window.__v = { lcp: 0, cls: 0, long: [], events: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.long.push([e.startTime, e.duration]); }).observe({ type: "longtask", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__v.events.push([e.name, e.startTime, e.duration]); }).observe({ type: "event", durationThreshold: 16, buffered: true });
`;

const browser = await chromium.launch({ executablePath: arg("chromium", "/opt/pw-browsers/chromium"), args: ["--no-sandbox"] });
const cookies = user.cookie.split("; ").map((c) => { const i = c.indexOf("="); return { name: c.slice(0, i), value: c.slice(i + 1), domain: "localhost", path: "/" }; });

async function measure(route, profile, interact) {
  const mobile = profile === "mobile";
  const ctx = await browser.newContext(mobile ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (mobile) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
  await page.addInitScript(INIT);
  const api = [];
  page.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) api.push({ t: Date.now(), path: u.pathname + u.search }); });
  const t0 = Date.now();
  await page.goto(base + route.path, { waitUntil: "load", timeout: 60_000 });
  await sleep(mobile ? 6000 : 4000);
  const load = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
    const js = performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script" || r.name.endsWith(".js")).reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0);
    const tbt = window.__v.long.reduce((s, [, d]) => s + Math.max(0, d - 50), 0);
    return { url: location.pathname, ttfb: n?.responseStart ?? null, fcp, lcp: window.__v.lcp || null, cls: window.__v.cls, tbt, longTasks: window.__v.long.length, maxLong: Math.max(0, ...window.__v.long.map(([, d]) => d)), jsKB: js / 1024, domNodes: document.getElementsByTagName("*").length };
  });
  const firstApi = api.filter((a) => a.t - t0 < (mobile ? 6000 : 4000) + 10_000).map((a) => a.path);
  const dupes = Object.entries(firstApi.reduce((m, p) => ({ ...m, [p]: (m[p] ?? 0) + 1 }), {})).filter(([, n]) => n > 1);
  const results = { ...load, apiCount: firstApi.length, api: firstApi, dupes };
  if (interact) {
    const inter = [];
    for (const [label, fn] of route.interactions) {
      const before = await page.evaluate(() => window.__v.events.length);
      const lt = await page.evaluate(() => window.__v.long.length);
      let ok = true;
      try { await fn(page, mobile); } catch { ok = false; }
      await sleep(900);
      const r = await page.evaluate(([b, l]) => ({ max: Math.max(0, ...window.__v.events.slice(b).map((e) => e[2])), n: window.__v.events.length - b, longAfter: window.__v.long.slice(l).reduce((s, [, d]) => s + d, 0) }), [before, lt]);
      inter.push({ label, ok, maxEventMs: r.max, events: r.n, longTaskMs: Math.round(r.longAfter) });
    }
    results.interactions = inter;
  }
  await ctx.close();
  return results;
}

const out = [];
for (const profile of profiles) {
  for (const route of routes) {
    const rs = [];
    for (let i = 0; i < runs; i++) rs.push(await measure(route, profile, i === runs - 1));
    const pick = (k) => median(rs.map((r) => r[k]));
    const row = { route: route.name, path: route.path.replace(/\/\d+$/, "/[id]"), profile, landedOn: rs[0].url, ttfb: pick("ttfb"), fcp: pick("fcp"), lcp: pick("lcp"), cls: pick("cls"), tbt: pick("tbt"), longTasks: pick("longTasks"), maxLong: pick("maxLong"), jsKB: pick("jsKB"), domNodes: pick("domNodes"), apiCount: pick("apiCount"), api: rs.at(-1).api, dupes: rs.at(-1).dupes, interactions: rs.at(-1).interactions };
    out.push(row);
    const f = (v) => (v === null ? "-" : Math.round(v));
    console.log(`${profile.padEnd(7)} ${row.route.padEnd(9)} FCP ${f(row.fcp)}  LCP ${f(row.lcp)}  CLS ${row.cls?.toFixed(3)}  TBT ${f(row.tbt)} (${row.longTasks} long, max ${f(row.maxLong)})  JS ${f(row.jsKB)}KB  api ${row.apiCount}${row.dupes.length ? ` dupes ${row.dupes.map(([p, n]) => `${p}x${n}`).join(",")}` : ""}${row.landedOn !== route.path ? ` (landed ${row.landedOn})` : ""}`);
    for (const it of row.interactions ?? []) console.log(`          - ${it.label.padEnd(16)} ${it.ok ? "" : "(failed) "}max event ${f(it.maxEventMs)} ms, long tasks ${it.longTaskMs} ms`);
  }
}
const file = arg("out", "");
if (file) writeFileSync(file, JSON.stringify(out, null, 2));
await browser.close();
