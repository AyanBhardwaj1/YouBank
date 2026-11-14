"use client";

import { useState } from "react";
import { Icon } from "@/components/ui/Icon";

/** A recovery key shown once: large, selectable, with copy and download. */
export function RecoveryKeyReveal({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the text stays selectable */ }
  };
  const download = () => {
    const blob = new Blob([`YouBank recovery key\n\n${value}\n\nUse it at https://youbank.dev/sign-in/reset if you forget your password. It works once; a new one replaces it.\n`], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "youbank-recovery-key.txt";
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <div className="rounded-md border border-accent/40 bg-accent-soft/30 p-3">
      <p className="select-all break-all text-center font-mono text-[15px] font-semibold tracking-[0.12em] text-fg" aria-label="Recovery key">{value}</p>
      <div className="mt-2.5 flex justify-center gap-2 text-[11.5px]">
        <button type="button" onClick={copy} className="ctl flex items-center gap-1.5 border border-line px-2.5 py-1 text-muted hover:text-fg"><Icon name={copied ? "Check" : "Copy"} className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy"}</button>
        <button type="button" onClick={download} className="ctl flex items-center gap-1.5 border border-line px-2.5 py-1 text-muted hover:text-fg"><Icon name="Download" className="h-3.5 w-3.5" />Download</button>
      </div>
    </div>
  );
}
