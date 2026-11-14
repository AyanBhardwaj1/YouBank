"use client";

/**
 * Shared pieces of the Prediction markets screens: formatting, the venue badge, the probability bar, the
 * one-line disclaimer and small layout helpers. Uses the app's tokens only, so every interface style restyles it.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "@/components/ui/Icon";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { DISCLAIMER, VENUE_LABEL, type Venue } from "@/lib/predict/types";

export const prob = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : v > 0 && v < 0.01 ? "<1%" : v < 1 && v > 0.99 ? ">99%" : `${Math.round(v * 100)}%`);
export const points = (v: number | null | undefined, dp = 0) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(dp)} pts`);
export const cents = (v: number | null | undefined) => (v === null || v === undefined || !Number.isFinite(v) ? "–" : `${(v * 100).toFixed(v * 100 < 10 ? 1 : 0)}¢`);
export const usd = (v: number | null | undefined) => {
  if (v === null || v === undefined || !Number.isFinite(v)) return "–";
  const a = Math.abs(v);
  return `$${a >= 1e9 ? `${(a / 1e9).toFixed(1)}B` : a >= 1e6 ? `${(a / 1e6).toFixed(1)}M` : a >= 1e3 ? `${(a / 1e3).toFixed(a >= 1e4 ? 0 : 1)}K` : a.toFixed(0)}`;
};
export function closesIn(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "no close date";
  const d = (Date.parse(iso) - now) / 86_400_000;
  if (!Number.isFinite(d)) return "no close date";
  if (d < 0) return "closed";
  if (d < 1) return `closes in ${Math.max(1, Math.round(d * 24))}h`;
  if (d < 60) return `closes in ${Math.round(d)}d`;
  return `closes ${new Date(iso).toLocaleDateString("en-US", { month: "short", year: "numeric" })}`;
}

const VENUE_TONE: Record<Venue, string> = {
  kalshi: "border-accent/40 text-accent", polymarket: "border-line-strong text-fg", gemini: "border-pos/40 text-pos", manifold: "border-line text-muted",
};

export function VenueBadge({ venue, small }: { venue: Venue; small?: boolean }) {
  return <span className={`inline-flex shrink-0 items-center rounded border px-1.5 ${small ? "py-0 text-[10px]" : "py-0.5 text-[10.5px]"} font-medium ${VENUE_TONE[venue]}`}>{VENUE_LABEL[venue]}{venue === "manifold" ? " · play" : ""}</span>;
}

/** The implied probability as a filled bar with the number on it. */
export function ProbBar({ p, wide }: { p: number | null; wide?: boolean }) {
  const w = p === null ? 0 : Math.max(2, Math.min(100, p * 100));
  return (
    <div className={`relative h-5 overflow-hidden rounded-[var(--radius)] border border-line bg-elevated ${wide ? "w-full" : "w-[72px]"}`} aria-label={`Implied probability ${prob(p)}`}>
      <div className="absolute inset-y-0 left-0 bg-accent/25" style={{ width: `${w}%` }} />
      <span className="relative block px-1.5 text-right font-mono text-[11.5px] font-semibold leading-5 tabular-nums text-fg">{prob(p)}</span>
    </div>
  );
}

export function Change({ v }: { v: number | null }) {
  if (v === null || !Number.isFinite(v)) return <span className="font-mono text-[11.5px] tabular-nums text-muted">–</span>;
  const tone = Math.abs(v) < 0.005 ? "text-muted" : v > 0 ? "text-pos" : "text-neg";
  return <span className={`font-mono text-[11.5px] tabular-nums ${tone}`}>{points(v)}</span>;
}

export function Disclaimer({ text = DISCLAIMER }: { text?: string }) {
  return <p className="mt-4 flex gap-1.5 text-[11px] text-muted"><Icon name="Info" className="mt-0.5 h-3 w-3 shrink-0" />{text}</p>;
}

export function Empty({ icon = "Search", title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="panel flex flex-col items-center gap-2 p-6 text-center">
      <Icon name={icon} className="h-5 w-5 text-muted" />
      <p className="text-[13px] font-semibold text-fg">{title}</p>
      {children && <div className="max-w-md text-[12px] text-muted">{children}</div>}
    </div>
  );
}

/** Up, down or mixed, as the rules give it, for "if yes, the stock has tended to …". */
export function DirTag({ dir }: { dir: 1 | -1 | 0 }) {
  return dir === 1 ? <span className="text-[11px] font-medium text-pos">tends up</span> : dir === -1 ? <span className="text-[11px] font-medium text-neg">tends down</span> : <span className="text-[11px] font-medium text-muted">mixed</span>;
}

/** Which side of a position yes falls on. */
export function EffectTag({ effect }: { effect: 1 | -1 | 0 }) {
  return effect === 1 ? <span className="rounded border border-pos/40 bg-pos/10 px-1.5 py-0.5 text-[10.5px] font-medium text-pos">yes helps</span>
    : effect === -1 ? <span className="rounded border border-neg/40 bg-neg/10 px-1.5 py-0.5 text-[10.5px] font-medium text-neg">yes hurts</span>
      : <span className="rounded border border-line px-1.5 py-0.5 text-[10.5px] font-medium text-muted">either way</span>;
}

export function StaleNote({ venues }: { venues: { venue: Venue; ok: boolean; stale: boolean; fetchedAt: string | null }[] | undefined }) {
  if (!venues) return null;
  const down = venues.filter((v) => !v.ok), stale = venues.filter((v) => v.ok && v.stale);
  if (!down.length && !stale.length) return null;
  const when = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "earlier");
  return (
    <p className="mb-2 flex flex-wrap gap-x-3 gap-y-1 rounded-[var(--radius)] border border-line bg-elevated px-2.5 py-1.5 text-[11.5px] text-muted">
      <Icon name="AlertTriangle" className="mt-0.5 h-3 w-3 shrink-0 text-accent" />
      {down.length > 0 && <span>{down.map((v) => VENUE_LABEL[v.venue]).join(", ")} could not be reached, so {down.length === 1 ? "its" : "their"} markets are missing for now.</span>}
      {stale.map((v) => <span key={v.venue}>{VENUE_LABEL[v.venue]}: prices as of {when(v.fetchedAt)}.</span>)}
    </p>
  );
}

/**
 * GET `url` as JSON when it changes (or on reload()): the last answer stays shown while the next loads, and
 * errors are already in words for people (lib/client/errors). Null url: nothing is loaded.
 */
export function useLoad<T>(url: string | null) {
  const [nonce, setNonce] = useState(0);
  const [state, setState] = useState<{ key: string; data: T | null; error: string | null }>({ key: "", data: null, error: null });
  const key = url ? `${url}#${nonce}` : "";
  useEffect(() => {
    if (!url) return;
    let live = true;
    fetchJson<T>(url).then(
      (data) => { if (live) setState({ key, data, error: null }); },
      (e) => { if (live) setState((s) => ({ key, data: s.data, error: errorMessage(e) })); },
    );
    return () => { live = false; };
  }, [key, url]);
  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data: state.data, error: state.key === key ? state.error : null, busy: !!url && state.key !== key, reload };
}
