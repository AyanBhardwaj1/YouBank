import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { ApproveDesktop } from "@/components/desktop/DesktopConnect";
import { SignInButton } from "@/components/marketing/SignInButton";
import { currentUser } from "@/lib/auth/user";
import { describePairing } from "@/lib/desktop/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect the desktop app", robots: { index: false } };

const PLATFORM: Record<string, string> = { windows: "Windows", macos: "macOS", linux: "Linux" };

/**
 * Where the desktop app sends people to approve its code; usually in the app's own window, where they
 * are already signed in, so connecting is one click. It sits outside the app so a first-time user can
 * sign in and approve before the ten-minute code runs out; onboarding comes after.
 */
export default async function DesktopConnectPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const code = ((await searchParams).code ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 9);
  const user = await currentUser();
  const here = `/desktop/connect${code ? `?code=${code}` : ""}`;
  const pending = user && code ? await describePairing(code).catch(() => null) : null;
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-10">
      <div className="w-full max-w-[460px] panel p-6">
        <Link href="/" className="flex items-center gap-2"><Logo size={24} /></Link>
        <h1 className="mt-5 text-[19px] font-semibold tracking-tight">Connect the desktop app</h1>
        {user ? (
          <>
            <p className="mt-1 text-[12.5px] text-muted">
              Signed in as {user.name || user.email}.{" "}
              {pending ? <>Connect <b className="text-fg">{pending.name || "this computer"}</b>{PLATFORM[pending.platform] ? ` (${PLATFORM[pending.platform]})` : ""} to your account?</> : "Enter the code your desktop app shows."}
            </p>
            <ApproveDesktop initialCode={code} />
            <p className="mt-5 border-t border-line pt-3 text-[11.5px] text-muted">Manage connected computers in <Link href="/app/settings?tab=desktop" className="underline hover:text-fg">Settings → Desktop app</Link>.</p>
          </>
        ) : (
          <>
            <p className="mt-1 text-[12.5px] text-muted">Sign in to YouBank to connect the desktop app{code ? <> showing <b className="font-mono text-fg">{code}</b></> : ""}. You&apos;ll come straight back here.</p>
            <SignInButton className="mt-4" next={here} newUser={here} />
          </>
        )}
      </div>
    </main>
  );
}
