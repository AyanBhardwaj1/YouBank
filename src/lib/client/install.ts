/**
 * Installing YouBank as an app (src/app/manifest.ts). Chrome and Edge offer it with a
 * `beforeinstallprompt` event that can fire before anything on the page is ready, so the app shell
 * starts listening at once (listenForInstall) and Home's checklist asks later (canInstall, promptInstall).
 * Safari has no prompt: there the checklist links to the download page, which says how to add it.
 */
type PromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: PromptEvent | null = null;
const subs = new Set<() => void>();
const KEY = "yb-installed";

export function listenForInstall(): () => void {
  const onPrompt = (e: Event) => { e.preventDefault(); deferred = e as PromptEvent; subs.forEach((f) => f()); };
  const onInstalled = () => { deferred = null; try { localStorage.setItem(KEY, "1"); } catch { /* fine */ } subs.forEach((f) => f()); };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
}

export const onInstallChange = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
export const canInstall = () => deferred !== null;

/** Running as the installed app now, or installed from this browser before. */
export function isInstalled(): boolean {
  try {
    if (window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone) return true;
    return localStorage.getItem(KEY) === "1";
  } catch { return false; }
}

export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  if (outcome === "accepted") { try { localStorage.setItem(KEY, "1"); } catch { /* fine */ } }
  subs.forEach((f) => f());
  return outcome === "accepted";
}
