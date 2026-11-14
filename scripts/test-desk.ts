/** Workspace setup and appearance (src/lib/desk/desk.ts): pnpm exec tsx scripts/test-desk.ts */
import { checklist, hasStyled, STEPS } from "@/lib/desk/checklist";
import { readSetupCode, setupCode } from "@/lib/desk/desk";
import { moveWidget, nudgeWidget, toggleWidget, isWide, asAccent, BUILTIN_LOOKS, lookCode, readLookCode, normalizePresets, PRESETS_MAX, type WidgetPref } from "@/lib/desk/desk";
import { ACCENTS, DEFAULT_LOOK, accentInk, lookAttrs, lookCookie, normalizeDesk, normalizeLook, readLookCookie, recommendDesk, widgetsFor, WIDGETS } from "@/lib/desk/desk";
import { featuresFor, normalizeNavPrefs } from "@/lib/nav";
import { sitePath } from "@/lib/desktop/feed";
import { INTERFACES, INTERFACE_META, chromeOf, homeOf, interfacesFor, isInterface, matchFeature, pinsInTopBar, suggestedInterface } from "@/lib/desk/interfaces";
import { ROLE_IDS } from "@/lib/roles";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const now = new Date("2026-11-04T08:00:00Z");

console.log("cleaning stored desk preferences");
const d = normalizeDesk(undefined, "banker");
ok("defaults to the Desk layout", d.layout, "desk");
ok("every widget appears exactly once", [...d.widgets.map((w) => w.id)].sort(), [...WIDGETS].sort());
const junk = normalizeDesk({ layout: "space", widgets: [{ id: "notes" }, { id: "bogus" }, { id: "notes", on: false }, "x"], hidden: ["crypto", "home", "settings", "nope"], notes: "x".repeat(5000), source: "hacker" }, "banker");
ok("an unknown layout falls back", junk.layout, "desk");
ok("unknown and repeated widgets drop out; the rest are kept, switched off", [junk.widgets[0], junk.widgets.length, junk.widgets.filter((w) => w.on).length], [{ id: "notes", on: true }, WIDGETS.length, 1]);
ok("Home and Settings can never be hidden; unknown features drop out", junk.hidden, ["crypto"]);
ok("notes are capped", junk.notes.length, 4000);
ok("an unknown source is 'auto'", junk.source, "auto");
ok("the private-markets widget is on for VC on the Desk layout", widgetsFor("desk", "vc").find((w) => w.id === "private")?.on, true);

console.log("setting it up from the survey");
const banker = recommendDesk("banker", "", now);
ok("a banker gets the Desk layout and the Relationships agent", [banker.desk.layout, banker.desk.hidden.includes("crm")], ["desk", false]);
ok("trading features are out of a banker's way", ["crypto", "algo", "copy", "quant"].every((id) => banker.desk.hidden.includes(id as never)), true);
ok("the reasons say what was hidden", banker.reasons.some((r) => r.includes("Crypto")), true);
const student = recommendDesk("student", "", now);
ok("a student gets the roomy Home layout", student.desk.layout, "home");
const crypto = recommendDesk("banker", "I cover crypto exchanges and want to backtest some signals", now);
ok("words switch features on", [crypto.desk.hidden.includes("crypto"), crypto.desk.hidden.includes("algo"), crypto.desk.hidden.includes("quant")], [false, false, false]);
ok("and say so", crypto.reasons.filter((r) => r.startsWith("You mentioned")).length, 2);
ok("a description counts as set up from your words", crypto.desk.source, "ai");
ok("a calm, minimal request picks Focus", recommendDesk("markets", "keep it minimal and clean please", now).desk.layout, "focus");
ok("a cozy request picks Home", recommendDesk("banker", "something cozy and warm", now).desk.layout, "home");
ok("Private markets is never switched on for a role without it", recommendDesk("banker", "startups and form d", now).desk.hidden.includes("vc"), false);
ok("…and does not appear among its features at all", featuresFor("banker").some((f) => f.id === "vc"), false);
ok("pinned features are never hidden ones", banker.pinned.some((id) => banker.desk.hidden.includes(id)), false);
{
  const r = recommendDesk("consultant", "crypto research and some algo trading", now);
  ok("named features are pinned right after Home", r.pinned.slice(0, 3), ["home", "crypto", "algo"]);
  ok("pins stay a short bar", r.pinned.length <= 6, true);
}
ok("the same input gives the same setup", JSON.stringify(recommendDesk("pe", "LBO models and outreach", now)), JSON.stringify(recommendDesk("pe", "LBO models and outreach", now)));

