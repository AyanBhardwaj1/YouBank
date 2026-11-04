/** The personal watchlist (src/lib/desk/watchlist.ts): pnpm exec tsx scripts/test-watchlist.ts */
import { WATCHLIST_MAX, addTickers, asTicker, moveTicker, normalizeWatchlist, parseTickers, removeTicker } from "@/lib/desk/watchlist";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
console.log("tickers");
ok("upper-cased, $ dropped, class suffix kept", [asTicker(" aapl "), asTicker("$tsla"), asTicker("brk.b"), asTicker("RDS-A")], ["AAPL", "TSLA", "BRK.B", "RDS-A"]);
ok("not tickers", [asTicker(""), asTicker("1ABC"), asTicker("AB CD"), asTicker("<script>"), asTicker("A.B.C"), asTicker(7)], [null, null, null, null, null, null]);
console.log("stored lists");
ok("no list of their own: null (the role's is used)", [normalizeWatchlist(undefined), normalizeWatchlist("AAPL")], [null, null]);
ok("an empty list is theirs, and empty", normalizeWatchlist([]), []);
ok("cleaned, once each, in order", normalizeWatchlist(["msft", "AAPL", "msft", "bad name", 3]), ["MSFT", "AAPL"]);
ok("capped", normalizeWatchlist(Array.from({ length: 50 }, (_, i) => `T${i}`))?.length, WATCHLIST_MAX);
console.log("editing");
ok("several typed together", parseTickers("aapl, msft nvda;$TSLA aapl ???"), { tickers: ["AAPL", "MSFT", "NVDA", "TSLA"], rejected: ["???"] });
ok("adding skips what is there", addTickers(["AAPL"], ["MSFT", "AAPL"]), ["AAPL", "MSFT"]);
ok("adding stops at the cap", addTickers(Array.from({ length: WATCHLIST_MAX }, (_, i) => `T${i}`), ["NEW"]).includes("NEW"), false);
ok("removing", removeTicker(["AAPL", "MSFT"], "AAPL"), ["MSFT"]);
ok("moving", [moveTicker(["A", "B", "C"], "B", -1), moveTicker(["A", "B", "C"], "C", 1)], [["B", "A", "C"], ["A", "B", "C"]]);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
