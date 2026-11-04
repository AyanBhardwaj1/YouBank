"use client";

import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { workspaceFor, type Profile, type WorkspaceConfig } from "@/lib/roles";
import { normalizeStarred, normalizeWatchlist, toggleStar } from "@/lib/desk/watchlist";
import type { ToolMeta } from "@/lib/workflows/catalog";
import { DEFAULT_LOOK, LOOK_COOKIE, defaultDesk, lookAttrs, lookCookie, normalizeDesk, normalizeLook, normalizePresets, type DeskPrefs, type LookPrefs, type LookPreset } from "@/lib/desk/desk";

type Workspace = {
  profile: Profile; config: WorkspaceConfig; /** Whether Edge is available here (always, inside the app; not on public pages). */ edge: boolean;
  /**
   * The tools for this person (catalogFor(profile)), worked out on the server by the workspace layout, so the
   * full catalog of every role stays out of the JavaScript every signed-in page loads.
   */
  tools: ToolMeta[];
  /** Features on, the Home layout and its widgets (Settings → My desk). */
  desk: DeskPrefs;
  /** Change the desk now and save it (notes are saved after a pause, so typing is not a request a key). */
  setDesk: (patch: Partial<DeskPrefs>, opts?: { /** false: show it here only, it is already saved. */ persist?: boolean }) => void;
  /** How the app looks beyond the theme (Settings → Style). */
  look: LookPrefs;
  setLook: (patch: Partial<LookPrefs>) => void;
  /** Looks the person saved (Settings → Style), each a style and a look under a name. */
  looks: LookPreset[];
  setLooks: (list: LookPreset[]) => void;
  /** Whether config.watchlist is the person's own list rather than the one their role suggests. */
  ownWatchlist: boolean;
  /** Replace the watchlist everywhere (null goes back to the role's). */
  setWatchlist: (list: string[] | null) => void;
  /** Tools the person starred: first on Home and at the top of Tools. */
  starred: string[];
  toggleStarred: (id: string) => void;
};
const Ctx = createContext<Workspace | null>(null);

const NO_TOOLS: ToolMeta[] = [];

/**
 * Saves go one at a time, in the order they were made: two quick clicks (Later, Later; Large, then
 * Larger) can otherwise reach two server instances and be stored in the wrong order, leaving the
 * in-between state after a reload. The server merges each under a row lock (src/lib/prefs/extra.ts).
 */
let queue: Promise<unknown> = Promise.resolve();
const save = (body: Record<string, unknown>) => {
  queue = queue.then(() => fetch("/api/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => undefined));
};

/** Put a look on <html> now (and in its cookie, so the next page's first paint already has it). */
export function applyLook(l: LookPrefs) {
  const html = document.documentElement;
  const { attrs, vars } = lookAttrs(l);
  for (const a of ["data-font", "data-bg", "data-wall", "data-motion", "data-contrast"]) {
    if (attrs[a]) html.setAttribute(a, attrs[a]); else html.removeAttribute(a);
  }
  for (const v of ["--ui-scale", "--radius", "--radius-sm", "--accent", "--accent-soft", "--accent-fg", "--chart-1"]) {
    if (vars[v]) html.style.setProperty(v, vars[v]); else html.style.removeProperty(v);
  }
  try { document.cookie = `${LOOK_COOKIE}=${lookCookie(l)}; path=/; max-age=31536000; samesite=lax`; } catch { /* ignore */ }
}

export function WorkspaceProvider({ profile, edge = false, tools = NO_TOOLS, desk: initialDesk, look: initialLook, looks: initialLooks, watchlist: initialWatchlist, starred: initialStarred, children }: {
  profile: Profile; edge?: boolean; tools?: ToolMeta[]; desk?: unknown; look?: unknown; looks?: unknown; watchlist?: unknown; starred?: unknown; children: React.ReactNode;
}) {
  const [desk, setDeskState] = useState<DeskPrefs>(() => (initialDesk === undefined ? defaultDesk(profile.role) : normalizeDesk(initialDesk, profile.role)));
  const [look, setLookState] = useState<LookPrefs>(() => (initialLook === undefined ? DEFAULT_LOOK : normalizeLook(initialLook)));
  const [looks, setLooksState] = useState<LookPreset[]>(() => normalizePresets(initialLooks));
  const [watchlist, setWatchlistState] = useState<string[] | null>(() => normalizeWatchlist(initialWatchlist));
  const [starred, setStarred] = useState<string[]>(() => normalizeStarred(initialStarred));
  const starredNow = useRef(starred);
  const notesTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setDesk = useCallback((patch: Partial<DeskPrefs>, opts?: { persist?: boolean }) => {
    setDeskState((d) => normalizeDesk({ ...d, ...patch, ...(Object.keys(patch).some((k) => k !== "notes") ? { source: patch.source ?? "you" } : {}) }, profile.role));
    if (opts?.persist === false) return;
    if (Object.keys(patch).length === 1 && "notes" in patch) {
      if (notesTimer.current) clearTimeout(notesTimer.current);
      notesTimer.current = setTimeout(() => save({ desk: { notes: patch.notes } }), 800);
    } else save({ desk: patch });
  }, [profile.role]);

  const setLook = useCallback((patch: Partial<LookPrefs>) => {
    setLookState((l) => {
      const next = normalizeLook({ ...l, ...patch });
      applyLook(next);
      return next;
    });
    save({ look: patch });
  }, []);

  const setLooks = useCallback((list: LookPreset[]) => {
    const next = normalizePresets(list);
    setLooksState(next);
    save({ looks: next });
  }, []);

  const setWatchlist = useCallback((list: string[] | null) => {
    const next = list === null ? null : normalizeWatchlist(list);
    setWatchlistState(next);
    save({ watchlist: next });
  }, []);

  const toggleStarred = useCallback((id: string) => {
    const next = toggleStar(starredNow.current, id);
    starredNow.current = next;
    setStarred(next);
    save({ starredTools: next });
  }, []);

  const config = useMemo(() => { const c = workspaceFor(profile); return watchlist ? { ...c, watchlist } : c; }, [profile, watchlist]);
  const value = useMemo(() => ({ profile, config, edge, tools, desk, setDesk, look, setLook, looks, setLooks, ownWatchlist: watchlist !== null, setWatchlist, starred, toggleStarred }), [profile, config, edge, tools, desk, setDesk, look, setLook, looks, setLooks, watchlist, setWatchlist, starred, toggleStarred]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

const FALLBACK: Profile = { role: "banker", specialty: "Technology M&A", seniority: "", firmType: "", firmName: "", firmTicker: "", sectors: [], goals: "" };

/** Workspace config for the signed-in user's role. Falls back to a tech banker when used outside the provider. */
export function useWorkspace(): Workspace {
  const v = useContext(Ctx);
  return v ?? { profile: FALLBACK, config: workspaceFor(FALLBACK), edge: false, tools: [], desk: defaultDesk(FALLBACK.role), setDesk: () => undefined, look: DEFAULT_LOOK, setLook: () => undefined, looks: [], setLooks: () => undefined, ownWatchlist: false, setWatchlist: () => undefined, starred: [], toggleStarred: () => undefined };
}
