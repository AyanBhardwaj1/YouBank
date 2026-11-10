/** "Jump back in" labels (src/lib/client/recent.ts): pnpm exec tsx scripts/test-recent.ts */
import { pushVisit, visitFor, RECENT_MAX } from "@/lib/client/recent";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const F = [{ href: "/app/terminal", label: "Terminal", icon: "Terminal" }, { href: "/app/crm", label: "Relationships", icon: "Network" }, { href: "/app/news", label: "Newsroom", icon: "Newspaper" }, { href: "/app/studio", label: "Studio", icon: "FileText" }];
const T = [{ id: "dcf", title: "DCF valuation", icon: "Calculator" }];
const v = (p: string, s = "") => { const x = visitFor(p, s, F, T, 1); return x && [x.href, x.label]; };
ok("a tool by its title", v("/app/tools/dcf"), ["/app/tools/dcf", "DCF valuation"]);
ok("an unknown tool is skipped", v("/app/tools/nope"), null);
ok("a ticker in the terminal", v("/app/terminal", "?ticker=snow&fn=COMPS"), ["/app/terminal?ticker=SNOW", "SNOW in the terminal"]);
ok("a feature tab", v("/app/crm", "?tab=pipeline&x=1"), ["/app/crm?tab=pipeline", "Relationships · pipeline"]);
ok("a page inside a feature", v("/app/studio/42"), ["/app/studio/42", "Studio · 42"]);
ok("Home, settings and outside pages are not kept", [v("/app"), v("/app/settings", "?tab=style"), v("/pricing")], [null, null, null]);
ok("a bad ticker falls back to the feature", v("/app/terminal", "?ticker=<x>"), ["/app/terminal", "Terminal"]);
const list = Array.from({ length: 20 }, (_, i) => ({ href: `/app/x${i}`, label: "x", icon: "x", at: i }));
ok("newest first, once each, capped", [pushVisit(list, { ...list[3], at: 99 })[0].href, pushVisit(list, { ...list[3], at: 99 }).filter((x) => x.href === "/app/x3").length, pushVisit(list, list[0]).length], ["/app/x3", 1, RECENT_MAX]);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
