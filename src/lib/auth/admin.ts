/**
 * Who may run jobs that change what everyone sees (the startup directory sync): the cron secret, or a
 * signed-in person whose email is in ADMIN_EMAILS (comma-separated). Nobody else, however signed in.
 */
import { secretsMatch } from "@/lib/crm/crypto";

export function isAdmin(user: { email: string } | null): boolean {
  const email = user?.email.trim().toLowerCase();
  if (!email) return false;
  return (process.env.ADMIN_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email);
}

/** A request carrying CRON_SECRET as its bearer token (Vercel Cron, or an operator holding the secret). */
export function cronAuthorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return !!secret && secretsMatch(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}
