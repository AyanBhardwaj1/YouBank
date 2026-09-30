/**
 * Core Web Vitals for the main /app pages, signed in, from a headless Chrome against a LOCAL build: time
 * to first byte, first and largest contentful paint, layout shift, and the JavaScript transferred. Each
 * page loads three times with the cache disabled (a first visit); the median is reported. Interaction
 * latency (INP) needs a person clicking, so it is not measured here.
 *
 *   node scripts/load/vitals.mjs --base http://localhost:3999 --users /tmp/users.json --out /tmp/vitals.json
 */
import { spawn } from "node:child_process";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { guardTarget, parseArgs } from "./common.mjs";

const args = parseArgs(process.argv.slice(2), { base: "http://localhost:3999", users: "", out: "", runs: "3", chrome: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" });
const base = guardTarget(args.base);
const user = JSON.parse(readFileSync(args.users, "utf8")).find((u) => u.docId);
const pages = ["/app", "/app/news", "/app/terminal", `/app/studio/${user.docId}`];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const port = 9300 + Math.floor(Math.random() * 500);
const profile = `/tmp/vitals-profile-${port}`;
const chrome = spawn(args.chrome, ["--headless=new", "--disable-gpu", `--remote-debugging-port=${port}`, "--window-size=1440,900", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
const done = () => { try { chrome.kill("SIGKILL"); } catch { /* gone */ } setTimeout(() => { try { rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ } }, 300); };
process.on("exit", done);

let target;
for (let i = 0; i < 50 && !target; i++) { await sleep(200); try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === "page"); } catch { /* not up yet */ } }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener("open", r));
let id = 0;
const pending = new Map();
const waiters = [];
ws.addEventListener("message", (m) => {
  const msg = JSON.parse(m.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method) for (const w of [...waiters]) if (w.method === msg.method) { waiters.splice(waiters.indexOf(w), 1); w.resolve(msg); }
});
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const once = (method, ms = 60_000) => new Promise((resolve) => { waiters.push({ method, resolve }); setTimeout(() => resolve(null), ms); });
const evaluate = async (expression) => (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result?.result?.value;

await send("Page.enable");
await send("Network.enable");
await send("Network.setCacheDisabled", { cacheDisabled: true });
await send("Network.setExtraHTTPHeaders", { headers: { Cookie: user.cookie } });
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  window.__v = { lcp: 0, cls: 0 };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__v.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__v.cls += e.value; }).observe({ type: "layout-shift", buffered: true });
` });

const median = (xs) => { const s = xs.filter((x) => x !== null && x !== undefined).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const results = [];
for (const path of pages) {
  const runs = [];
  for (let i = 0; i < Number(args.runs); i++) {
    const loaded = once("Page.loadEventFired");
    await send("Page.navigate", { url: `${base}${path}` });
    await loaded;
    await sleep(4_000); // let late paints and shifts land
    runs.push(await evaluate(`(() => {
      const n = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0]?.startTime ?? null;
      const js = performance.getEntriesByType("resource").filter((r) => r.initiatorType === "script").reduce((s, r) => s + (r.transferSize || r.encodedBodySize || 0), 0);
      return { url: location.pathname, ttfb: n ? n.responseStart : null, fcp, lcp: window.__v.lcp || null, cls: window.__v.cls, jsKB: js / 1024 };
    })()`));
  }
  const pick = (k) => median(runs.map((r) => r?.[k]));
  const row = { page: path.replace(/\/\d+$/, "/[id]"), landedOn: runs[0]?.url, ttfb: pick("ttfb"), fcp: pick("fcp"), lcp: pick("lcp"), cls: pick("cls"), jsKB: pick("jsKB") };
  results.push(row);
  console.log(`${row.page.padEnd(20)} TTFB ${Math.round(row.ttfb)} ms  FCP ${Math.round(row.fcp)} ms  LCP ${Math.round(row.lcp)} ms  CLS ${row.cls?.toFixed(3)}  JS ${Math.round(row.jsKB)} KB${row.landedOn !== path ? `  (landed on ${row.landedOn})` : ""}`);
}
if (args.out) writeFileSync(args.out, JSON.stringify(results, null, 2));
ws.close();
done();
process.exit(0);
