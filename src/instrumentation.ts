/**
 * Runs once when a server instance starts: checks the environment and logs what is missing, and logs
 * server errors that no route caught (a page's render, say) as one JSON line with a reference.
 */
import type { Instrumentation } from "next";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { checkEnv } = await import("@/lib/env");
  const { missing, invalid } = checkEnv(process.env, process.env.NODE_ENV === "production");
  if (missing.length || invalid.length) console.warn(JSON.stringify({ level: "warn", msg: "environment check", missing, invalid }));
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { logError } = await import("@/lib/errors");
  logError(error, { where: `${context.routeType} ${request.method} ${request.path.split("?")[0]}` });
};
