"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type Presence = { userId: string; name: string; field: string; lastSeenAt: string };
export type CollabSession = { id: number; title: string; kind: string; refId: string; teamId: number | null; state: Record<string, unknown>; ownerId: string; status: string };

type Change = { id: number; kind: string; userId: string; userName: string; payload: Record<string, unknown> };

/**
 * Join a shared session.
 *
 * The browser's EventSource handles reconnection and replays from Last-Event-ID, so the rotating
 * 45-second server connections are invisible here: `connected` only goes false if the stream cannot
 * be re-established at all.
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

    const load = async () => {
      if (sessionId === null) {
        if (!cancelled) { setSession(null); setPresence([]); setConnected(false); }
        return;
      }
      try {
        const res = await fetch(`/api/collab/${sessionId}`);
        const body = await res.json().catch(() => null);
        if (!res.ok) throw new Error((body as { error?: string } | null)?.error ?? `Could not open the session (${res.status})`);
        if (cancelled) return;
        setSession((body as { session: CollabSession }).session);
        setPresence((body as { presence: Presence[] }).presence);
      } catch (e) { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); }
    };
    void load();
    if (sessionId === null) return () => { cancelled = true; };

    const es = new EventSource(`/api/collab/${sessionId}/stream`);
    es.onopen = () => { if (!cancelled) { setConnected(true); setError(null); } };
    es.addEventListener("presence", (ev) => {
      if (!cancelled) setPresence(JSON.parse((ev as MessageEvent).data) as Presence[]);
    });
    es.addEventListener("change", (ev) => {
      if (cancelled) return;
      const c = JSON.parse((ev as MessageEvent).data) as Change;
      if (c.kind !== "patch") return;
      const patch = (c.payload.patch ?? {}) as Record<string, unknown>;
      // Our own echo still updates the local mirror, but must not be re-sent.
      setSession((cur) => (cur ? { ...cur, state: { ...cur.state, ...patch } } : cur));
      if (c.userId !== mine.current) onRemote.current?.(patch, c.userName || "someone");
    });
    es.onerror = () => { if (!cancelled) setConnected(false); };

    return () => {
      cancelled = true;
      es.close();
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
      }).catch(() => {});
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
