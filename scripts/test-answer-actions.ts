/** Actions on a finished AI answer (src/lib/ai/answer-actions.ts): pnpm exec tsx scripts/test-answer-actions.ts */
import { answerFileName, answerMarkdown, firstTable, noteEntry, toTsv } from "@/lib/ai/answer-actions";

let pass = 0, fail = 0;
const ok = (label: string, got: unknown, want: unknown) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n       got  ${g}\n       want ${w}`); }
};
const src = [{ id: "S1", label: "SNOW 10-K", url: "https://sec.gov/a" }, { id: "S2", label: "Price", url: "https://x/b" }, { id: "S3", label: "Unused", url: "https://x/c" }];
const answer = "Revenue was **$3,626M** [S1] and EV/Rev 14.2x [S1, S2].\n\n| Ticker | EV/Rev | Growth |\n|---|---:|:--|\n| SNOW | **14.2x** [S2] | 29% |\n| MDB | 9.1x | 19%\t|\n\nDone.";

console.log("markdown with sources");
const md = answerMarkdown(answer, src, "How is SNOW valued?");
ok("keeps the question and the answer", md.startsWith("**Q:** How is SNOW valued?\n\nRevenue was"), true);
ok("lists only the sources it cites", [md.includes("[S1] SNOW 10-K: https://sec.gov/a"), md.includes("[S2] Price"), md.includes("Unused")], [true, true, false]);
ok("with no citation marks it lists them all", answerMarkdown("No marks.", src).includes("Unused"), true);
ok("no sources, no list", answerMarkdown("Plain.", []), "Plain.\n");

console.log("tables");
const t = firstTable(answer);
ok("finds the table, header first", t?.map((r) => r[0]), ["Ticker", "SNOW", "MDB"]);
ok("alignment rules are not rows", t?.length, 3);
ok("pastes into cells without emphasis or citations", toTsv(t!), "Ticker\tEV/Rev\tGrowth\nSNOW\t14.2x\t29%\nMDB\t9.1x\t19%");
ok("no table, null", firstTable("Just text | with a pipe."), null);
ok("a one-column table is not a table", firstTable("| a |\n|---|\n| b |"), null);

console.log("notes and files");
const at = new Date("2026-11-04T09:00:00Z");
const n = noteEntry("How is SNOW valued?", answer, at, 120);
ok("a note starts with the date and question", n.startsWith("— Nov 4: How is SNOW valued?\n"), true);
ok("…fits its room", n.length <= 120, true);
ok("…without citation marks or table pipes", /\[S\d|\|/.test(n), false);
ok("file name from the question", answerFileName("How is SNOW valued?", at), "youbank-how-is-snow-valued-2026-11-04.md");
ok("an empty question still names the file", answerFileName("???", at), "youbank-answer-2026-11-04.md");

console.log(`\n${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
