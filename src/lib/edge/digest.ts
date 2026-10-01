/**
 * The daily visual digest: the findings that matched a person's watches but were not big enough to
 * interrupt them, up to six, drawn as they are in the feed (satellite before and after, a deal's
 * footprint, a filing's edits, a red flag, a model's picks). It goes where their daily brief goes
 * (email from their own mailbox, push, Slack) and always to the bell. Each finding is sent once.
 */
import { and, gte, inArray, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { logError } from "@/lib/errors";
import { emailSelf, pushToUser, slackPost } from "@/lib/news/deliver";
import { readerFor } from "@/lib/news/reader";
import { appOrigin } from "./alerts";
import { BETA_ON } from "./watches";

type Detection = typeof schema.edgeDetections.$inferSelect;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** One finding as an email block, its picture first. Pure. */
export function digestItem(d: Pick<Detection, "id" | "kind" | "title" | "summary" | "confidence" | "visual">, origin: string): string {
  const v = d.visual as Record<string, unknown>;
  let picture = "";
  if (d.kind === "ground_change") {
    const b = (v.before as { url?: string; date?: string } | undefined), a = (v.after as { url?: string; date?: string } | undefined);
    if (b?.url && a?.url) picture = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="50%" style="padding-right:4px"><img src="${esc(b.url)}" width="290" style="width:100%;border-radius:8px;display:block" alt="Before"><div style="font-size:11px;color:#8a8f98;padding-top:3px">Before · ${esc(b.date ?? "")}</div></td><td width="50%" style="padding-left:4px"><img src="${esc(a.url)}" width="290" style="width:100%;border-radius:8px;display:block" alt="After"><div style="font-size:11px;color:#8a8f98;padding-top:3px">After · ${esc(a.date ?? "")}</div></td></tr></table>`;
  } else if (d.kind === "flaring") {
    const days = (v.days as { date: string; n: number }[] | undefined) ?? [];
    const heat = v.heat as { url?: string; date?: string } | null | undefined;
    const strip = `<table role="presentation" cellpadding="0" cellspacing="0"><tr>${days.map((x) => `<td style="padding-right:3px"><div title="${esc(x.date)}" style="width:22px;height:22px;border-radius:4px;background:${x.n ? "#e8590c" : "#efede6"}"></div></td>`).join("")}</tr></table><div style="font-size:11px;color:#8a8f98;padding-top:3px">Days with flaring, ${esc(days[0]?.date ?? "")} to ${esc(days[days.length - 1]?.date ?? "")}</div>`;
    picture = `${heat?.url ? `<img src="${esc(heat.url)}" width="290" style="width:50%;border-radius:8px;display:block;margin-bottom:6px" alt="Shortwave-infrared heat, ${esc(heat.date ?? "")}">` : ""}${strip}`;
  } else if (d.kind === "radar_change") {
    const b = (v.before as { url?: string; date?: string } | undefined), a = (v.after as { url?: string; date?: string } | undefined);
    const st = v.stats as { newObjects?: number; newAreaM2?: number } | undefined;
    if (b?.url && a?.url) picture = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="50%" style="padding-right:4px"><img src="${esc(b.url)}" width="290" style="width:100%;border-radius:8px;display:block;background:#111" alt="Radar a year before"><div style="font-size:11px;color:#8a8f98;padding-top:3px">Radar · ${esc(b.date ?? "")}</div></td><td width="50%" style="padding-left:4px"><img src="${esc(a.url)}" width="290" style="width:100%;border-radius:8px;display:block;background:#111" alt="Radar now"><div style="font-size:11px;color:#8a8f98;padding-top:3px">Radar · ${esc(a.date ?? "")}${st?.newObjects ? ` · ${st.newObjects} new, about ${Math.round(st.newAreaM2 ?? 0).toLocaleString("en-US")} m²` : ""}</div></td></tr></table>`;
  } else if (d.kind === "permits") {
    const w = (v.windows as number[] | undefined) ?? [];
    const max = Math.max(1, ...w);
    const bars = w.map((n, i) => `<div style="height:8px;border-radius:4px;margin:3px 0;background:${i === w.length - 1 ? "#8a6d0b" : "#d9d6cc"};width:${Math.max(3, Math.round((n / max) * 100))}%" title="${n}"></div>`).join("");
    picture = `<div style="font-size:12px;color:#3a3f47">${Number(v.last30 ?? 0)} permits in the last 30 days · ${(Number(v.prior90 ?? 0) / 3).toFixed(1)} a month before</div>${bars}<div style="font-size:11px;color:#8a8f98">Each bar is 30 days, oldest first, within ${Number(v.radiusKm ?? 10)} km</div>`;
  } else if (d.kind === "methane_plume") {
    const rate = v.rateKgH as number | null | undefined, unc = v.uncertaintyKgH as number | null | undefined;
    picture = `<div style="display:inline-block;padding:6px 10px;border-radius:8px;background:#f6f1e3;font-size:13px;color:#3a3f47"><b style="color:#8a6d0b">${typeof rate === "number" ? `${Math.round(rate).toLocaleString("en-US")} ± ${Math.round(unc ?? 0).toLocaleString("en-US")} kg/h` : "Methane plume"}</b> · ${Math.round(Number(v.nearestM ?? 0)).toLocaleString("en-US")} m from the plant · ${esc(String(v.platform ?? ""))} ${esc(String(v.date ?? ""))}</div><div style="font-size:11px;color:#8a8f98;padding-top:3px">${esc(String(v.credit ?? "Data by Carbon Mapper"))}</div>`;
  } else if (d.kind === "filing_change") {
    const c = v.counts as { added: number; removed: number; changed: number; unchanged: number } | undefined;
    if (c) { const total = c.added + c.removed + c.changed + c.unchanged || 1; const w = (n: number) => Math.max(0, Math.round((n / total) * 100)); picture = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="height:10px;border-radius:5px;overflow:hidden"><tr><td style="width:${w(c.added)}%;background:#0f7b4f"></td><td style="width:${w(c.changed)}%;background:#2f6fbd"></td><td style="width:${w(c.removed)}%;background:#b42318"></td><td style="background:#e7e5dd"></td></tr></table><div style="font-size:12px;color:#6b7280;padding-top:4px">${c.added} new · ${c.changed} reworded · ${c.removed} dropped</div>`; }
  } else if (d.kind === "deal_proforma") {
    const p = (v.proforma as { parties?: { label: string; capacityMMcfd: number; color?: string }[] } | undefined)?.parties ?? [];
    const max = Math.max(1, ...p.map((x) => x.capacityMMcfd));
    picture = p.map((x) => `<div style="font-size:12px;color:#3a3f47;padding:2px 0">${esc(x.label)} · ${Math.round(x.capacityMMcfd)} MMcfd<div style="height:6px;border-radius:3px;background:${esc(x.color ?? "#2f6fbd")};width:${Math.round((x.capacityMMcfd / max) * 100)}%"></div></div>`).join("");
  } else if (d.kind === "graph_prediction") {
    const items = (v.items as { name: string; ticker: string; fresh?: boolean }[] | undefined) ?? [];
    picture = `<ol style="margin:0;padding-left:18px;font-size:13px;color:#3a3f47">${items.slice(0, 3).map((i) => `<li>${esc(i.name)}${i.ticker ? ` (${esc(i.ticker)})` : ""}${i.fresh ? ` <b style="color:#8a6d0b">new</b>` : ""}</li>`).join("")}</ol>`;
  } else if (d.kind === "graph_flag") {
    const f = v.flag as { severity?: string } | undefined;
    picture = `<div style="display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:${f?.severity === "high" ? "#b42318" : "#8a6d0b"}">${f?.severity === "high" ? "Red flag" : "Worth a look"}</div>`;
  }
  return `<tr><td style="padding:16px 0;border-top:1px solid #efede6">
${picture}
<a href="${origin}/app/edge?view=feed" style="display:block;margin-top:8px;font-family:Georgia,'Times New Roman',serif;font-size:18px;line-height:1.3;color:#15171a;text-decoration:none">${esc(d.title)}</a>
<div style="margin-top:4px;font-size:13.5px;line-height:1.55;color:#3a3f47">${esc(d.summary.slice(0, 320))}</div>
<div style="margin-top:4px;font-size:11px;color:#9aa0a8;text-transform:uppercase;letter-spacing:.03em">Confidence ${Math.round(d.confidence * 100)} of 100</div>
</td></tr>`;
}

/** The digest email. Pure. */
export function digestEmail(found: Pick<Detection, "id" | "kind" | "title" | "summary" | "confidence" | "visual">[], origin: string, dateLabel: string): { subject: string; text: string; html: string } {
  const body = `<div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a8f98">YouBank Edge · ${esc(dateLabel)}</div>
<h1 style="margin:8px 0 4px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:28px;line-height:1.2;color:#15171a">What changed at what you watch</h1>
<table role="presentation" width="100%" style="margin-top:6px">${found.map((d) => digestItem(d, origin)).join("")}</table>
<div style="margin:18px 0 6px"><a href="${origin}/app/edge?view=feed" style="display:inline-block;background:#15171a;color:#ffffff;padding:10px 16px;border-radius:8px;font-size:13px;text-decoration:none">Open the Edge feed</a></div>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f5f4ef;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#15171a"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4ef"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e7e5dd;border-radius:14px"><tr><td style="padding:26px 30px 16px 30px">${body}</td></tr><tr><td style="padding:14px 30px 24px 30px;border-top:1px solid #efede6;font-size:11.5px;color:#8a8f98;line-height:1.6">Findings from satellite imagery, filings and models, each with its sources in the app. You get this with your daily brief; change it in <a href="${origin}/app/settings?tab=news" style="color:#8a8f98">Settings, News and alerts</a>.</td></tr></table></td></tr></table></body></html>`;
  const text = [`YouBank Edge digest, ${dateLabel}`, "", ...found.flatMap((d) => [`- ${d.title}`, `  ${d.summary.slice(0, 300)}`]), "", `${origin}/app/edge?view=feed`].join("\n");
  return { subject: `Edge: ${found.length} finding${found.length === 1 ? "" : "s"} at what you watch`, text, html };
}

/** People with the beta on and findings kept for their digest in the last three days that have not gone out yet. */
export async function pendingDigests(limit = 500): Promise<{ user_id: string; subjects: string[] }[]> {
  const since = new Date(Date.now() - 3 * 86_400_000);
  return (await requireDb().execute(sql`
    select a.user_id, array_agg(a.subject) as subjects from edge_alerts a join profiles on profiles.user_id = a.user_id
    where a.kind = 'digest' and a.created_at >= ${since.toISOString()}::timestamptz and ${BETA_ON}
      and not exists (select 1 from edge_alerts d where d.user_id = a.user_id and d.subject = a.subject and d.kind = 'digested')
    group by a.user_id limit ${limit}`)).rows as { user_id: string; subjects: string[] }[];
}

/** Whether this is the hour a person's digest goes out: their morning brief's hour in their time zone, or 8 a.m. in New York when they take no brief. Pure. */
export function digestDue(brief: { enabled: boolean; time: string; timezone: string } | undefined, now: Date): boolean {
  const on = !!brief?.enabled;
  const want = on ? Number((brief!.time || "07:00").split(":")[0]) : 8;
  let hour: number;
  try { hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: on && brief!.timezone ? brief!.timezone : "America/New_York" }).format(now)); } catch { hour = now.getUTCHours(); }
  return hour === want;
}

