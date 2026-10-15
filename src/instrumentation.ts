/**
 * Runs once when a server instance starts: checks the environment and logs what is missing, and logs
 * server errors that no route caught (a page's render, say) as one JSON line with a reference.
 */
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnv, featureStatus, moneySwitches, REQUIRED } = await import("@/lib/env");
  const production = process.env.NODE_ENV === "production";
  const { missing, invalid } = checkEnv(process.env, production);
  // A setting every page needs is an error (the app shows "being set up" until it is there); the rest
  // turn one feature off and are warnings. Names only, never values.
  const fatal = missing.filter((k) => REQUIRED.includes(k));
  if (fatal.length) console.error(JSON.stringify({ level: "error", msg: "environment check: the app cannot run", missing: fatal }));
  if (missing.length > fatal.length || invalid.length) console.warn(JSON.stringify({ level: "warn", msg: "environment check", missing: missing.filter((k) => !fatal.includes(k)), invalid }));
  const features = featureStatus(process.env);
  const off = features.filter((f) => !f.on).map((f) => f.id);
  if (off.length) console.info(JSON.stringify({ level: "info", msg: "features off", off }));
  // The switches that move real money: always logged, so a deploy that turned one on is visible.
  const money = moneySwitches(process.env);
  const live = Object.entries(money).filter(([k, v]) => v && k !== "algoKill").map(([k]) => k);
  console[live.length ? "warn" : "info"](JSON.stringify({ level: live.length ? "warn" : "info", msg: live.length ? `real-money switches ON: ${live.join(", ")}` : "real-money switches off", ...money, env: process.env.VERCEL_ENV ?? process.env.NODE_ENV }));
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logError } = await import("@/lib/errors");
  logError(error, { where: `${context.routeType} ${request.method} ${request.path.split("?")[0]}` });
};
