import Link from "next/link";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="rise panel float max-w-md p-6 text-center">
        <span className="num text-[34px] font-semibold text-accent">404</span>
        <h1 className="mt-2 text-[16px] font-semibold">That page does not exist</h1>
        <p className="mt-1 text-[12.5px] text-muted">The link may be stale, or the ticker or tool id may be wrong.</p>
        <div className="mt-5 flex justify-center gap-2">
          <Link href="/" className="ctl bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-fg">Home</Link>
          <Link href="/app/terminal" className="ctl border border-line px-3 py-1.5 text-[12.5px] text-muted hover:border-accent/50 hover:text-fg">Terminal</Link>
          <Link href="/app/tools" className="ctl border border-line px-3 py-1.5 text-[12.5px] text-muted hover:border-accent/50 hover:text-fg">Tools</Link>
        </div>
      </div>
    </main>
  );
}
