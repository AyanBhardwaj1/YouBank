"use client";

import Link from "next/link";
import { useEffect } from "react";

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 py-16">
      <div className="rise panel float max-w-lg p-6">
        <h1 className="text-[16px] font-semibold text-neg">Something broke on this screen</h1>
        <p className="mt-1 text-[12.5px] text-muted">Usually a data source timing out: SEC EDGAR rate limits, the price API, or the database waking up. Retry first.</p>
        <pre className="mt-3 max-h-40 overflow-auto ctl border border-line bg-bg p-2 text-[11px] text-muted">{error.message}{error.digest ? `\n\ndigest: ${error.digest}` : ""}</pre>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={reset} className="ctl bg-accent px-3 py-1.5 text-[12.5px] font-semibold text-accent-fg">Try again</button>
          <Link href="/app" className="ctl border border-line px-3 py-1.5 text-[12.5px] text-muted hover:border-accent/50 hover:text-fg">Back to home</Link>
        </div>
      </div>
    </main>
  );
}
