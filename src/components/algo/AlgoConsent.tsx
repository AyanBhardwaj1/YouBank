"use client";

/**
 * The consents algo trading asks for at first use, stored with the text's version (and audited) by
 * /api/algo/consent: "how algo trading works" before the first strategy, connection or agent message,
 * and "the risks of real orders" before live trading. `useAlgoConsent()` returns `ask(kind)`, which
 * resolves true once the person accepted. (Autonomy is consented per strategy, with its typed phrase.)
 */
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";
import { Modal } from "@/components/copy/Consent";
import { Icon } from "@/components/ui/Icon";
import { CONSENTS } from "@/lib/algo/disclosures";
import { errorMessage, fetchJson } from "@/lib/client/errors";
import { json } from "./client";

type Kind = "terms" | "live";
type Ask = (kind: Kind) => Promise<boolean>;
const Ctx = createContext<Ask>(async () => false);
export const useAlgoConsent = () => useContext(Ctx);

export function AlgoConsentProvider({ children }: { children: ReactNode }) {
  const [kind, setKind] = useState<Kind | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const resolver = useRef<((ok: boolean) => void) | null>(null);
  const ask = useCallback<Ask>((k) => new Promise((resolve) => { resolver.current = resolve; setError(null); setKind(k); }), []);
  const close = (ok: boolean) => { resolver.current?.(ok); resolver.current = null; setKind(null); };
  const accept = async () => {
    if (!kind) return;
    setBusy(true); setError(null);
    try { await fetchJson("/api/algo/consent", json("POST", { kind })); close(true); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  };
  const c = kind ? CONSENTS[kind] : null;
  return (
    <Ctx.Provider value={ask}>
      {children}
      {c && (
        <Modal title={c.title} onClose={() => close(false)}>
          <ul className="space-y-2 text-[12.5px] leading-relaxed text-fg">
            {c.points.map((p) => <li key={p} className="flex gap-2"><Icon name="Shield" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />{p}</li>)}
          </ul>
          <p className="mt-3 text-[11px] text-muted">Version {c.version}. We keep a record that you accepted this text, and when.</p>
          {error && <p className="mt-2 text-[12px] text-neg">{error}</p>}
          <div className="mt-4 flex justify-end gap-2">
            <button onClick={() => close(false)} className="ctl border border-line px-3 py-2 text-[12.5px] text-muted hover:text-fg">Not now</button>
            <button onClick={accept} disabled={busy} className="ctl bg-accent px-3 py-2 text-[12.5px] font-semibold text-accent-fg disabled:opacity-60">{busy ? "Saving…" : "I understand"}</button>
          </div>
        </Modal>
      )}
    </Ctx.Provider>
  );
}
