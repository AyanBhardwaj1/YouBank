/**
 * The contract every calendar source implements, and the HTTP plumbing they share. Server only.
 *
 * Adapters take their `fetch` as a parameter. In the app that is the real fetch (wrapped by
 * net.ts's guard for servers people type in); in scripts/test-calendar.ts it replays recorded
 * responses, which is how the adapters are tested without a network or an OAuth app.
 */
import type { ChangeScope, EventDraft, EventRef, Interval, ProviderId, RemoteCalendar, RemoteEvent, SyncPage, WriteOptions } from "./types";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

/** What can change on an existing event. `shiftMs` moves a whole series by the same amount. */
export type ProviderPatch = {
  title?: string;
  description?: string;
  location?: string;
  start?: Date;
  end?: Date;
  shiftMs?: number;
  attendees?: { email: string; name?: string }[];
  videoUrl?: string;
};

export type CalendarRef = { remoteId: string; timezone: string };

export interface CalendarProvider {
  readonly id: ProviderId;
  /** False for ICS subscriptions. */
  readonly writable: boolean;
  listCalendars(): Promise<RemoteCalendar[]>;
  /** A null token means a full read of `window`; otherwise the changes since that token. */
  listEvents(cal: CalendarRef, window: Interval, syncToken: string | null): Promise<SyncPage>;
  createEvent(cal: CalendarRef, draft: EventDraft, opts: WriteOptions): Promise<RemoteEvent>;
  updateEvent(cal: CalendarRef, ref: EventRef, patch: ProviderPatch, opts: WriteOptions & { scope: ChangeScope }): Promise<RemoteEvent | null>;
  deleteEvent(cal: CalendarRef, ref: EventRef, opts: WriteOptions & { scope: ChangeScope }): Promise<void>;
  /** Busy intervals across these calendars. */
  freeBusy(cals: CalendarRef[], window: Interval): Promise<Interval[]>;
}

/** Push notifications, where the provider has them (Google watch channels, Graph subscriptions). */
export type PushChannel = { id: string; resourceId: string; expiresAt: string };

export interface PushCapable {
  watch(cal: CalendarRef, address: string, token: string): Promise<PushChannel>;
  renew?(channel: PushChannel, cal: CalendarRef): Promise<PushChannel>;
  unwatch(channel: PushChannel): Promise<void>;
}

export const canPush = (p: CalendarProvider): p is CalendarProvider & PushCapable => typeof (p as Partial<PushCapable>).watch === "function";

/**
 * A provider refused or failed. `kind` drives what happens next: `auth` marks the account for
 * reconnecting, `gone` drops a stale sync token and reads the window afresh, `conflict` asks the
 * person to refresh. `httpStatus` is the provider's status, deliberately not `status`, so a Google
 * 401 never reaches the browser as "sign in to YouBank".
 */
export class ProviderError extends Error {
  constructor(message: string, readonly kind: "auth" | "gone" | "conflict" | "notfound" | "readonly" | "other", readonly httpStatus = 0) {
    super(message);
    this.name = "ProviderError";
  }
}

export function kindForStatus(status: number): ProviderError["kind"] {
  if (status === 401) return "auth";
  if (status === 410) return "gone";
  if (status === 409 || status === 412) return "conflict";
  if (status === 404) return "notfound";
  return "other";
}

/** A JSON API call with a timeout and a plain error. `label` names the provider for people. */
export async function jsonCall<T>(f: Fetch, label: string, url: string, init: RequestInit = {}): Promise<T> {
  const res = await f(url, { signal: AbortSignal.timeout(30_000), ...init });
  if (res.status === 204) return undefined as T;
  const text = await res.text().catch(() => "");
  if (!res.ok) {
    let detail = "";
    try {
      const j = JSON.parse(text) as { error?: { message?: string } | string; error_description?: string };
      detail = typeof j.error === "string" ? (j.error_description ?? j.error) : (j.error?.message ?? "");
    } catch { detail = text.slice(0, 200); }
    throw new ProviderError(`${label} answered ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}`, kindForStatus(res.status), res.status);
  }
  return (text ? JSON.parse(text) : undefined) as T;
}

/** OAuth token endpoint response. */
export type TokenResponse = { access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string };

export async function tokenRequest(f: Fetch, label: string, endpoint: string, body: Record<string, string>): Promise<TokenResponse> {
  const res = await f(endpoint, {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(body).toString(), signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as (TokenResponse & { error?: string; error_description?: string }) | null;
  if (!res.ok || !json?.access_token) {
    // invalid_grant is a revoked or expired refresh token: only reconnecting fixes it.
    const kind = json?.error === "invalid_grant" || res.status === 400 || res.status === 401 ? "auth" : "other";
    throw new ProviderError(`${label} would not issue a token: ${(json?.error_description ?? json?.error ?? String(res.status)).slice(0, 200)}`, kind, res.status);
  }
  return json;
}

/** A readable email address out of an id_token, without verifying it (it came straight from the token endpoint over TLS). */
export function emailFromIdToken(idToken: string | undefined): string {
  if (!idToken) return "";
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { email?: string; preferred_username?: string };
    return (payload.email ?? payload.preferred_username ?? "").toLowerCase();
  } catch {
    return "";
  }
}

/** Busy only: confirmed or tentative, marked busy, not all-day. */
export const blocksTime = (e: Pick<RemoteEvent, "status" | "busy" | "allDay">) => e.status !== "cancelled" && e.busy && !e.allDay;

export const readOnlyError = () => new ProviderError("This calendar is a read-only subscription. Change the event where it was created.", "readonly", 0);