/**
 * Send the digests that are due (people with the beta on and unsent findings from the last three days).
 * Run hourly, each person gets theirs at their brief's hour; `anyHour` sends every pending one (the daily
 * cron's fallback when the job runner is not set up).
 */
export async function sendDigests(deadline: number, opts: { anyHour?: boolean } = {}): Promise<{ people: number; sent: number }> {
  const db = requireDb();
  const pending = await pendingDigests();
  const origin = appOrigin();
  const dateLabel = new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: "America/New_York" });
  let sent = 0;
  for (const p of pending) {
    if (Date.now() > deadline) break;
    try {
      const ids = p.subjects.map((s) => Number(s.replace(/^detection:/, ""))).filter(Number.isInteger);
      const found = ids.length ? (await db.select().from(schema.edgeDetections).where(and(inArray(schema.edgeDetections.id, ids), gte(schema.edgeDetections.detectedAt, new Date(Date.now() - 30 * 86_400_000)))))
        .sort((a, b) => b.magnitude * b.confidence - a.magnitude * a.confidence).slice(0, 6) : [];
      const ctx = await readerFor(p.user_id).catch(() => null);
      if (!opts.anyHour && !digestDue(ctx?.prefs.brief, new Date())) continue;
      if (found.length) {
        const mail = digestEmail(found, origin, dateLabel);
        const ch = ctx?.prefs.brief.enabled ? ctx.prefs.brief.channels : [];
        if (ch.includes("email")) await emailSelf(p.user_id, origin, mail).catch((e) => logError(e, { where: "edge-digest-email" }));
        if (ch.includes("push")) await pushToUser(p.user_id, { title: mail.subject, body: found.slice(0, 2).map((d) => d.title).join(" · ").slice(0, 180), url: "/app/edge?view=feed", tag: `edge-digest-${new Date().toISOString().slice(0, 10)}` }).catch(() => 0);
        if (ch.includes("slack") && ctx?.prefs.slack) await slackPost(ctx.prefs.slack, `*${mail.subject}*\n${found.map((d) => `• ${d.title}`).join("\n")}\n<${origin}/app/edge?view=feed|Open the Edge feed>`).catch(() => undefined);
        await db.insert(schema.newsNotifications).values({ userId: p.user_id, key: `edge:digest:${new Date().toISOString().slice(0, 10)}`, kind: "alert", title: mail.subject, body: found.slice(0, 3).map((d) => d.title).join(" · ").slice(0, 600), url: "/app/edge?view=feed", urgent: false }).onConflictDoNothing();
        sent++;
      }
      if (p.subjects.length) await db.insert(schema.edgeAlerts).values(p.subjects.map((subject) => ({ userId: p.user_id, subject, kind: "digested" }))).onConflictDoNothing();
    } catch (e) { logError(e, { where: "edge-digest" }); }
  }
  return { people: pending.length, sent };
}
