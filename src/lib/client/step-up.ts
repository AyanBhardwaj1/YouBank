/**
 * The browser's half of step-up (src/lib/auth/step-up): `await ensureStepUp()` before a risky action
 * (saving broker keys, live trading consent, a brokerage or mailbox connection). It resolves true at once
 * when a code was entered on this browser in the last ten minutes; otherwise the one <StepUpHost> in the
 * app shell asks for the code (or, with 2FA off, says to turn it on in Settings → Security) and it
 * resolves true once a code was accepted, false when the person closed the dialog.
 *
 * `retryAfterStepUp(e)` covers a call the server still refused with 403 `two_factor_required` (the ten
 * minutes ran out in between): it asks again, and the caller retries once.
 */
import { ApiError, fetchJson } from "@/lib/client/errors";

export type StepUpState = { enabled: boolean; recent: boolean };
type Opener = (state: StepUpState) => Promise<boolean>;

let opener: Opener | null = null;

/** The host registers how to open the dialog; returns the unregister. */
export function registerStepUp(open: Opener): () => void {
  opener = open;
  return () => { if (opener === open) opener = null; };
}

/**
 * The base32 secret inside an otpauth:// link, in groups of four for typing into an authenticator app
 * by hand ("" when there is none). Pure.
 */
export function totpSecret(uri: string): string {
  const m = /[?&]secret=([A-Z2-7]+)/i.exec(uri);
  return m ? m[1].toUpperCase().replace(/(.{4})(?=.)/g, "$1 ") : "";
}

/** Whether a failed call was refused for want of a recent code. Pure. */
export const isStepUpRefusal = (e: unknown) => e instanceof ApiError && e.status === 403 && e.body.code === "two_factor_required";

/** Make sure a code was entered recently, asking for one when not. See the module comment. */
export async function ensureStepUp(): Promise<boolean> {
  let state: StepUpState;
  try {
    state = await fetchJson<StepUpState>("/api/security/step-up", { cache: "no-store" });
  } catch {
    // The check itself failed: let the action go to the server, which refuses with its own message.
    return true;
  }
  if (state.recent) return true;
  // Outside the app shell there is no dialog: the server's refusal message is what the person sees.
  if (!opener) return true;
  return opener(state);
}

/**
 * For API helpers: when `e` is the server asking for a code, ask for it and resolve true (retry the call
 * once); false otherwise, and the caller rethrows. Closing the dialog also answers false, so the
 * refusal's own message is shown.
 */
export async function retryAfterStepUp(e: unknown): Promise<boolean> {
  return isStepUpRefusal(e) && !!opener && ensureStepUp();
}
