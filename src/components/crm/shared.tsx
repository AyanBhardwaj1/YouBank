"use client";

/** Pieces every CRM panel uses: the fetch helper, the action runner's shape, and the house button styles. */
import { messageFor } from "@/lib/client/errors";

export async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(messageFor(res.status, body).message);
  return body as T;
}

export const money = (n: number | null) => (n == null ? "" : n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${n}`);

export const ago = (iso: string | null | undefined) => {
  if (!iso) return "never";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : days < 60 ? `${days}d ago` : `${Math.round(days / 30)}mo ago`;
};

/** What a panel gets from the workspace: one busy flag, one error line, one notice line, one refresh. */
export type PanelCtx = {
  busy: string | null;
  run: (label: string, fn: () => Promise<void>) => Promise<void>;
  say: (message: string) => void;
  /** Reload the workspace's shared data: counts, drafts, deals. */
  refresh: () => void;
  /** Changes whenever the workspace reloads, so panels can reload with it. */
  tick: number;
};

/** Button looks. On a phone they grow to finger size (40px tall); text links get a bigger hit area. */
export const btn = {
  primary: "ctl bg-fg px-2.5 py-1 text-[11.5px] font-semibold text-bg transition hover:bg-white disabled:opacity-50 max-md:min-h-10 max-md:px-3.5",
  accent: "ctl bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-bg transition hover:opacity-90 disabled:opacity-50 max-md:min-h-10 max-md:px-3.5",
  ghost: "ctl border border-line px-2.5 py-1 text-[11.5px] text-muted transition hover:border-accent/50 hover:text-fg disabled:opacity-50 max-md:min-h-10 max-md:px-3.5",
  link: "hit text-[11.5px] text-muted transition hover:text-fg disabled:opacity-50",
  danger: "hit text-[11.5px] text-muted transition hover:text-neg disabled:opacity-50",
};

export const input = "ctl border border-line bg-bg/60 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent/60";

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-semibold">{label}</span>
      {children}
      {hint && <span className="text-[10.5px] text-muted">{hint}</span>}
    </label>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="ctl border border-dashed border-line px-3 py-4 text-[12px] text-muted">{children}</p>;
}
