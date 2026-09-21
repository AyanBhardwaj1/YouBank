"use client";

import { useEffect } from "react";
import { isThemeId } from "@/lib/themes";
import { useTheme } from "./ThemeProvider";

/** After sign-in, the account's saved theme wins over the browser cookie. */
export function ThemeSync({ theme }: { theme: string | null }) {
  const { themeId, setTheme } = useTheme();
  useEffect(() => {
    if (theme && isThemeId(theme) && theme !== themeId) setTheme(theme, { persist: false });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [theme]);
  return null;
}
