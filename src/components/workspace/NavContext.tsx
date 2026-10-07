"use client";

import { createContext, useContext } from "react";
import type { NavFeature, NavPrefs } from "@/lib/nav";

export type Nav = {
  prefs: NavPrefs;
  /** The features this person's role has, in sidebar order. */
  features: NavFeature[];
  /** Change the arrangement; `persist: false` while a drag is still moving things. */
  update: (p: Partial<NavPrefs>, opts?: { persist?: boolean }) => void;
  /** Save the arrangement as it stands (after a drag ends). */
  save: () => void;
  open: boolean;
  setOpen: (open: boolean) => void;
  customizing: boolean;
  /** Phone-sized screen: the sidebar is a bottom sheet and the pinned features are the tab bar. */
  phone: boolean;
  /** Open the sidebar on "Customize the top bar", or leave it. */
  customize: (on?: boolean) => void;
};

export const NavCtx = createContext<Nav | null>(null);

export function useNav(): Nav {
  const v = useContext(NavCtx);
  if (!v) throw new Error("useNav must be used inside AppShell");
  return v;
}
