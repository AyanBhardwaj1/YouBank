/**
 * Account recovery and the automatic migrations: the pure parts.
 *   pnpm exec tsx scripts/test-recovery.ts
 * The flow end to end (sign up, key, reset, the old key refused, the limit) runs against a local server.
 */
import { spawnSync } from "node:child_process";
import { hashKey, newRecoveryKey, normalizeKey, sameHash } from "@/lib/auth/recovery";
import { databaseUrl, inTransaction, statementsOf } from "@/lib/db/automigrate";
import { BASE_SQL, MIGRATION_SQL } from "@/lib/db/migrations.gen";
import { checkEnv } from "@/lib/env";
import { MIGRATIONS } from "@/lib/setup";

let pass = 0, fail = 0;
const ok = (label: string, cond: boolean, detail?: unknown) => {
  if (cond) { pass++; console.log(`  ok   ${label}`); } else { fail++; console.log(`  FAIL ${label}`, detail ?? ""); }
};

console.log("recovery keys");
const k = newRecoveryKey();
ok("a key is five groups of four unambiguous characters", /^[A-HJKMNP-TW-Z2-9]{4}(-[A-HJKMNP-TW-Z2-9]{4}){4}$/.test(k), k);
ok("keys differ", new Set(Array.from({ length: 200 }, () => newRecoveryKey())).size === 200);
ok("case, spaces and dashes do not matter", normalizeKey(k.toLowerCase().replace(/-/g, " ")) === normalizeKey(k));
ok("the hash is stable and depends on the secret", hashKey(k, "a") === hashKey(k.toLowerCase(), "a") && hashKey(k, "a") !== hashKey(k, "b"));
ok("the stored form is not the key", !hashKey(k, "a").includes(normalizeKey(k)));
ok("hashes compare in constant time and refuse different lengths or empties", sameHash(hashKey(k, "a"), hashKey(k, "a")) && !sameHash(hashKey(k, "a"), hashKey(newRecoveryKey(), "a")) && !sameHash("", "") && !sameHash("ab", "abcd"));
let threw = false; try { hashKey(k, ""); } catch { threw = true; }
ok("no secret, no hash", threw);

console.log("automatic migrations");
ok("the embedded migrations match drizzle/ (run scripts/gen-migrations.mts after adding one)", spawnSync("npx", ["tsx", "scripts/gen-migrations.mts", "--check"], { encoding: "utf8" }).status === 0);
const names = MIGRATION_SQL.map(([n]) => n);
ok("every migration setup.ts checks is embedded, and every embedded one is checked", MIGRATIONS.every(([n]) => names.includes(n)) && names.every((n) => MIGRATIONS.some(([m]) => m === n)), names.filter((n) => !MIGRATIONS.some(([m]) => m === n)));
ok("statements: comments dropped, split on semicolons", JSON.stringify(statementsOf("-- a note\nCREATE TABLE x (a int);\n\n-- more\nCREATE INDEX i ON x (a);\n")) === JSON.stringify(["CREATE TABLE x (a int)", "CREATE INDEX i ON x (a)"]));
ok("inside the transaction an index is built without CONCURRENTLY", inTransaction("CREATE INDEX CONCURRENTLY IF NOT EXISTS i ON x (a)") === "CREATE INDEX IF NOT EXISTS i ON x (a)");
ok("an empty database gets the whole schema, sign-in's tables included", ["auth_users", "auth_sessions", "auth_accounts", "auth_verifications", "profiles", "kv_cache", "auth_recovery", "app_secrets"].every((t) => BASE_SQL.includes(`CREATE TABLE "${t}"`)));
ok("the database address is found under the names integrations use", databaseUrl({ POSTGRES_URL: "postgres://a" }) === "postgres://a" && databaseUrl({ DATABASE_URL: "postgres://b", POSTGRES_URL: "postgres://a" }) === "postgres://b" && databaseUrl({}) === "");
ok("the environment check counts POSTGRES_URL as the database", !checkEnv({ POSTGRES_URL: "postgres://a", BETTER_AUTH_SECRET: "x".repeat(40) }, false).missing.includes("DATABASE_URL"));
const recent = MIGRATION_SQL.filter(([n]) => n >= "0030");
ok("they are written to be safe twice (IF NOT EXISTS on every create and add column)", recent.every(([, t]) => statementsOf(t).every((s) => !/^(create (table|index|unique index)|alter table .* add column)/i.test(s) || /if not exists/i.test(s))), recent.map(([n]) => n));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
