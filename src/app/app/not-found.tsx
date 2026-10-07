import Link from "next/link";

/** A missing model, tool, story or canvas inside the workspace: said within the app shell, not instead of it. */
export default function WorkspaceNotFound() {
  return (
    <main className="flex h-full min-h-[320px] items-center justify-center px-4 py-12">
      <div className="rise panel float w-full max-w-md p-6 text-center">
        <span className="num text-[30px] font-semibold text-accent">404</span>
        <h1 className="mt-1 text-[16px] font-semibold">We could not find that</h1>
        <p className="mt-1 text-[12.5px] text-muted">It may have been deleted, moved to a team you are not on, or the link may be incomplete.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/app" className="ctl bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-fg">Home</Link>
          <Link href="/app/library" className="ctl border border-line px-3 py-1.5 text-[12.5px] text-muted hover:border-accent/50 hover:text-fg">Library</Link>
        </div>
      </div>
    </main>
  );
}
