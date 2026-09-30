/**
 * Where briefs and alerts go beyond the app, all free: email from the person's own connected mailbox
 * to themselves (Gmail or IMAP/SMTP, already connected for Relationships), browser push (Web Push with
 * VAPID keys, no third-party service), and Slack through an incoming webhook they paste in.
 */
import { and, eq } from "drizzle-orm";
import webpush from "web-push";
import { requireDb, schema } from "@/db";
import { accessTokenFor } from "@/lib/crm/accounts";
import { decryptToken } from "@/lib/crm/crypto";
import { sendMessage } from "@/lib/crm/gmail";
import { smtpTransport, type ImapSettings } from "@/lib/crm/imap";
import type { Brief } from "./brief";
import type { CalEvent, WatchRow } from "./calendar";

/* ---------------- Email ---------------- */

/** Send to the person's own inbox from their connected mailbox. Returns the address, or throws why not. */
export async function emailSelf(userId: string, origin: string, mail: { subject: string; text: string; html: string }): Promise<string> {
  const accounts = await requireDb().select().from(schema.emailAccounts).where(and(eq(schema.emailAccounts.userId, userId), eq(schema.emailAccounts.status, "connected")));
  const account = accounts.find((a) => a.provider === "gmail") ?? accounts[0];
  if (!account) throw new Error("No connected mailbox: connect one in Relationships to get email");
  if (account.provider === "gmail") {
    const token = await accessTokenFor(account, origin);
    await sendMessage(token, { to: [account.address], subject: mail.subject, body: mail.text, html: mail.html });
  } else {
    const s = account.settings as ImapSettings;
    await smtpTransport(s, decryptToken(account.secret)).sendMail({ from: { name: "YouBank", address: account.address }, to: account.address, subject: mail.subject, text: mail.text, html: mail.html });
  }
  return account.address;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const pct = (v: number | null) => (v === null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(2)}%`);
const tone = (v: number | null) => (v === null ? "#6b7280" : v >= 0 ? "#0f7b4f" : "#b42318");
const shell = (title: string, body: string, origin: string) => `<!doctype html><html><body style="margin:0;background:#f5f4ef;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#15171a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f4ef"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" style="max-width:640px;width:100%;background:#ffffff;border:1px solid #e7e5dd;border-radius:14px">
<tr><td style="padding:26px 30px 8px 30px">${body}</td></tr>
<tr><td style="padding:16px 30px 26px 30px;border-top:1px solid #efede6;font-size:11.5px;color:#8a8f98;line-height:1.6">Headlines link to their publishers; summaries are YouBank's. You get this because it is switched on in <a href="${origin}/app/settings?tab=news" style="color:#8a8f98">Settings, News and alerts</a>.</td></tr>
</table></td></tr></table><div style="display:none">${esc(title)}</div></body></html>`;

export function briefEmail(b: Brief, mine: { id: number; headline: string; reasons: string[]; why?: string }[], origin: string, dateLabel: string): { subject: string; text: string; html: string } {
  const story = (id: number) => `${origin}/app/news/story/${id}`;
  const itemHtml = b.items.map((i, n) => `<tr><td style="padding:14px 0;border-top:${n ? "1px solid #efede6" : "0"}">
<a href="${story(i.clusterId)}" style="font-family:Georgia,'Times New Roman',serif;font-size:19px;line-height:1.3;color:#15171a;text-decoration:none">${esc(i.headline)}</a>
${i.lines.map((l) => `<div style="margin-top:6px;font-size:14px;line-height:1.55;color:#3a3f47">${esc(l)}</div>`).join("")}
${i.why ? `<div style="margin-top:8px;padding:8px 10px;background:#f6f3ea;border-left:3px solid #c9a227;font-size:13px;line-height:1.5;color:#4a4f57"><b>Why it matters.</b> ${esc(i.why)}</div>` : ""}
<div style="margin-top:6px;font-size:11px;color:#9aa0a8;letter-spacing:.02em;text-transform:uppercase">${esc(i.category)} · ${i.sources} source${i.sources === 1 ? "" : "s"}${i.tickers.length ? ` · ${esc(i.tickers.slice(0, 3).join(" "))}` : ""}</div>
</td></tr>`).join("");
  const mineHtml = mine.length ? `<div style="margin:18px 0 4px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#8a6d0b">For you</div>
<table role="presentation" width="100%">${mine.map((m) => `<tr><td style="padding:6px 0"><a href="${story(m.id)}" style="font-size:15px;color:#15171a;text-decoration:none;font-weight:600">${esc(m.headline)}</a><div style="font-size:12px;color:#8a6d0b">${esc(m.reasons.join(" · "))}</div></td></tr>`).join("")}</table>` : "";
  const watch = (w: WatchRow[]) => w.length ? `<div style="margin:22px 0 6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">Market watch</div>
<table role="presentation" width="100%" style="font-size:13px">${w.map((r) => `<tr><td style="padding:4px 0;color:#3a3f47">${esc(r.label)}${r.via ? ` <span style="color:#9aa0a8">via ${esc(r.via)}</span>` : ""}</td><td align="right" style="padding:4px 0;font-family:Menlo,Consolas,monospace">${r.last === null ? "—" : r.last.toLocaleString("en-US", { maximumFractionDigits: 2 })}</td><td align="right" style="padding:4px 0 4px 12px;font-family:Menlo,Consolas,monospace;color:${tone(r.change)}">${pct(r.change)}</td></tr>`).join("")}</table>` : "";
  const cal = (c: CalEvent[]) => c.length ? `<div style="margin:22px 0 6px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#6b7280">This week</div>
${c.slice(0, 6).map((e) => `<div style="font-size:13px;padding:3px 0;color:#3a3f47"><span style="display:inline-block;width:92px;color:#8a8f98">${new Date(e.at).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" })}</span>${esc(e.label)}${e.estimated ? " (estimated)" : ""}</div>`).join("")}` : "";
  const body = `<div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#8a8f98">YouBank · ${esc(b.deskLabel)} · ${esc(dateLabel)}</div>
<h1 style="margin:8px 0 6px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:30px;line-height:1.15;color:#15171a">${esc(b.title)}</h1>
${b.intro ? `<p style="margin:0 0 6px;font-size:15px;line-height:1.6;color:#3a3f47">${esc(b.intro)}</p>` : ""}
${mineHtml}
<table role="presentation" width="100%" style="margin-top:8px">${itemHtml}</table>
${watch(b.watch)}${cal(b.calendar)}
<div style="margin:22px 0 10px"><a href="${origin}/app/news" style="display:inline-block;background:#15171a;color:#ffffff;padding:10px 16px;border-radius:8px;font-size:13px;text-decoration:none">Open the Newsroom</a></div>`;
  const text = [`${b.deskLabel} brief, ${dateLabel}`, "", b.title, b.intro, "", ...(mine.length ? ["FOR YOU", ...mine.map((m) => `- ${m.headline} (${m.reasons.join("; ")})`), ""] : []),
    ...b.items.flatMap((i) => [`- ${i.headline}`, ...i.lines.map((l) => `  ${l}`), ...(i.why ? [`  Why it matters: ${i.why}`] : []), `  ${story(i.clusterId)}`]), "", `${origin}/app/news`].join("\n");
  return { subject: `${b.deskLabel} brief: ${b.title}`, text, html: shell(b.title, body, origin) };
}

export function alertEmail(a: { title: string; body: string; url: string; reasons: string[] }, origin: string): { subject: string; text: string; html: string } {
  const link = a.url.startsWith("http") ? a.url : `${origin}${a.url}`;
  const body = `<div style="font-size:11px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:#b42318">YouBank alert</div>
<h1 style="margin:8px 0 8px;font-family:Georgia,'Times New Roman',serif;font-weight:400;font-size:24px;line-height:1.25"><a href="${link}" style="color:#15171a;text-decoration:none">${esc(a.title)}</a></h1>
${a.reasons.length ? `<div style="font-size:12px;color:#8a6d0b;margin-bottom:8px">${esc(a.reasons.join(" · "))}</div>` : ""}
<p style="font-size:14px;line-height:1.6;color:#3a3f47;margin:0 0 14px">${esc(a.body)}</p>
<a href="${link}" style="display:inline-block;background:#15171a;color:#fff;padding:9px 14px;border-radius:8px;font-size:13px;text-decoration:none">Read it in YouBank</a>`;
  return { subject: `Alert: ${a.title}`, text: `${a.title}\n${a.reasons.join(" · ")}\n\n${a.body}\n\n${link}`, html: shell(a.title, body, origin) };
}

/* ---------------- Browser push ---------------- */

export const pushReady = () => !!(process.env.NEWS_VAPID_PUBLIC_KEY && process.env.NEWS_VAPID_PRIVATE_KEY);
let vapidSet = false;

/** Push to every device the person enabled. Expired devices are removed. Returns how many got it. */
export async function pushToUser(userId: string, payload: { title: string; body: string; url: string; tag: string; urgent?: boolean }): Promise<number> {
  if (!pushReady()) return 0;
  if (!vapidSet) { webpush.setVapidDetails(process.env.NEWS_VAPID_SUBJECT || "mailto:news@youbank.app", process.env.NEWS_VAPID_PUBLIC_KEY!, process.env.NEWS_VAPID_PRIVATE_KEY!); vapidSet = true; }
  const db = requireDb();
  const subs = await db.select().from(schema.newsPushSubs).where(eq(schema.newsPushSubs.userId, userId));
  let sent = 0;
  for (const s of subs) {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, JSON.stringify(payload), { TTL: payload.urgent ? 3600 : 6 * 3600, urgency: payload.urgent ? "high" : "normal", timeout: 10_000 });
      sent++;
      await db.update(schema.newsPushSubs).set({ lastOkAt: new Date() }).where(eq(schema.newsPushSubs.id, s.id));
    } catch (e) {
      const code = (e as { statusCode?: number }).statusCode;
      if (code === 404 || code === 410) await db.delete(schema.newsPushSubs).where(eq(schema.newsPushSubs.id, s.id));
    }
  }
  return sent;
}

/* ---------------- Slack ---------------- */

export const isSlackWebhook = (u: string) => /^https:\/\/hooks\.slack\.com\/(services|workflows|triggers)\/[A-Za-z0-9/_-]+$/.test(u.trim());

export async function slackPost(encryptedWebhook: string, text: string, blocks?: unknown[]): Promise<void> {
  const url = decryptToken(encryptedWebhook);
  if (!isSlackWebhook(url)) throw new Error("Not a Slack webhook");
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text, ...(blocks ? { blocks } : {}) }), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Slack said ${res.status}`);
}

export function briefSlack(b: Brief, origin: string): { text: string; blocks: unknown[] } {
  const blocks: unknown[] = [
    { type: "header", text: { type: "plain_text", text: `${b.deskLabel} brief: ${b.title}`.slice(0, 150) } },
    ...(b.intro ? [{ type: "section", text: { type: "mrkdwn", text: b.intro } }] : []),
    ...b.items.slice(0, 8).map((i) => ({ type: "section", text: { type: "mrkdwn", text: `*<${origin}/app/news/story/${i.clusterId}|${i.headline.replace(/[<>|]/g, "")}>*\n${i.lines.join(" ")}${i.why ? `\n_Why it matters:_ ${i.why}` : ""}`.slice(0, 2900) } })),
  ];
  return { text: `${b.deskLabel} brief: ${b.title}`, blocks };
}
