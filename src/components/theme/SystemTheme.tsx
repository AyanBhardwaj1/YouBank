"use client";

import { useEffect } from "react";
import { useTheme } from "./ThemeProvider";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";

/**
 * "Match my system" (Settings → Style): while it is on, the style follows the device's light or dark
 * setting, live, using the two styles the person chose. It does not save the style to the account each
 * time the device switches; the cookie keeps the next page's first paint right.
 */
export function SystemTheme() {
  const { look } = useWorkspace();
  const { setTheme } = useTheme();
  useEffect(() => {
    if (!look.system) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => setTheme(mq.matches ? look.darkTheme : look.lightTheme, { persist: false });
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, [look.system, look.lightTheme, look.darkTheme, setTheme]);
  return null;
}
