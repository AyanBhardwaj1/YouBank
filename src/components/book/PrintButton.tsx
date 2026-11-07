"use client";

import { Icon } from "@/components/ui/Icon";

/** Print the page (or save it as PDF from the print dialog). Hidden when printing. */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <button type="button" onClick={() => window.print()} className="ctl flex items-center gap-1.5 border border-line px-2.5 py-1 text-[12px] hover:border-accent/50 print:hidden">
      <Icon name="Download" className="h-3.5 w-3.5" />{label}
    </button>
  );
}
