"use client";

import type { createAuthClient } from "better-auth/react";

type AuthClient = ReturnType<typeof createAuthClient>;

let pending: Promise<AuthClient> | null = null;

/**
 * Browser auth client, fetched on demand.
 *
 * It is only needed once someone acts on sign-in or sign-out, so it stays out of the initial bundle.
 * Call sites can warm it on hover so the click still feels instant. It talks to /api/auth on the page's
 * own origin.
 */
export function getAuthClient(): Promise<AuthClient> {
  pending ??= import("better-auth/react").then((m) => m.createAuthClient());
  return pending;
}
