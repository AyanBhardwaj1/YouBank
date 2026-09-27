import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireDb, schema } from "@/db";
import { structured } from "@/lib/ai/agent";
import { loadUserContext, type UserContext } from "@/lib/ai/persona";
import { normalizeAutopilot, type AutopilotSettings } from "./autopilot-rules";
import { PUBLIC_EMAIL_DOMAINS, isMode, type Mode } from "./model";

type SettingsRecord = typeof schema.crmSettings.$inferSelect;
/** Settings as the rest of the app sees them: the mode resolved and autopilot normalized. */
export type SettingsRow = Omit<SettingsRecord, "autopilot" | "mode"> & { mode: Mode; modeChosen: boolean; autopilot: AutopilotSettings };

export const DEFAULT_SETTINGS = {
  instructions: "", knowledge: "", voice: "", followUpDays: 5, staleDealDays: 21, nightly: true,
  about: "", signature: "", internalDomains: [] as string[],
};

/** Investors and PE get deal flow by default; everyone else, founders included, gets business development. */
const modeForRole = (role: string | undefined): Mode => (role === "vc" || role === "pe" ? "deals" : "sales");

export async function getSettings(userId: string): Promise<SettingsRow> {
  const db = requireDb();
  const [row] = await db.select().from(schema.crmSettings).where(eq(schema.crmSettings.userId, userId));
  const chosen = isMode(row?.mode);
  let mode: Mode = chosen ? (row!.mode as Mode) : "sales";
  if (!chosen) {
    const [p] = await db.select({ role: schema.profiles.role }).from(schema.profiles).where(eq(schema.profiles.userId, userId));
    mode = modeForRole(p?.role);
  }
  const base = row ?? { userId, ...DEFAULT_SETTINGS, lockUntil: null, lastRunAt: null, updatedAt: new Date() };
  return { ...base, mode, modeChosen: chosen, autopilot: normalizeAutopilot(row?.autopilot) };
}

/** Who the drafts speak as: the person's own description when they wrote one, else their profile. */
export function personaFor(ctx: UserContext, s: Pick<SettingsRow, "about">): string {
  return s.about.trim() || ctx.persona;
}

/** Coworkers' domains: what the person set, else the domains of their connected company mailboxes. */
export function internalDomains(s: Pick<SettingsRow, "internalDomains">, mailboxes: string[]): string[] {
  if (s.internalDomains.length) return s.internalDomains;
  return [...new Set(mailboxes.map((a) => (a.split("@")[1] ?? "").toLowerCase()).filter((d) => d && !PUBLIC_EMAIL_DOMAINS.has(d)))];
}

const clampInt = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};

export async function saveSettings(userId: string, fields: Partial<typeof DEFAULT_SETTINGS> & { mode?: string; autopilot?: unknown }): Promise<SettingsRow> {
  const current = await getSettings(userId);
  const domains = (v: unknown) => (Array.isArray(v) ? v : String(v ?? "").split(/[\s,]+/))
    .map((d) => String(d).trim().toLowerCase().replace(/^@/, "")).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 20);
  const values = {
    mode: fields.mode !== undefined ? (isMode(fields.mode) ? fields.mode : "") : current.modeChosen ? current.mode : "",
    about: fields.about !== undefined ? String(fields.about).slice(0, 3000) : current.about,
    signature: fields.signature !== undefined ? String(fields.signature).slice(0, 1000) : current.signature,
    internalDomains: fields.internalDomains !== undefined ? domains(fields.internalDomains) : current.internalDomains,
    autopilot: fields.autopilot !== undefined ? normalizeAutopilot(fields.autopilot) : current.autopilot,
    instructions: fields.instructions !== undefined ? String(fields.instructions).slice(0, 4000) : current.instructions,
    knowledge: fields.knowledge !== undefined ? String(fields.knowledge).slice(0, 20_000) : current.knowledge,
    voice: fields.voice !== undefined ? String(fields.voice).slice(0, 2000) : current.voice,
    followUpDays: fields.followUpDays !== undefined ? clampInt(fields.followUpDays, 1, 60, current.followUpDays) : current.followUpDays,
    staleDealDays: fields.staleDealDays !== undefined ? clampInt(fields.staleDealDays, 3, 180, current.staleDealDays) : current.staleDealDays,
    nightly: fields.nightly !== undefined ? !!fields.nightly : current.nightly,
    updatedAt: new Date(),
  };
  await requireDb().insert(schema.crmSettings).values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.crmSettings.userId, set: values });
  return getSettings(userId);
}