console.log("the navigation follows what is hidden");
ok("a hidden feature is not in the navigation", featuresFor("banker", ["studio"]).some((f) => f.id === "studio"), false);
ok("…nor pinned", normalizeNavPrefs({ pinned: ["home", "studio", "crm"] }, "banker", ["studio"]).pinned, ["home", "crm"]);
ok("…nor in the default pins", normalizeNavPrefs(undefined, "banker", ["studio"]).pinned.includes("studio"), false);

console.log("how it looks");
ok("unknown look values take the defaults", normalizeLook({ scale: 3, radius: "blob", font: "comic", accent: "#12345g", background: "lava", motion: "fast", contrast: "max" }), DEFAULT_LOOK);
ok("the scale is read from a cookie string", normalizeLook({ scale: "1.25" }).scale, 1.25);
const look = normalizeLook({ scale: 1.1, radius: "round", font: "serif", accent: "#a78bfa", background: "mesh", motion: "reduced", contrast: "high" });
ok("cookie round trip", readLookCookie(lookCookie(look)), look);
ok("a default look writes an empty cookie", decodeURIComponent(lookCookie(DEFAULT_LOOK)), "{}");
ok("a broken cookie is the default", readLookCookie("%7Bnot-json"), DEFAULT_LOOK);
const a = lookAttrs(look);
ok("attributes on <html>", a.attrs, { "data-font": "serif", "data-bg": "mesh", "data-motion": "reduced", "data-contrast": "high" });
ok("variables on <html>", [a.vars["--ui-scale"], a.vars["--radius"], a.vars["--accent"], a.vars["--accent-soft"]], ["1.1", "16px", "#a78bfa", "#a78bfa24"]);
ok("the default look sets nothing", lookAttrs(DEFAULT_LOOK), { attrs: {}, vars: {} });
ok("text on a light accent is dark, on a dark one light", [accentInk("#facc15"), accentInk("#4f8cff")], ["#0a0c0f", "#ffffff"]);
ok("every accent swatch is a colour or 'theme'", ACCENTS.every((x) => x === "theme" || /^#[0-9a-f]{6}$/.test(x)), true);

console.log("arranging Home");
{
  const L: WidgetPref[] = [{ id: "brief", on: true }, { id: "agenda", on: true }, { id: "notes", on: false }, { id: "runs", on: true }];
  const ids = (l: WidgetPref[]) => l.map((w) => `${w.id}${w.on ? "" : "-"}`);
  ok("dragging down lands after the target", ids(moveWidget(L, "brief", "agenda")), ["agenda", "brief", "notes-", "runs"]);
  ok("dragging up lands before it", ids(moveWidget(L, "runs", "agenda")), ["brief", "runs", "agenda", "notes-"]);
  ok("an unknown id changes nothing", moveWidget(L, "brief", "movers"), L);
  ok("the arrows skip widgets that are off", ids(nudgeWidget(L, "runs", -1)), ["brief", "runs", "agenda", "notes-"]);
  ok("…and stop at the ends", nudgeWidget(L, "brief", -1), L);
  const D: WidgetPref[] = [{ id: "brief", on: true }, { id: "movers", on: true }, { id: "ask", on: true }, { id: "runs", on: true }];
  const sameColumn = (w: WidgetPref) => isWide(w) === isWide({ id: "ask" });
  ok("on Desk the arrows stay in the column", ids(nudgeWidget(D, "ask", -1, sameColumn)), ["brief", "movers", "ask", "runs"]);
  ok("…and move within it", ids(nudgeWidget(D, "runs", -1, sameColumn)), ["brief", "movers", "runs", "ask"]);
  ok("putting one on adds it after the last shown", ids(toggleWidget(L, "notes", true)), ["brief", "agenda", "runs", "notes"]);
  ok("taking one off keeps its place", ids(toggleWidget(L, "agenda", false)), ["brief", "agenda-", "notes-", "runs"]);
  ok("width follows the default until the person sets it", [isWide({ id: "brief" }), isWide({ id: "notes" }), isWide({ id: "brief", size: "narrow" }), isWide({ id: "notes", size: "wide" })], [true, false, false, true]);
  const n = normalizeDesk({ widgets: [{ id: "notes", on: true, size: "wide" }, { id: "brief", size: "huge" }] }, "banker");
  ok("a stored width is kept; a bad one dropped", [n.widgets[0], n.widgets[1]], [{ id: "notes", on: true, size: "wide" }, { id: "brief", on: true }]);
}

console.log("any accent, saved looks and look codes");
ok("any six-digit hex is an accent, lower-cased", [asAccent("#FF7A59"), asAccent("theme")], ["#ff7a59", "theme"]);
ok("nothing else reaches a style attribute", [asAccent("#fff"), asAccent("red"), asAccent("#ff7a59;background:url(x)"), asAccent(42)], [null, null, null, null]);
ok("a custom accent survives normalizing", normalizeLook({ accent: "#123ABC" }).accent, "#123abc");
ok("…and becomes the accent variable", lookAttrs(normalizeLook({ accent: "#123abc" })).vars["--accent"], "#123abc");
for (const p of BUILTIN_LOOKS) ok(`built-in look “${p.name}” is valid`, normalizePresets([p])[0], p);
const code = lookCode(BUILTIN_LOOKS[3]);
ok("a code starts yb1. and is URL-safe", /^yb1\.[A-Za-z0-9_-]+$/.test(code), true);
ok("a code reads back to the same look", readLookCode(code), BUILTIN_LOOKS[3]);
ok("a name with any characters round-trips", readLookCode(lookCode({ ...BUILTIN_LOOKS[0], name: "Café · 夜" }))?.name, "Café · 夜");
ok("junk is not a code", [readLookCode("hello"), readLookCode("yb1.!!!!"), readLookCode("yb1.e30")], [null, null, null]);
ok("a code with an unknown theme is refused", readLookCode(`yb1.${Buffer.from(JSON.stringify({ n: "x", t: "nope", l: {} })).toString("base64url")}`), null);
ok("a code cannot smuggle a bad accent", readLookCode(`yb1.${Buffer.from(JSON.stringify({ n: "x", t: "paper", l: { accent: "url(x)" } })).toString("base64url")}`)?.look.accent, "theme");
const many = Array.from({ length: 20 }, (_, i) => ({ name: `L${i}`, theme: "paper", look: {} }));
ok("saved looks are capped, newest kept", normalizePresets(many).map((p) => p.name).slice(-1)[0], "L19");
ok("…at the cap", normalizePresets(many).length, PRESETS_MAX);
ok("one look per name, the later wins", normalizePresets([{ name: "A", theme: "paper", look: {} }, { name: "a", theme: "ocean", look: {} }]).map((p) => p.theme), ["ocean"]);
ok("a look without a name is dropped", normalizePresets([{ name: "  ", theme: "paper" }, "x", null]), []);

console.log("getting started");
{
  const none = { asked: false, ranTool: false, mail: false, calendar: false, twoFactor: false, styled: false, installed: false };
  ok("nothing done: the first step is next", [checklist(none).done, checklist(none).next?.id], [0, "asked"]);
  ok("the next step skips what is done", checklist({ ...none, asked: true, ranTool: true }).next?.id, "mail");
  ok("all done: no next step", checklist(Object.fromEntries(STEPS.map((s) => [s.id, true])) as typeof none).next, null);
  ok("a fund (markets, PE) starts with the Book, a forecast, a reason and an AI app; other roles do not see them", [checklist(none, "markets").steps.slice(0, 4).map((x) => x.id), checklist(none, "pe").total, checklist(none, "banker").steps.some((x) => x.id === "book"), checklist(none).total], [["book", "forecast", "reason", "aiApp"], STEPS.length + 4, false, STEPS.length]);
  ok("for a fund, the Book is next until it holds a position, then a forecast, then a reason, then the AI app", [checklist(none, "markets").next?.id, checklist({ ...none, book: true }, "markets").next?.id, checklist({ ...none, book: true, forecast: true }, "markets").next?.id, checklist({ ...none, book: true, forecast: true, reason: true }, "markets").next?.id], ["book", "forecast", "reason", "aiApp"]);
  ok("every step links inside the app", STEPS.every((s) => s.href.startsWith("/") && !s.href.startsWith("//")), true);
  ok("a fresh profile has not styled anything", hasStyled({ nav: { pinned: [] }, desk: { source: "auto" } }), false);
  ok("a theme, a look, an arranged desk or a saved look counts", [hasStyled({ theme: "paper" }), hasStyled({ look: { font: "mono" } }), hasStyled({ desk: { source: "you" } }), hasStyled({ looks: [{}] })], [true, true, true, true]);
  ok("new desks start with it on, first", widgetsFor("home")[0], { id: "checklist", on: true });
  ok("existing desks get it switched off, not pushed on them", normalizeDesk({ widgets: [{ id: "brief", on: true }] }, "banker").widgets.find((w) => w.id === "checklist"), { id: "checklist", on: false });
}

console.log("sharing a setup");
{
  const desk = normalizeDesk({ layout: "home", widgets: [{ id: "agenda", on: true, size: "wide" }, { id: "notes", on: true }, { id: "brief", on: false }], hidden: ["crypto", "algo"], notes: "secret notes" }, "banker");
  const code = setupCode({ desk, theme: "ocean", look: { ...DEFAULT_LOOK, wallpaper: "dusk", accent: "#123abc" } });
  const back = readSetupCode(code, "banker")!;
  ok("a setup code is URL-safe and starts yb2.", /^yb2\.[A-Za-z0-9_-]+$/.test(code), true);
  ok("it never carries the notes", code.includes("secret") || JSON.stringify(back).includes("secret"), false);
  ok("layout, shown widgets in order with widths, hidden features, style and look come back", [back.desk.layout, back.desk.widgets.filter((w) => w.on), back.desk.hidden, back.theme, back.look.wallpaper, back.look.accent], ["home", [{ id: "agenda", on: true, size: "wide" }, { id: "notes", on: true }], ["crypto", "algo"], "ocean", "dusk", "#123abc"]);
  ok("widgets it does not list are off", back.desk.widgets.find((w) => w.id === "brief")?.on, false);
  ok("junk, a look code or a bad style is refused", [readSetupCode("nope", "banker"), readSetupCode("yb1.abcd", "banker"), readSetupCode(`yb2.${Buffer.from(JSON.stringify({ l: "home", w: [], t: "nope" })).toString("base64url")}`, "banker")], [null, null, null]);
  ok("a feature the role does not have stays out", readSetupCode(`yb2.${Buffer.from(JSON.stringify({ l: "desk", w: ["brief"], h: ["home", "bogus"], t: "paper" })).toString("base64url")}`, "banker")?.desk.hidden, []);
}
ok("desktop notifications: a full link (the Book's alerts) opens its own page; anything off-site falls back", [sitePath("https://youbank.app/report/week", "/app/news"), sitePath("/app/book?x=1", "/f"), sitePath("//evil.com/x", "/f"), sitePath("https://a.com//evil", "/f"), sitePath("javascript:alert(1)", "/f")], ["/report/week", "/app/book?x=1", "/f", "/f", "/f"]);
console.log("interfaces");
{
  const others = INTERFACES.filter((i) => i !== "classic");
  ok("the default look is the Classic interface and sets no data-ui", [DEFAULT_LOOK.ui, lookAttrs(DEFAULT_LOOK).attrs["data-ui"]], ["classic", undefined]);
  ok("an unknown interface falls back to Classic", normalizeLook({ ui: "vaporwave" }).ui, "classic");
  ok("twelve interfaces besides Classic, Bare, Spectacle, Prompt and Canvas among them", [others.length, ["bare", "spectacle", "prompt", "canvas"].every((id) => isInterface(id))], [12, true]);
  for (const id of others) ok(`${id}: sets data-ui and survives the cookie`, [lookAttrs(normalizeLook({ ui: id })).attrs["data-ui"], readLookCookie(lookCookie(normalizeLook({ ui: id }))).ui], [id, id]);
  ok("isInterface accepts only the list", [isInterface("zen"), isInterface("ZEN"), isInterface(3)], [true, false, false]);
  ok("every interface has a name, tagline, suits line and signature", INTERFACES.every((id) => INTERFACE_META[id].name && INTERFACE_META[id].tagline.length > 20 && INTERFACE_META[id].suits && INTERFACE_META[id].signature.length > 10), true);
  ok("navigation moves: twelve different places among thirteen interfaces", new Set(INTERFACES.map((id) => chromeOf(id).nav)).size, 12);
  ok("no two interfaces share the same frame", new Set(INTERFACES.map((id) => JSON.stringify(chromeOf(id)))).size, INTERFACES.length);
  ok("every interface composes Home its own way", new Set(INTERFACES.map(homeOf)).size, INTERFACES.length);
  ok("every interface moves its own way", new Set(INTERFACES.map((id) => INTERFACE_META[id].motion)).size, INTERFACES.length);
  ok("no two interfaces share colours and type", new Set(INTERFACES.map((id) => JSON.stringify([INTERFACE_META[id].preview.bg, INTERFACE_META[id].preview.font, INTERFACE_META[id].preview.accent]))).size, INTERFACES.length);
  ok("Classic keeps its top bar and its Focus/Home/Desk Home", [chromeOf("classic"), homeOf("classic"), INTERFACE_META.classic.motion], [{ nav: "topbar", dock: false, statusStrip: false, editionLine: false, centered: false, frame: "none" }, "desk", "classic"]);
  ok("pins stay in the top bar only where the top bar is the navigation", INTERFACES.filter(pinsInTopBar), ["classic", "bare", "broadsheet", "cockpit", "glass"]);
  ok("a markets person is offered Cockpit, an accountant Ledger, a student Bento", [suggestedInterface("markets"), suggestedInterface("accountant"), suggestedInterface("student")], ["cockpit", "ledger", "bento"]);
  for (const r of ROLE_IDS) {
    const list = interfacesFor(r).map((m) => m.id);
    ok(`${r}: all thirteen, Classic first, the suggested one second`, [list.length, new Set(list).size, list[0], suggestedInterface(r) ? list[1] === suggestedInterface(r) : true], [13, 13, "classic", true]);
  }
  // Prompt's composer: a page's name goes there, anything else is asked.
  const fs = featuresFor("markets");
  ok("the composer goes to a page by name, prefix or part", [matchFeature("book", fs)?.id, matchFeature("/news", fs)?.id, matchFeature("go to terminal", fs)?.id, matchFeature("room", fs)?.id], ["book", "news", "terminal", "news"]);
  ok("…and asks anything else", [matchFeature("What changed in NVDA's 10-Q?", fs), matchFeature("x", fs), matchFeature("", fs)], [null, null, null]);

  const dir = "src/app/interfaces";
  const files = readdirSync(dir).filter((f) => f.endsWith(".css"));
  const css = files.map((f) => readFileSync(join(dir, f), "utf8")).join("\n");
  const globals = readFileSync("src/app/globals.css", "utf8");
  ok("every interface stylesheet is imported", files.every((f) => globals.includes(`@import "./interfaces/${f}";`)), true);
  for (const id of others) ok(`${id}: its tokens are scoped to the app frame (the public site never changes)`, css.includes(`html[data-ui="${id}"]:has(.app-frame) {`), true);
  for (const id of others) ok(`${id}: has its own stylesheet`, files.includes(`${id}.css`), true);
  const loose = css.split("\n").filter((l) => /^html(\[data-ui|:is\(\[data-ui)/.test(l) && !l.includes(".app-frame") && !/ \.yb-[a-z-]+/.test(l));
  ok("no interface rule reaches outside the app frame", loose, []);
  // Each Home composition has its own lazily loaded component, registered with Home.
  const dash = readFileSync("src/components/workspace/HomeDashboard.tsx", "utf8");
  const homes = readdirSync("src/components/workspace/interfaces/homes");
  for (const id of others) {
    const comp = homeOf(id);
    const file = `${comp[0].toUpperCase()}${comp.slice(1).replace("page", "Page")}Home.tsx`;
    ok(`${id}: Home is its own component (${file}), loaded on demand`, [homes.includes(file), dash.includes(`${comp}: dynamic(() => import("./interfaces/homes/${file.replace(".tsx", "")}"))`)], [true, true]);
  }
  // Settings is the only place to choose one: never the landing page or the command palette.
  const walk = (d: string): string[] => readdirSync(d).flatMap((f) => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.(tsx?|css)$/.test(f) ? [p] : []; });
  const outside = [...walk("src/components/marketing"), "src/components/workspace/CommandPalette.tsx", "src/components/workspace/PalettePanel.tsx", "src/app/page.tsx"];
  const names = new RegExp(`\\b(${others.filter((id) => !["glass", "ledger", "canvas", "prompt", "bare", "zen"].includes(id)).map((id) => INTERFACE_META[id].name).join("|")})\\b`);
  const leaks = outside.filter((f) => { const t = readFileSync(f, "utf8"); return /lib\/desk\/interfaces|data-ui|InterfacePicker|\bui:\s*["']|look\.ui/.test(t) || names.test(t); });
  ok("no interface is advertised on the landing page or in the command palette", leaks, []);
  ok("the look code keeps the interface", readLookCode(lookCode({ name: "x", theme: "terminal", look: normalizeLook({ ui: "spectacle" }) }))?.look.ui, "spectacle");
  ok("setup codes carry the interface", readSetupCode(setupCode({ desk: normalizeDesk(undefined, "pe"), theme: "paper", look: normalizeLook({ ui: "canvas" }) }), "pe")?.look.ui, "canvas");
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
