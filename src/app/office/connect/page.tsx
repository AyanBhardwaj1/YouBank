import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { SignInButton } from "@/components/marketing/SignInButton";
import { ApproveCode } from "@/components/office/OfficeConnect";
import { currentUser } from "@/lib/auth/user";

export const dynamic = "force-dynamic";
export const metadata = { title: "Connect Excel or PowerPoint", robots: { index: false } };

/**
 * Where the add-in sends people to approve its code. It sits outside the app so a first-time user can
 * sign in, approve and get back to Excel before the ten-minute code runs out; onboarding comes after.
 */
export default async function OfficeConnectPage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const code = ((await searchParams).code ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 9);
  const user = await currentUser();
  const here = `/office/connect${code ? `?code=${code}` : ""}`;
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-10">
      <div className="w-full max-w-[440px] panel p-6">
        <Link href="/" className="flex items-center gap-2"><Logo size={24} /></Link>
        <h1 className="mt-5 text-[19px] font-semibold tracking-tight">Connect Excel or PowerPoint</h1>
        {user ? (
          <>
            <p className="mt-1 text-[12.5px] text-muted">Signed in as {user.name || user.email}. Enter the code your add-in shows.</p>
            <ApproveCode initialCode={code} />
            <p className="mt-5 border-t border-line pt-3 text-[11.5px] text-muted">Manage connected installs and get the add-in from <Link href="/app/office" className="underline hover:text-fg">Excel and PowerPoint</Link> in YouBank.</p>
          </>
        ) : (
          <>
            <p className="mt-1 text-[12.5px] text-muted">Sign in to YouBank to connect the add-in{code ? <> showing <b className="font-mono text-fg">{code}</b></> : ""}. You&apos;ll come straight back here.</p>
            <SignInButton className="mt-4" next={here} newUser={here} />
          </>
        )}
      </div>
    </main>
  );
}
