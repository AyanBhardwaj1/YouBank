import Link from "next/link";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { SignInButton } from "@/components/marketing/SignInButton";
import { ROLES, ROLE_IDS } from "@/lib/roles";
import { Logo } from "@/components/brand/Logo";

export const metadata = { title: "Sign in" };

export default async function SignIn() {
  if (await currentUser()) redirect("/app");
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
        <h1 className="mt-5 text-[20px] font-semibold tracking-tight">Sign in</h1>
        <p className="mt-1 text-[12.5px] text-muted">Google only, for now. Your watchlists, sheets, saved runs, model and style preferences are kept on your account.</p>
        <SignInButton className="mt-5" />
        <div className="mt-6 border-t border-line pt-4">
          <div className="text-[10.5px] uppercase tracking-wider text-muted">You will be asked what you do</div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ROLE_IDS.map((id) => <span key={id} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-muted">{ROLES[id].label}</span>)}
          </div>
        </div>
        <p className="mt-5 text-[11px] text-muted"><Link href="/" className="hover:text-fg">← Back to the tour</Link></p>
      </div>
    </main>
  );
}
