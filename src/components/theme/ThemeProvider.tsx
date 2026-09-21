"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_THEME, THEME_COOKIE, isThemeId, themeById, type ThemeDef, type ThemeId } from "@/lib/themes";

type Ctx = { theme: ThemeDef; themeId: ThemeId; setTheme: (id: ThemeId, opts?: { persist?: boolean }) => void; preview: (id: ThemeId | null) => void };
const ThemeCtx = createContext<Ctx | null>(null);

function applyAttr(id: ThemeId) {
  document.documentElement.setAttribute("data-theme", id);
}

/**
 * Holds the active theme. The server renders <html data-theme> from the yb-theme cookie so there is no flash;
 * this provider keeps the attribute, cookie, and (when signed in) the profile in sync, with a View Transition crossfade.
 */
export function ThemeProvider({ initial, signedIn, children }: { initial: ThemeId; signedIn: boolean; children: React.ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(initial);
  const [previewId, setPreviewId] = useState<ThemeId | null>(null);

  const setTheme = useCallback((id: ThemeId, opts?: { persist?: boolean }) => {
    if (!isThemeId(id)) return;
    const run = () => { applyAttr(id); setThemeId(id); };
    const doc = document as Document & { startViewTransition?: (cb: () => void) => void };
    if (doc.startViewTransition) doc.startViewTransition(run); else run();
    try { document.cookie = `${THEME_COOKIE}=${id}; path=/; max-age=31536000; samesite=lax`; } catch { /* ignore */ }
    if (opts?.persist !== false && signedIn) {
      fetch("/api/prefs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ theme: id }) }).catch(() => {});
    }
  }, [signedIn]);

  const preview = useCallback((id: ThemeId | null) => {
    setPreviewId(id);
    applyAttr(id ?? themeId);
  }, [themeId]);

  useEffect(() => { applyAttr(previewId ?? themeId); }, [themeId, previewId]);

  const value = useMemo<Ctx>(() => ({ theme: themeById(themeId), themeId, setTheme, preview }), [themeId, setTheme, preview]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  const v = useContext(ThemeCtx);
  if (v) return v;
  return { theme: themeById(DEFAULT_THEME), themeId: DEFAULT_THEME, setTheme: () => {}, preview: () => {} };
}
