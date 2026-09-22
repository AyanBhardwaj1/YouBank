"use client";

import type { createAuthClient } from "@neondatabase/auth/next";

type AuthClient = ReturnType<typeof createAuthClient>;

let pending: Promise<AuthClient> | null = null;

/**
 * Browser auth client, fetched on demand.
 *
 * The Neon Auth SDK is ~400 KB and is only needed once someone acts on sign-in or sign-out, so it
 * stays out of the initial bundle. Call sites can warm it on hover so the click still feels instant.
 */
export function getAuthClient(): Promise<AuthClient> {
  pending ??= import("@neondatabase/auth/next").then((m) => m.createAuthClient());
  return pending;
}
