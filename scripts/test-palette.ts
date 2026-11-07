/** Command palette ranking (src/lib/palette.ts): pnpm exec tsx scripts/test-palette.ts */
import { asComparison, asTicker, pushRecent, rank, score, type PaletteItem } from "@/lib/palette";
import { findTools } from "@/lib/ai/catalog-tool";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const it = (id: string, label: string, group: PaletteItem["group"] = "Tools", keywords?: string): PaletteItem => ({ id, label, group, icon: "X", keywords });
const items = [
  it("a", "13-week cash flow engine"), it("b", "LBO model"), it("c", "Newsroom", "Go to"), it("d", "Style: Midnight", "Style", "theme modern dark navy"),
  it("e", "Settings: Security", "Settings", "two-factor 2fa authenticator"), it("f", "Cash"), it("g", "Accretion / dilution"),
];
const ids = (q: string) => rank(items, q).map((x) => x.id);

console.log("ranking");
ok("an exact label comes first", ids("cash")[0], "f");
ok("the start of a word matches across words", ids("cash flow"), ["a"]);
ok("a keyword finds a command it does not name", ids("2fa"), ["e"]);
ok("a theme is found by its description", ids("navy"), ["d"]);
ok("initials find a long name", ids("wcf"), ["a"]);
ok("…but scattered letters do not", ids("nvda"), []);
ok("case and accents do not matter", ids("NEWSRÖOM".replace("Ö", "O")), ["c"]);
ok("nothing matches nonsense", ids("zzqx"), []);
ok("no query keeps the given order", ids(""), items.map((x) => x.id));
ok("the prefix beats the substring", score(it("x", "Dilution"), "dil") > score(it("y", "Accretion / dilution"), "ilu"), true);
ok("the limit is kept", rank(items, "", 3).length, 3);

console.log("tickers");
ok("upper case reads as a ticker", asTicker("AAPL"), "AAPL");
ok("a share class reads as a ticker", asTicker("brk.b"), "BRK.B");
ok("lower case is upper-cased", asTicker("snow"), "SNOW");
ok("a common word in lower case is not one", asTicker("news"), null);
ok("…but typed in capitals it is", asTicker("NEWS"), "NEWS");
ok("a sentence is not a ticker", asTicker("what is the ev"), null);
ok("too long is not a ticker", asTicker("ABCDEFG"), null);

console.log("comparisons");
ok("vs", asComparison("snow vs mdb"), ["SNOW", "MDB"]);
ok("commas and and", asComparison("SNOW, MDB and DDOG"), ["SNOW", "MDB", "DDOG"]);
ok("ampersand and versus", [asComparison("nvda & amd"), asComparison("KO versus PEP")], [["NVDA", "AMD"], ["KO", "PEP"]]);
ok("one ticker, a sentence, or too many are not comparisons", [asComparison("snow"), asComparison("what is snow vs mdb growth"), asComparison("a,b,c,d,e")], [null, null, null]);
ok("the same ticker twice is not a comparison", asComparison("snow vs SNOW"), null);
ok("names with & are not comparisons", [asComparison("M&A"), asComparison("S&P"), asComparison("AT&T"), asComparison("R&D"), asComparison("P&L")], [null, null, null, null, null]);
ok("phrases are not comparisons", [asComparison("pros and cons"), asComparison("a, b")], [null, null]);
ok("one-letter tickers when vs is said", asComparison("F vs GM"), ["F", "GM"]);
console.log("recent");
ok("newest first, no repeats", pushRecent(["a", "b", "c"], "b"), ["b", "a", "c"]);
ok("at most the cap", pushRecent(["a", "b", "c"], "d", 3), ["d", "a", "b"]);

console.log("the chat's tool search");
ok("finds the merger model", findTools("merger accretion")[0]?.title.toLowerCase().includes("accretion"), true);
ok("finds by short name", findTools("lbo").every((t) => /lbo/i.test(`${t.title} ${t.what}`)), true);
ok("a long sentence still finds something", findTools("diligence checklist for a saas target").length > 0, true);
ok("links open the tool inside YouBank", /\/app\/tools\/[\w-]+$/.test(findTools("dcf")[0]?.link ?? ""), true);
ok("nonsense finds nothing", findTools("zzqx"), []);
ok("at most the limit", findTools("model", 3).length <= 3, true);

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
