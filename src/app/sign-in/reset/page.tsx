import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { SetupScreen } from "@/components/ui/SetupScreen";
import { ResetPassword } from "@/components/marketing/ResetPassword";
import { setupState } from "@/lib/setup";
import { mailConfigured } from "@/lib/auth/mail";

export const metadata = { title: "Reset your password" };
export const dynamic = "force-dynamic";

/**
 * "Forgot your password?": with the recovery key (always), or with a link by email when a mail sender is
 * configured. The emailed link comes back here with ?token= (or ?error=INVALID_TOKEN when it expired).
 */
export default async function ResetPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const setup = await setupState().catch(() => ({ ready: true as const }));
  if (!setup.ready) return <SetupScreen reason={setup.reason} />;
  const q = await searchParams;
  const token = typeof q.token === "string" && /^[A-Za-z0-9_-]{8,200}$/.test(q.token) ? q.token : null;
  const expired = q.error === "INVALID_TOKEN";
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-6 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="drift absolute -left-32 -top-32 h-[460px] w-[460px] rounded-full opacity-[0.16]" style={{ background: "radial-gradient(circle, var(--accent), transparent 65%)" }} />
        <div className="grid-bg absolute inset-0" />
      </div>
      <div className="rise w-full max-w-[440px] panel float p-6">
        <Link href="/" className="flex items-center gap-2"><Logo size={26} /></Link>
        <h1 className="mt-5 text-[20px] font-semibold tracking-tight">Reset your password</h1>
        <ResetPassword emailReset={mailConfigured()} token={token} expired={expired} />
        <p className="mt-5 text-[11px] text-muted"><Link href="/sign-in" className="hover:text-fg">← Back to sign-in</Link></p>
      </div>
    </main>
  );
}
