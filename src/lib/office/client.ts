/**
 * The add-in's side of the YouBank API: requests carry the device token (Office blocks the site's
 * cookies in its frames), large bodies are gzipped, and agent runs stream as newline-delimited JSON.
 */
import { apiError } from "@/lib/client/errors";

const TOKEN_KEY = "youbank.office.token";

export const token = {
  get(): string | null { try { return localStorage.getItem(TOKEN_KEY); } catch { return null; } },
  set(t: string) { try { localStorage.setItem(TOKEN_KEY, t); } catch { /* storage blocked: the session lasts until the pane closes */ } memory = t; },
  clear() { try { localStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ } memory = null; },
};
let memory: string | null = null;
const current = () => token.get() ?? memory;

export class NotConnected extends Error {}

async function gzip(text: string): Promise<ArrayBuffer | null> {
  if (typeof CompressionStream === "undefined") return null;
  try { return await new Response(new Blob([text]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer(); } catch { return null; }
}

export async function request(path: string, init: { method?: string; json?: unknown; form?: FormData; signal?: AbortSignal } = {}): Promise<Response> {
  const headers = new Headers();
  const t = current();
  if (t) headers.set("authorization", `Bearer ${t}`);
  let body: BodyInit | undefined;
  if (init.form) body = init.form;
  else if (init.json !== undefined) {
    const text = JSON.stringify(init.json);
    headers.set("content-type", "application/json");
    const packed = text.length > 256_000 ? await gzip(text) : null;
    if (packed) { headers.set("x-youbank-encoding", "gzip"); body = packed; } else body = text;
  }
  const res = await fetch(path, { method: init.method ?? (body ? "POST" : "GET"), headers, body, signal: init.signal, cache: "no-store" });
  if (res.status === 401) throw new NotConnected("This add-in is not connected to YouBank.");
  return res;
}

export async function api<T>(path: string, init: Parameters<typeof request>[1] = {}): Promise<T> {
  const res = await request(path, init);
  if (!res.ok) throw await apiError(res);
  return (await res.json().catch(() => null)) as T;
}

/** Newline-delimited JSON events from a streaming response, as they arrive. */
export async function* ndjson<T>(res: Response): AsyncGenerator<T> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      // A malformed line (a proxy's note, a cut-off write) is skipped rather than ending the run.
      if (line) { try { yield JSON.parse(line) as T; } catch { /* skip */ } }
    }
  }
  if (buf.trim()) { try { yield JSON.parse(buf) as T; } catch { /* cut off */ } }
}

/**
 * Office.js, loaded after the page: it replaces the History API in some hosts, which the Next.js
 * router needs, so the originals are put back once it has loaded.
 */
let officeReady: Promise<{ host: string | null; platform: string | null }> | null = null;
export function loadOffice(): Promise<{ host: string | null; platform: string | null }> {
  if (officeReady) return officeReady;
  officeReady = new Promise((resolve) => {
    const w = window as Window & { Office?: typeof Office };
    const ready = () => {
      const timer = setTimeout(() => resolve({ host: null, platform: null }), 8000);
      w.Office!.onReady().then((info) => { clearTimeout(timer); resolve({ host: info.host ? String(info.host) : null, platform: info.platform ? String(info.platform) : null }); });
    };
    if (w.Office) { ready(); return; }
    const push = history.pushState, replace = history.replaceState;
    const s = document.createElement("script");
    s.src = "https://appsforoffice.microsoft.com/lib/1/hosted/office.js";
    s.onload = () => {
      if (typeof history.pushState !== "function") history.pushState = push;
      if (typeof history.replaceState !== "function") history.replaceState = replace;
      ready();
    };
    s.onerror = () => resolve({ host: null, platform: null });
    document.head.appendChild(s);
  });
  return officeReady;
}

/** Open a YouBank page in the person's browser (not inside the Office frame). */
export function openInBrowser(url: string) {
  try {
    if (typeof Office !== "undefined" && Office.context?.ui?.openBrowserWindow) { Office.context.ui.openBrowserWindow(url); return; }
  } catch { /* fall through */ }
  window.open(url, "_blank", "noopener");
}

/** Settings saved inside the workbook or presentation: which YouBank document it is linked to. */
export const docSettings = {
  get<T>(key: string): T | null { try { return (Office.context.document.settings.get(key) as T) ?? null; } catch { return null; } },
  set(values: Record<string, unknown>): Promise<void> {
    return new Promise((resolve) => {
      try {
        for (const [k, v] of Object.entries(values)) { if (v === null || v === undefined) Office.context.document.settings.remove(k); else Office.context.document.settings.set(k, v); }
        Office.context.document.settings.saveAsync(() => resolve());
      } catch { resolve(); }
    });
  },
};
