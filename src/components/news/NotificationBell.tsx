"use client";

/** The bell in the top bar: alerts and briefs, the unread count, one click to the story. Polls every minute. */
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import { Bell, BellRing, Newspaper } from "lucide-react";
import { useState } from "react";
import { ago, post, useApi, useNow } from "./client";

type Item = { id: number; kind: string; title: string; body: string; url: string; urgent: boolean; at: string; read: boolean };

export function NotificationBell() {
  const { data, reload } = useApi<{ unread: number; items: Item[] }>("/api/news/notifications", 60_000);
  const [open, setOpen] = useState(false);
  const now = useNow();
  const unread = data?.unread ?? 0;
  const markAll = () => { void post("/api/news/notifications", { all: true }).then(reload); };
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="ctl relative flex items-center p-1.5 text-muted hover:bg-elevated hover:text-fg" aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}>
        {unread ? <BellRing className="h-3.5 w-3.5 text-accent" /> : <Bell className="h-3.5 w-3.5" />}
        {unread > 0 && <span className="num absolute -right-0.5 -top-0.5 grid h-3.5 min-w-3.5 place-items-center rounded-full bg-accent px-0.5 text-[8.5px] font-bold text-accent-fg">{unread > 99 ? "99+" : unread}</span>}
      </button>
      <AnimatePresence>
        {open && (
          <>
            <button type="button" aria-label="Close notifications" className="fixed inset-0 z-40 cursor-default" onClick={() => setOpen(false)} />
            <motion.div initial={{ opacity: 0, y: -6, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16 }}
              className="float absolute right-0 z-50 mt-1.5 w-[360px] max-w-[92vw] overflow-hidden rounded-[var(--radius)] border border-line-strong bg-raised text-[12px]">
              <div className="flex items-center justify-between border-b border-line px-3 py-2"><span className="font-semibold text-fg">Alerts and briefs</span>{unread > 0 && <button type="button" onClick={markAll} className="text-[11px] text-muted hover:text-fg">Mark all read</button>}</div>
              <div className="max-h-[420px] overflow-y-auto">
                {!data?.items.length && <p className="px-3 py-6 text-center text-muted">Nothing yet. Alerts for your watchlist, your network and your desk land here, with the morning brief.</p>}
                {data?.items.map((n) => (
                  <Link key={n.id} href={n.url || "/app/news"} onClick={() => { setOpen(false); if (!n.read) void post("/api/news/notifications", { ids: [n.id] }).then(reload); }}
                    className={`flex gap-2.5 border-b border-line/60 px-3 py-2.5 hover:bg-elevated ${n.read ? "opacity-70" : ""}`}>
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${n.read ? "bg-transparent" : n.urgent ? "bg-neg" : "bg-accent"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5 text-[10.5px] uppercase tracking-wider text-muted">{n.kind === "brief" ? <><Newspaper className="h-3 w-3" /> Brief</> : n.urgent ? <span className="text-neg">Urgent</span> : "Alert"}<span className="normal-case tracking-normal">· {now ? ago(n.at, now) : ""}</span></span>
                      <span className="mt-0.5 block leading-snug text-fg">{n.title}</span>
                      {n.body && <span className="mt-0.5 line-clamp-2 block text-[11px] text-muted">{n.body}</span>}
                    </span>
                  </Link>
                ))}
              </div>
              <Link href="/app/settings?tab=news" onClick={() => setOpen(false)} className="block border-t border-line px-3 py-2 text-center text-[11px] text-muted hover:text-fg">Alert settings</Link>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
