import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { Logo } from "@/components/brand/Logo";
import { SetupScreen } from "@/components/ui/SetupScreen";
import { TwoFactorChallenge } from "@/components/marketing/TwoFactorChallenge";
import { setupState } from "@/lib/setup";
import { safeNext } from "@/lib/safe-next";

export const metadata = { title: "Two-factor sign-in" };

/**
 * The second step of a password sign-in with two-factor on: Better Auth has checked the password and
 * holds a short-lived (ten-minute) challenge cookie, not a session; the code here turns it into one.
 */
export default async function TwoFactorSignIn({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const next = safeNext((await searchParams).next);
  if (!(await setupState().catch(() => ({ ready: true as const }))).ready) return <SetupScreen />;
  if (await currentUser()) redirect(next);
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-6 py-10">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="drift absolute -left-32 -top-32 h-[460px] w-[460px] rounded-full opacity-[0.16]" style={{ background: "radial-gradient(circle, var(--accent), transparent 65%)" }} />
        <div className="grid-bg absolute inset-0" />
      </div>
      <div className="rise w-full max-w-[420px] panel float p-6">
        <Link href="/" className="flex items-center gap-2">
          <Logo size={26} />
        </Link>
        <h1 className="mt-5 text-[20px] font-semibold tracking-tight">Two-factor sign-in</h1>
        <p className="mt-1 text-[12.5px] text-muted">Your password was right. Now enter the 6-digit code from your authenticator app, or one of your backup codes.</p>
        <TwoFactorChallenge next={next} className="mt-5" />
        <p className="mt-5 text-[11px] text-muted"><Link href={next === "/app" ? "/sign-in" : `/sign-in?next=${encodeURIComponent(next)}`} className="hover:text-fg">← Back to sign-in</Link></p>
      </div>
    </main>
  );
}
