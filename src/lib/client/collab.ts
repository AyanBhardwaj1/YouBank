"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiError, errorMessage, readError } from "./errors";

export type Presence = { userId: string; name: string; field: string; lastSeenAt: string };
export type CollabSession = { id: number; title: string; kind: string; refId: string; teamId: number | null; state: Record<string, unknown>; ownerId: string; status: string };

type Change = { id: number; kind: string; userId: string; userName: string; payload: Record<string, unknown> };

/**
 * Join a shared session.
 *
 * The browser's EventSource handles reconnection and replays from Last-Event-ID, so the rotating
 * two-minute server connections are invisible here: `connected` only goes false if the stream cannot
 * be re-established at all. The stream starts from the event the loaded state already includes, and a
 * tab left in the background closes it after a short grace period, resuming from its last event when
 * shown again (others see it leave, then return).
 */
export function useCollabSession(sessionId: number | null, opts?: { selfId?: string; onRemote?: (patch: Record<string, unknown>, from: string) => void }) {
  const [session, setSession] = useState<CollabSession | null>(null);
  const [presence, setPresence] = useState<Presence[]>([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Held in refs so the effect below does not re-subscribe on every render.
  const onRemote = useRef(opts?.onRemote);
  useEffect(() => { onRemote.current = opts?.onRemote; });
  const pending = useRef<Record<string, unknown>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mine = useRef<string | undefined>(opts?.selfId);
  useEffect(() => { mine.current = opts?.selfId; });

  useEffect(() => {
    let cancelled = false;
    let es: EventSource | null = null;
    let last = 0;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;

    const open = () => {
      if (es || cancelled || sessionId === null) return;
      const s = new EventSource(`/api/collab/${sessionId}/stream?since=${last}`);
      es = s;
      s.onopen = () => { if (!cancelled) { setConnected(true); setError(null); } };
      s.addEventListener("presence", (ev) => {
        if (!cancelled) setPresence(JSON.parse((ev as MessageEvent).data) as Presence[]);
      });
      s.addEventListener("change", (ev) => {
        if (cancelled) return;
        const c = JSON.parse((ev as MessageEvent).data) as Change;
        last = Math.max(last, c.id);
        if (c.kind !== "patch") return;
        const patch = (c.payload.patch ?? {}) as Record<string, unknown>;
        // Our own echo still updates the local mirror, but must not be re-sent.
        setSession((cur) => (cur ? { ...cur, state: { ...cur.state, ...patch } } : cur));
        if (c.userId !== mine.current) onRemote.current?.(patch, c.userName || "someone");
      });
      s.onerror = () => { if (!cancelled) setConnected(false); };
    };
    const shut = () => { es?.close(); es = null; };
    const onVisibility = () => {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (document.visibilityState === "hidden") hideTimer = setTimeout(shut, 30_000);
      else open();
    };

    const load = async () => {
      if (sessionId === null) {
        if (!cancelled) { setSession(null); setPresence([]); setConnected(false); }
        return;
      }
      try {
        const res = await fetch(`/api/collab/${sessionId}`);
        if (!res.ok) throw await apiError(res);
        const body = await res.json().catch(() => null);
        if (cancelled) return;
        setSession((body as { session: CollabSession }).session);
        setPresence((body as { presence: Presence[] }).presence);
        // Follow from the last event the loaded state already includes.
        last = Number((body as { lastEventId?: number }).lastEventId) || 0;
        if (document.visibilityState !== "hidden") open();
        document.addEventListener("visibilitychange", onVisibility);
      } catch (e) { if (!cancelled) setError(errorMessage(e)); }
    };
    void load();
    if (sessionId === null) return () => { cancelled = true; };

    return () => {
      cancelled = true;
      if (hideTimer) clearTimeout(hideTimer);
      document.removeEventListener("visibilitychange", onVisibility);
      shut();
      // Drop out of the presence list immediately rather than waiting for the window to lapse.
      void fetch(`/api/collab/${sessionId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "leave" }), keepalive: true,
      }).catch(() => {});
    };
  }, [sessionId]);

  /** Queue a field change. Keystrokes coalesce so typing sends one patch, not one per character. */
  const patch = useCallback((fields: Record<string, unknown>) => {
    if (sessionId === null) return;
    Object.assign(pending.current, fields);
    setSession((cur) => (cur ? { ...cur, state: { ...cur.state, ...fields } } : cur));
    if (flushTimer.current) clearTimeout(flushTimer.current);
    flushTimer.current = setTimeout(() => {
      const body = pending.current;
      pending.current = {};
      if (Object.keys(body).length === 0) return;
      void fetch(`/api/collab/${sessionId}`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ patch: body }),
      })
        // A lost edit must not pass silently: the others never saw it.
        .then(async (r) => { if (!r.ok) setError(`Your last change was not saved. ${await readError(r)}`); else setError(null); })
        .catch((e) => setError(`Your last change was not saved. ${errorMessage(e)}`));
    }, 250);
  }, [sessionId]);

  /** Tell others which field has focus. */
  const focus = useCallback((field: string) => {
    if (sessionId === null) return;
    void fetch(`/api/collab/${sessionId}`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "heartbeat", field }),
    }).catch(() => {});
  }, [sessionId]);

  return { session, presence, connected, error, patch, focus };
}
