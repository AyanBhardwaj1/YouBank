/**
 * The mail sender for sign-in email (password reset links): optional. Set SMTP_URL (for example
 * smtps://user:pass@smtp.example.com:465) and MAIL_FROM ("YouBank <no-reply@youbank.dev>") and "Forgot your
 * password?" also offers a link by email. Without them the recovery key (src/lib/auth/recovery.ts) is the way
 * back in, so nothing here is required. Server only.
 */
import nodemailer from "nodemailer";

export const mailConfigured = () => !!(process.env.SMTP_URL?.trim() && process.env.MAIL_FROM?.trim());

let transport: ReturnType<typeof nodemailer.createTransport> | null = null;

export async function sendMail(to: string, subject: string, text: string, html: string): Promise<void> {
  if (!mailConfigured()) throw new Error("No mail sender is configured (SMTP_URL and MAIL_FROM)");
  transport ??= nodemailer.createTransport(process.env.SMTP_URL!.trim());
  await transport.sendMail({ from: process.env.MAIL_FROM!.trim(), to, subject, text, html });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The reset email: the link, how long it lasts, and what to do if it was not you. */
export function resetEmail(name: string, url: string): { subject: string; text: string; html: string } {
  const hi = name ? `Hi ${name},` : "Hi,";
  const text = `${hi}\n\nSomeone asked to reset the password for your YouBank account. To choose a new one, open this link within an hour:\n\n${url}\n\nIf it was not you, ignore this email: your password stays as it is.\n\nYouBank`;
  const html = `<p>${esc(hi)}</p><p>Someone asked to reset the password for your YouBank account. To choose a new one, open this link within an hour:</p><p><a href="${esc(url)}">Choose a new password</a></p><p>If it was not you, ignore this email: your password stays as it is.</p><p>YouBank</p>`;
  return { subject: "Reset your YouBank password", text, html };
}
