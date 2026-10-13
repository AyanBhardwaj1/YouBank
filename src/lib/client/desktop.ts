/**
 * The site running inside YouBank for desktop. The app loads this site in its main window and lets it
 * call exactly three native commands (desktop/src-tauri/capabilities/remote.json): who the app is, open
 * quick ask, open the desktop agent's settings. Nothing else on the computer is reachable from here,
 * by design. In an ordinary browser every helper is a no-op.
 */

export type DesktopInfo = { version: string; platform: "windows" | "macos" | "linux" | string; connected: boolean };

type Internals = { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };

const internals = (): Internals | null =>
  typeof window === "undefined" ? null : ((window as unknown as { __TAURI_INTERNALS__?: Internals }).__TAURI_INTERNALS__ ?? null);

/** Whether this page is inside the desktop app. */
export const inDesktopApp = () => internals() !== null;

/** The app's version and whether this computer is connected to an account; null in a browser. */
export async function desktopInfo(): Promise<DesktopInfo | null> {
  const t = internals();
  if (!t) return null;
  try { return (await t.invoke("desktop_info")) as DesktopInfo; } catch { return null; }
}

/** Open the desktop app's own settings (files, Office, alerts, scheduled tasks). */
export async function openDesktopAgent(section?: "account" | "files" | "office" | "alerts" | "tasks"): Promise<void> {
  await internals()?.invoke("open_agent", { section: section ?? null }).catch(() => undefined);
}

export type Os = "windows" | "macos" | "linux" | "other";

/** The visitor's operating system, from what the browser reports. Pure given its inputs. */
export function detectOs(ua: string, platformHint = ""): Os {
  const s = `${platformHint} ${ua}`.toLowerCase();
  if (/iphone|ipad|android/.test(s)) return "other";
  if (/windows|win32|win64/.test(s)) return "windows";
  if (/mac/.test(s)) return "macos";
  if (/linux|x11|cros/.test(s)) return "linux";
  return "other";
}
