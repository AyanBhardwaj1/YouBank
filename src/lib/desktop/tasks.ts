/**
 * Scheduled work the desktop app asks for while it sits in the tray, done here on the person's behalf.
 * Each task is one call that returns what the app should show as a notification.
 *
 * Two kinds:
 * - free tasks read what the site already has (today's desk brief, which is written once per desk for
 *   everyone; the email agent's queue) and cost nothing extra;
 * - AI tasks run a model or the satellite checks for this one person (the Edge brief, a watch check).
 *   They are premium (`desktop.background_ai`) and, when the app runs them on its timer, they run only
 *   if the person switched that task on for that computer: the switch is stored on the device row, so
 *   an app that misreports its settings still cannot start one. "Run now" in the app is a person
 *   starting it, which only needs the plan.
 * Every task has its own per-person limit, so a stuck timer cannot run up a bill.
 */
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import type { CurrentUser } from "@/lib/auth/user";
import { requireFeature } from "@/lib/billing/entitlements";
import { crmCounts } from "@/lib/crm/db";
import { getSettings } from "@/lib/crm/settings";
import { requireEdge } from "@/lib/edge/access";
import { edgeBrief } from "@/lib/edge/brief";
import { notifyWatchers } from "@/lib/edge/notify";
import { checkWatch, listWatches } from "@/lib/edge/watches";
import { rateLimit } from "@/lib/locks";
import { briefView } from "@/lib/news/views";
import type { DesktopDevice } from "./auth";

export type TaskId = "morning-brief" | "autopilot-status" | "edge-brief" | "watch-check";

export type TaskSpec = { id: TaskId; ai: boolean; perDay: number };

/** Every task the app may ask for; `ai` tasks spend money and need the plan and the switch. */
export const TASKS: Record<TaskId, TaskSpec> = {
  "morning-brief": { id: "morning-brief", ai: false, perDay: 12 },
  "autopilot-status": { id: "autopilot-status", ai: false, perDay: 48 },
  "edge-brief": { id: "edge-brief", ai: true, perDay: 3 },
  "watch-check": { id: "watch-check", ai: true, perDay: 4 },
};
export const TASK_IDS = Object.keys(TASKS) as TaskId[];
export const isTaskId = (v: unknown): v is TaskId => typeof v === "string" && v in TASKS;

/** What the app shows: a notification title and body, and a site path to open on click. */
export type TaskResult = { title: string; body: string; url: string; quiet?: boolean };

const status = (message: string, code: number) => Object.assign(new Error(message), { status: code });

/**
 * Whether this run may go ahead, before anything is spent. Throws a message for the person. Pure apart
 * from the plan lookup.
 */
export async function authorizeTask(user: CurrentUser, device: DesktopDevice | null, task: TaskSpec, trigger: "schedule" | "manual"): Promise<void> {
  if (!task.ai) return;
  if (trigger === "schedule" && device?.settings.tasks?.[task.id] !== true) {
    throw status("This scheduled task is switched off for this computer. Turn it on in the desktop app's settings to let it run on its own.", 403);
  }
  await requireFeature(user, "desktop.background_ai");
}

export async function runTask(user: CurrentUser, task: TaskSpec): Promise<TaskResult> {
  await rateLimit(`desktop-task:${task.id}:${user.id}`, task.perDay, 86_400_000, "This task has already run several times today. It will run again tomorrow.");
  switch (task.id) {
    case "morning-brief": return morningBrief(user.id);
    case "autopilot-status": return autopilotStatus(user.id);
    case "edge-brief": return edgeBriefTask(user.id);
    case "watch-check": return watchCheck(user.id);
  }
}

async function morningBrief(userId: string): Promise<TaskResult> {
  const v = await briefView(userId);
  if (!v) return { title: "Your morning brief", body: "Finish setting up your desk on YouBank to get a brief each morning.", url: "/onboarding" };
  const top = v.brief.items[0]?.headline;
  return { title: v.brief.title || "Your morning brief", body: (v.brief.intro || top || "Today's brief is ready.").slice(0, 300), url: "/app/news" };
}

async function autopilotStatus(userId: string): Promise<TaskResult> {
  const db = requireDb();
  const [counts, settings, [q], [sched]] = await Promise.all([
    crmCounts(userId),
    getSettings(userId),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.crmQuestions).where(and(eq(schema.crmQuestions.userId, userId), eq(schema.crmQuestions.status, "open"))),
    db.select({ n: sql<number>`count(*)::int` }).from(schema.crmDrafts).where(and(eq(schema.crmDrafts.userId, userId), eq(schema.crmDrafts.status, "pending"), isNotNull(schema.crmDrafts.scheduledFor))),
  ]);
  const parts = [
    counts.pendingDrafts ? `${counts.pendingDrafts} draft${counts.pendingDrafts === 1 ? "" : "s"} to review` : "",
    sched?.n ? `${sched.n} queued to send` : "",
    q?.n ? `${q.n} question${q.n === 1 ? "" : "s"} for you` : "",
    counts.needsReply ? `${counts.needsReply} thread${counts.needsReply === 1 ? "" : "s"} waiting on a reply` : "",
  ].filter(Boolean);
  const on = settings.autopilot.enabled && !settings.autopilot.regulated;
  return {
    title: on ? "Autopilot is on" : "Email agent",
    body: parts.length ? `${parts.join(", ")}.` : "Nothing is waiting on you.",
    url: "/app/crm?tab=drafts",
    // Nothing new is not worth interrupting anyone for.
    quiet: parts.length === 0,
  };
}

async function edgeBriefTask(userId: string): Promise<TaskResult> {
  const p = await requireEdge(userId);
  const brief = await edgeBrief(userId, await listWatches(userId), p.prefs.blend);
  if (!brief) return { title: "Edge brief", body: "Too little has changed at what you watch for a brief yet.", url: "/app/edge", quiet: true };
  return { title: brief.headline || "Edge brief", body: brief.points.map((x) => x.text).join(" ").slice(0, 300), url: "/app/edge" };
}

/** Look at the person's own watches now, within the route's time, then alert on anything big as the daily pass would. */
async function watchCheck(userId: string): Promise<TaskResult> {
  await requireEdge(userId);
  const watches = (await listWatches(userId)).filter((w) => w.mine);
  if (!watches.length) return { title: "Watch check", body: "You are not watching any companies or places yet.", url: "/app/edge", quiet: true };
  const deadline = Date.now() + 45_000;
  const found: number[] = [];
  let checked = 0;
  for (const w of watches) {
    if (Date.now() > deadline - 8_000) break;
    found.push(...(await checkWatch(w, deadline, 2)));
    checked++;
  }
  if (found.length) await notifyWatchers(found).catch(() => undefined);
  const left = watches.length - checked;
  return {
    title: found.length ? `${found.length} new finding${found.length === 1 ? "" : "s"} at what you watch` : "Watch check",
    body: `Checked ${checked} of ${watches.length} watch${watches.length === 1 ? "" : "es"}${left ? `; the rest next time` : ""}.${found.length ? " Open Edge to see them." : " Nothing new."}`,
    url: "/app/edge",
    quiet: !found.length,
  };
}
