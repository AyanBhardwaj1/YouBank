import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/**
 * What the app shows while its database is not ready (a deploy ahead of its setup): no crash, no
 * internals, a line saying it will be back. Which part is missing goes to the operator through
 * /api/health, never to visitors. Server component.
 */
export function SetupScreen({ full = true }: { full?: boolean }) {
  return (
    <main role="status" className={`flex items-center justify-center px-4 py-12 ${full ? "min-h-dvh" : "h-full min-h-[320px]"}`}>
      <div className="rise panel float w-full max-w-md p-6">
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center ctl bg-accent-soft text-accent"><Icon name="Settings" className="h-4 w-4" /></span>
          <h1 className="text-[16px] font-semibold">YouBank is being set up</h1>
        </div>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          We are finishing some setup on our side. Your account and your work are safe. Try again in a few minutes.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Link href="/" className="ctl flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12.5px] text-muted hover:border-accent/50 hover:text-fg">
            <Icon name="Home" className="h-3.5 w-3.5" />Home
          </Link>
        </div>
      </div>
    </main>
  );
}

/**
 * The same message inside a workspace whose own tables are not there yet (a migration not applied on
 * this server): the rest of the app works, so it says what is waiting and nothing about how to fix it.
 * The operator sees which migration is missing in /api/health.
 */
export function SetupNotice({ what }: { what: string }) {
  return (
    <div role="status" className="mt-6 ctl border border-info/40 bg-info/5 p-4">
      <h2 className="flex items-center gap-2 text-[14px] font-semibold"><Icon name="Settings" className="h-4 w-4" /> {what} is being set up</h2>
      <p className="mt-2 max-w-[70ch] text-[12px] text-muted">
        We are finishing some setup on our side before this part of YouBank opens. Everything else works as usual, and nothing you have saved is affected. Try again in a few minutes.
      </p>
      <Link href="/app" className="ctl mt-3 inline-flex items-center gap-1.5 border border-line px-3 py-1.5 text-[12px] text-muted hover:border-accent/50 hover:text-fg">
        <Icon name="Home" className="h-3.5 w-3.5" />Back to Home
      </Link>
    </div>
  );
}
