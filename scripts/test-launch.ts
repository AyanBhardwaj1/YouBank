/**
 * Checks for the launch-readiness limits: AI spend gating and cost estimates. No network, no database.
 *   pnpm exec tsx scripts/test-launch.ts
 */
import { blockedAt } from "@/lib/ai/limits";
import { costOf } from "@/lib/ai/pricing";

let pass = 0, fail = 0;
const check = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail !== undefined ? `  -> ${JSON.stringify(detail)}` : ""}`); }
};

async function main() {
  console.log("AI spend limits");
  const base = { disabled: false, everyone: 10, mine: 1, pending: 0, globalCap: 200, userCap: 5 };
  check("under both caps runs", blockedAt(base) === null);
  check("the off switch stops everything", /paused/.test(blockedAt({ ...base, disabled: true }) ?? ""));
  check("a person at their cap stops", /today's AI limit/.test(blockedAt({ ...base, mine: 5 }) ?? ""));
  check("a run's pending cost counts toward the person's cap", /today's AI limit/.test(blockedAt({ ...base, mine: 4, pending: 1.2 }) ?? ""));
  check("everyone at the global cap stops", /come back at midnight/.test(blockedAt({ ...base, everyone: 200 }) ?? ""));
  check("background work (no person) ignores personal caps", blockedAt({ ...base, mine: null, everyone: 50 }) === null);
  check("background work still stops at the global cap", blockedAt({ ...base, mine: null, everyone: 199.5, pending: 1 }) !== null);
  check("a zero cap blocks", blockedAt({ ...base, userCap: 0, mine: 0 }) !== null);

  console.log("cost estimates");
  const u = { input: 1_000_000, cached: 0, cacheWrite: 0, output: 1_000_000, reasoning: 0 };
  check("a listed model uses its list price", costOf("gpt-6-astra", u) === 60, costOf("gpt-6-astra", u));
  check("an unlisted catalogue model is estimated, not free", (costOf("gpt-5.5-pro", u) ?? 0) >= 60, costOf("gpt-5.5-pro", u));
  check("an unlisted cheap model gets a cheap estimate", (costOf("gpt-4.1-mini", u) ?? 0) > 0 && (costOf("gpt-4.1-mini", u) ?? 99) <= 10, costOf("gpt-4.1-mini", u));
  check("a model outside the catalogue stays uncosted", costOf("text-embedding-3-small", u) === null);

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
