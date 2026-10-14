/**
 * Who may confirm, reject or correct a crosswalk link: administrators (ADMIN_EMAILS) and the editors named
 * in EDGE_EDITOR_EMAILS (comma-separated). A wrong link changes what every Edge user sees for a company, so
 * it is not open to everyone; anyone may still see a link's method and evidence.
 */
import { isAdmin } from "@/lib/auth/admin";

export function isEditor(user: { email: string } | null): boolean {
  if (isAdmin(user)) return true;
  const email = user?.email.trim().toLowerCase();
  return !!email && (process.env.EDGE_EDITOR_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean).includes(email);
}
