"use client";

import { useEffect } from "react";
import { isThemeId } from "@/lib/themes";
import { normalizeLook } from "@/lib/desk/desk";
import { applyLook } from "@/components/workspace/WorkspaceProvider";
import { useTheme } from "./ThemeProvider";

/** After sign-in, the account's saved theme and look (Settings → Style) win over this browser's cookies. */
export function ThemeSync({ theme, look }: { theme: string | null; look?: unknown }) {
  const { themeId, setTheme } = useTheme();
  useEffect(() => {
    if (theme && isThemeId(theme) && theme !== themeId) setTheme(theme, { persist: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
  // Always: an account with no saved look gets the default, not a look another account left in this browser's cookie.
  useEffect(() => { applyLook(normalizeLook(look)); }, [look]);
  return null;
}
