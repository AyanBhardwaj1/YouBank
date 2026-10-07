"use client";

/**
 * Small controls shared by the front page, Brief mode and the reader:
 * - "Why you're seeing this": the parts of the story's score for this person laid out as bars (desk
 *   fit, importance, personal matches, what their reading taught the page, freshness) with the reasons
 *   in words. The ranking is a sum anyone can follow, so this shows all of it;
 * - Follow: subscribe to a developing story (five free; the server enforces the plan);
 * - Share: the story's public page (no personal data on it), by the system share sheet, X, LinkedIn,
 *   email, or a copied link.
 */
import { AnimatePresence, motion } from "motion/react";
import { useState, useSyncExternalStore } from "react";
import type { Explain } from "@/lib/news/rank";
import { Icon } from "@/components/ui/Icon";
import { post } from "./client";

const PARTS: { key: keyof Explain; label: string; hint: string; tone: string }[] = [
  { key: "fit", label: "Fits your desk", hint: "How well its sectors and kind of work match your desk", tone: "bg-chart-1" },
  { key: "importance", label: "Importance", hint: "Source standing, breadth of coverage, event type and size", tone: "bg-fg/70" },
  { key: "personal", label: "Your watchlist and network", hint: "Watchlist, follows, and companies where your contacts work", tone: "bg-accent" },
  { key: "learned", label: "What you read", hint: "Learned from what you read, save, follow and hide, fading over two weeks", tone: "bg-pos" },
];

export function WhyShown({ explain, reasons, align = "right", compact = false }: { explain?: Explain; reasons: string[]; align?: "left" | "right"; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  if (!explain) return null;
  const max = Math.max(0.9, ...PARTS.map((p) => Math.abs(explain[p.key])));
  return (
    <span className="relative inline-flex" onClick={(e) => e.stopPropagation()}>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10.5px] text-muted transition hover:border-accent/50 hover:text-accent" title="Why you're seeing this">
        <Icon name="Info" className="h-3 w-3" />{compact ? "Why?" : "Why you're seeing this"}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div initial={{ opacity: 0, y: -4, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.15 }}
            className={`absolute top-full z-40 mt-1.5 w-[290px] max-w-[86vw] rounded-[var(--radius)] border border-line-strong bg-raised p-3 text-left text-[11.5px] shadow-float ${align === "right" ? "right-0" : "left-0"}`} role="dialog" aria-label="Why you're seeing this">
            <div className="mb-2 flex items-center justify-between"><span className="font-semibold text-fg">Why you&apos;re seeing this</span><button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-fg" aria-label="Close"><Icon name="X" className="h-3.5 w-3.5" /></button></div>
            <div className="space-y-1.5">
              {PARTS.map((p) => {
                const v = explain[p.key];
                return (
                  <div key={p.key} title={p.hint}>
                    <div className="flex justify-between text-[10.5px]"><span className="text-muted">{p.label}</span><span className="num text-fg">{v >= 0 ? "+" : "−"}{Math.abs(v).toFixed(2)}</span></div>
                    <div className="relative mt-0.5 h-1.5 rounded-full bg-line/60">
                      <div className={`absolute inset-y-0 rounded-full ${v < 0 ? "bg-neg" : p.tone}`} style={{ left: 0, width: `${(Math.abs(v) / max) * 100}%` }} />
                    </div>
                  </div>
                );
              })}
              <div className="flex justify-between border-t border-line pt-1.5 text-[10.5px]"><span className="text-muted" title="Stories fade with a 20-hour half-life">Freshness, times the sum</span><span className="num text-fg">×{explain.freshness.toFixed(2)}</span></div>
            </div>
            {reasons.length > 0 && <ul className="mt-2 space-y-0.5 text-[11px] text-fg">{reasons.map((r) => <li key={r} className="flex gap-1.5"><span className="mt-[0.45em] h-1 w-1 shrink-0 rounded-full bg-accent" />{r}</li>)}</ul>}
            <p className="mt-2 text-[10.5px] leading-relaxed text-muted">A simple sum, no black box. Hide stories you do not want and save the ones you do; the page adjusts within minutes.</p>
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

/** Follow a developing story. Shows the server's message when the free limit is reached. */
export function FollowButton({ id, following, onChange, size = "md" }: { id: number; following: boolean; onChange?: (following: boolean) => void; size?: "sm" | "md" }) {
  const [state, setState] = useState<{ id: number; on: boolean; busy: boolean; note: string | null }>({ id, on: following, busy: false, note: null });
  const on = state.id === id ? state.on : following;
  const toggle = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setState({ id, on, busy: true, note: null });
    try {
      const r = await post<{ following: boolean }>(`/api/news/story/${id}`, { action: on ? "unfollow" : "follow" });
      setState({ id, on: r.following, busy: false, note: r.following ? "You'll get an alert when this story moves." : null });
      onChange?.(r.following);
    } catch (err) {
      setState({ id, on, busy: false, note: err instanceof Error ? err.message : "Could not follow it right now." });
    }
  };
  const pad = size === "sm" ? "px-2 py-0.5 text-[10.5px]" : "px-3 py-1.5 text-[12px]";
  return (
    <span className="inline-flex flex-col items-start">
      <button type="button" onClick={toggle} disabled={state.busy} aria-pressed={on} className={`inline-flex items-center gap-1.5 rounded-full border ${pad} transition disabled:opacity-60 ${on ? "border-accent/50 bg-accent-soft text-accent" : "border-line text-fg hover:border-accent/50"}`} title={on ? "Stop following this story" : "Get an alert when this story develops"}>
        <Icon name={on ? "BellRing" : "BellPlus"} className="h-3.5 w-3.5" />{on ? "Following" : "Follow story"}
      </button>
      {state.id === id && state.note && <span className="mt-1 max-w-[320px] text-[10.5px] leading-snug text-muted">{state.note}</span>}
    </span>
  );
}

const noop = () => () => undefined;

/** Share a story's public page. The page carries only public facts, never anyone's personal view. */
export function ShareButtons({ url, title, compact = false }: { url: string; title: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const enc = encodeURIComponent;
  const native = async () => {
    try { await navigator.share({ title, url }); } catch { /* dismissed */ }
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1800); } catch { /* clipboard blocked */ }
  };
  // Read after hydration (the server has no share sheet), so the first render matches the server's.
  const canNative = useSyncExternalStore(noop, () => typeof navigator.share === "function", () => false);
  const btn = "inline-flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11.5px] text-fg transition hover:border-accent/50 hover:text-accent";
  return (
    <div className="flex flex-wrap items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      {canNative && <button type="button" onClick={native} className={btn}><Icon name="Share2" className="h-3.5 w-3.5" />Share</button>}
      <a className={btn} href={`https://x.com/intent/post?text=${enc(title)}&url=${enc(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on X">X</a>
      <a className={btn} href={`https://www.linkedin.com/sharing/share-offsite/?url=${enc(url)}`} target="_blank" rel="noopener noreferrer" aria-label="Share on LinkedIn">LinkedIn</a>
      {!compact && <a className={btn} href={`mailto:?subject=${enc(title)}&body=${enc(`${title}\n\n${url}`)}`} aria-label="Share by email"><Icon name="Mail" className="h-3.5 w-3.5" />Email</a>}
      <button type="button" onClick={copy} className={btn} aria-live="polite"><Icon name={copied ? "Check" : "Link2"} className="h-3.5 w-3.5" />{copied ? "Copied" : "Copy link"}</button>
    </div>
  );
}
