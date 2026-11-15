"use client";

/**
 * The browser half of the bot check (src/lib/auth/bot.ts): Cloudflare Turnstile when its site key is set, and
 * a honeypot field always. `useBotGuard()` gives the widget to render, whether the form may be sent yet, and
 * the headers to send with it. Turnstile's script loads only on the forms that use it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

const SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ?? "";
const SCRIPT = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type Turnstile = { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void; remove: (id: string) => void };
declare global { interface Window { turnstile?: Turnstile } }

let loading: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SCRIPT; s.async = true; s.defer = true;
    s.onload = () => resolve(); s.onerror = () => { loading = null; reject(new Error("Turnstile did not load")); };
    document.head.appendChild(s);
  });
  return loading;
}

export function useBotGuard(active = true) {
  const [token, setToken] = useState("");
  const [failed, setFailed] = useState(false);
  const honeypot = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const on = active && !!SITE_KEY;

  useEffect(() => {
    if (!on || !box.current) return;
    let gone = false;
    loadScript().then(() => {
      if (gone || !box.current || !window.turnstile) return;
      widget.current = window.turnstile.render(box.current, {
        sitekey: SITE_KEY, theme: "auto", size: "flexible", appearance: "interaction-only",
        callback: (t: string) => { setToken(t); setFailed(false); },
        "expired-callback": () => setToken(""),
        "error-callback": () => { setToken(""); setFailed(true); },
      });
    }).catch(() => setFailed(true));
    return () => { gone = true; if (widget.current) window.turnstile?.remove(widget.current); widget.current = null; };
  }, [on]);

  /** After a refused send: a token is good once, so get a fresh one. */
  const reset = useCallback(() => { setToken(""); if (widget.current) window.turnstile?.reset(widget.current); }, []);

  const headers = (): Record<string, string> => ({
    ...(honeypot.current?.value ? { "x-yb-hp": honeypot.current.value.slice(0, 100) } : {}),
    ...(on && token ? { "x-turnstile-token": token } : {}),
  });

  const fields = (
    <>
      {/* Never shown to people or read out by screen readers; bots that fill every field fill this one too. */}
      <div aria-hidden="true" style={{ position: "absolute", left: "-10000px", width: 1, height: 1, overflow: "hidden" }}>
        <label>Leave this empty<input ref={honeypot} type="text" name="website" tabIndex={-1} autoComplete="off" defaultValue="" /></label>
      </div>
      {on && <div ref={box} className="min-h-0" />}
      {on && failed && <p role="alert" className="text-[11px] text-neg">The check that you are a person did not load. Reload the page and try again.</p>}
    </>
  );

  return { fields, ready: !on || !!token, headers, reset, on };
}
