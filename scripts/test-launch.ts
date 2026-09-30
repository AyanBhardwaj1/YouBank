/**
 * Checks for the launch-readiness limits: AI spend gating and cost estimates. No network, no database.
 *   pnpm exec tsx scripts/test-launch.ts
 */
import { modelAllowed } from "@/lib/ai/config";
import { blockedAt, fitMessages } from "@/lib/ai/limits";
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

  console.log("chat input");
  type M = { role: "user" | "assistant"; content: string };
  const msg = (role: M["role"], n: number, c = "x"): M => ({ role, content: c.repeat(n) });
  const small: M[] = [msg("user", 10), msg("assistant", 10), msg("user", 10)];
  check("a short conversation is unchanged", JSON.stringify(fitMessages(small)) === JSON.stringify(small));
  const long = fitMessages([msg("user", 50), msg("assistant", 30_000), msg("user", 10)], 20_000, 100_000);
  check("an old long message is capped", long[1].content.length < 20_100 && long[1].content.endsWith("[…cut for length]"), long[1].content.length);
  const many = fitMessages(Array.from({ length: 12 }, (_, i) => msg(i % 2 ? "assistant" : "user", 15_000, String(i % 10))).concat([msg("user", 5)]), 20_000, 100_000);
  const total = many.reduce((n, m) => n + m.content.length, 0);
  check("the history fits the total", total <= 100_000, total);
  check("the newest message is kept", many[many.length - 1].content === "xxxxx");
  check("the history starts with a person's message", many[0].role === "user", many.map((m) => m.role));
  check("an empty history stays empty", fitMessages([]).length === 0);

  console.log("allowed models");
  const was = process.env.AI_ALLOWED_MODELS;
  delete process.env.AI_ALLOWED_MODELS;
  check("no list allows every model", modelAllowed("gpt-5.5-pro"));
  process.env.AI_ALLOWED_MODELS = "gpt-5.6-terra, gpt-5.6-luna";
  check("a listed model is allowed", modelAllowed("gpt-5.6-luna"));
  check("an unlisted model is not", !modelAllowed("gpt-5.5-pro"));
  if (was === undefined) delete process.env.AI_ALLOWED_MODELS; else process.env.AI_ALLOWED_MODELS = was;

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
