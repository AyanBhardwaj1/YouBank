"use client";

import type { createAuthClient } from "better-auth/react";
import type { twoFactorClient } from "better-auth/client/plugins";
import { safeNext } from "@/lib/safe-next";

type AuthClient = ReturnType<typeof createAuthClient<{ plugins: [ReturnType<typeof twoFactorClient>] }>>;

let pending: Promise<AuthClient> | null = null;

/** Where the code is asked for after a password sign-in, keeping the page the person was headed to. Pure. */
export const twoFactorPage = (search: string) => {
  const next = safeNext(new URLSearchParams(search).get("next"));
  return next === "/app" ? "/sign-in/two-factor" : `/sign-in/two-factor?next=${encodeURIComponent(next)}`;
};

/**
 * Browser auth client, fetched on demand.
 *
 * It is only needed once someone acts on sign-in or sign-out, so it stays out of the initial bundle.
 * Call sites can warm it on hover so the click still feels instant. It talks to /api/auth on the page's
 * own origin. With two-factor on, a password sign-in answers `twoFactorRedirect` instead of a session,
 * and the browser goes to /sign-in/two-factor for the code (with the same `next`).
 */
export function getAuthClient(): Promise<AuthClient> {
  pending ??= Promise.all([import("better-auth/react"), import("better-auth/client/plugins")]).then(([react, plugins]) => react.createAuthClient({
    plugins: [plugins.twoFactorClient({ onTwoFactorRedirect: () => { window.location.assign(twoFactorPage(window.location.search)); } })],
  }));
  return pending;
}