/**
 * Take the per-person lock for a scheduled pass. Returns false when another pass holds it, so two
 * overlapping heartbeats never work the same mailbox or send the same email.
 */
export async function claimLock(userId: string, minutes: number): Promise<boolean> {
  const until = new Date(Date.now() + minutes * 60_000);
  const [row] = await requireDb().insert(schema.crmSettings).values({ userId, lockUntil: until })
    .onConflictDoUpdate({
      target: schema.crmSettings.userId, set: { lockUntil: until },
      setWhere: sql`${schema.crmSettings.lockUntil} is null or ${schema.crmSettings.lockUntil} < now()`,
    }).returning({ userId: schema.crmSettings.userId });
  return !!row;
}

export async function releaseLock(userId: string): Promise<void> {
  await requireDb().update(schema.crmSettings).set({ lockUntil: null }).where(eq(schema.crmSettings.userId, userId));
}

export async function markRun(userId: string): Promise<void> {
  await requireDb().insert(schema.crmSettings).values({ userId, lastRunAt: new Date() })
    .onConflictDoUpdate({ target: schema.crmSettings.userId, set: { lastRunAt: new Date() } });
}

/**
 * The reader's standing orders, as a block appended to any prompt that writes.
 *
 * They come after the built-in rules and may widen them, since the reader wrote them: "offer
 * Tuesday afternoons" authorises a time slot the default rules would leave open.
 */
export function standingOrders(s: Pick<SettingsRow, "instructions" | "knowledge" | "voice">, opts?: { forTriage?: boolean }): string {
  const parts: string[] = [];
  if (s.instructions.trim()) {
    parts.push(`The reader's standing instructions for you. They were written by the reader, so they may authorise things the rules above would otherwise leave for the reviewer:\n${s.instructions.trim()}`);
  }
  if (opts?.forTriage) return parts.join("\n\n");
  if (s.knowledge.trim()) {
    parts.push(`Reference knowledge about the reader and their firm. Cite it when it is relevant; do not claim anything beyond it:\n${s.knowledge.trim().slice(0, 12_000)}`);
  }
  if (s.voice.trim()) parts.push(`How the reader writes. Match it:\n${s.voice.trim()}`);
  return parts.join("\n\n");
}

/* ---------------- Learning the reader's voice ---------------- */

const VoiceResult = z.object({
  voice: z.string().describe("Four to eight short lines a writer could follow: length, greeting and sign-off habits, register, sentence shape, what they never do. No quotes from the emails."),
  samples: z.number().describe("how many emails this is based on"),
});

/**
 * Describe how the reader writes, from what they actually sent.
 *
 * Only outbound messages are read, and the result is a description of style rather than excerpts, so
 * no correspondent's details end up in every future prompt.
 */
export async function learnVoice(userId: string): Promise<{ voice: string; samples: number }> {
  const db = requireDb();
  const sent = await db.select({ body: schema.crmMessages.body, subject: schema.crmMessages.subject })
    .from(schema.crmMessages)
    .innerJoin(schema.crmThreads, eq(schema.crmThreads.id, schema.crmMessages.threadId))
    .where(and(eq(schema.crmThreads.userId, userId), eq(schema.crmMessages.direction, "outbound")))
    .orderBy(desc(schema.crmMessages.sentAt))
    .limit(25);
  const usable = sent.filter((m) => m.body.trim().length > 40);
  if (usable.length < 3) {
    throw new Error("Not enough sent mail to learn from yet. Sync a mailbox you have written from, or describe your style by hand.");
  }
  const ctx = await loadUserContext(userId);
  const { data } = await structured(VoiceResult, "writing_voice",
    "You describe a person's email writing style so another writer can imitate it. Describe; never quote. Leave out names, companies and any other details about the people they wrote to.",
    usable.map((m, i) => `--- Email ${i + 1}: ${m.subject} ---\n${m.body.slice(0, 2000)}`).join("\n\n"),
    { prefs: ctx.prefs });
  await saveSettings(userId, { voice: data.voice });
  return { voice: data.voice, samples: usable.length };
}
