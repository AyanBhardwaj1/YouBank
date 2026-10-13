"use client";

/**
 * The Edge beta switch, in Settings (Labs) and on the Edge page before it is on. Turning it on pins the
 * tab, seeds three watches from the person's desk and starts looking at them.
 */
import { useRouter } from "next/navigation";
import { Loader2, Radar as RadarIcon } from "lucide-react";
import { useState } from "react";
import { post } from "./client";
import { errorMessage } from "@/lib/client/errors";

export function BetaToggle({ on }: { on: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const flip = async (next: boolean) => {
    setBusy(true); setError(null);
    try {
      await post("/api/edge", { beta: next });
      // Re-render the layout (the tab appears or goes) and this page (the intro becomes Edge).
      router.refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally { setBusy(false); }
  };
  return (
    <div>
      <button type="button" role="switch" aria-checked={on} disabled={busy} onClick={() => flip(!on)}
        className={`ctl inline-flex items-center gap-2 px-3 py-1.5 text-[12.5px] font-semibold transition disabled:opacity-60 ${on ? "border border-line text-muted hover:text-fg" : "bg-accent text-accent-fg"}`}>
        {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RadarIcon className="h-3.5 w-3.5" />}
        {on ? "Turn off the Edge beta" : "Try the Edge beta"}
      </button>
      {error && <p className="mt-1.5 text-[11.5px] text-neg">{error}</p>}
    </div>
  );
}

export function EdgeIntro() {
  return (
    <div className="h-full overflow-auto">
      <div className="mx-auto max-w-[880px] px-5 py-10">
        <div className="flex items-center gap-2">
          <RadarIcon className="h-6 w-6 text-accent" />
          <h1 className="text-[26px] font-semibold tracking-tight">Edge</h1>
          <span className="rounded-full border border-accent/40 bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">Beta</span>
        </div>
        <p className="mt-3 max-w-[64ch] text-[14px] leading-relaxed text-muted">
          An alternative-data edge on the companies and places you follow. Edge compares satellite imagery of their plants a year apart and shows you what was built, cleared or filled; draws what a deal would combine on the map, with the counties a regulator would look at; and, next, reads documents, graphs and simulated scenarios the same way.
        </p>
        <ul className="mt-5 grid gap-2 sm:grid-cols-2">
          {[
            ["Earth · GeoAI", "Before-and-after satellite views of the plants you watch, with the change outlined and explained."],
            ["Deal what-ifs", "Any combination of companies on the map: overlaps, county concentration and likely divestitures."],
            ["Your feed", "Ranked by what you watch, how big and new a change is, and how sure Edge is; tune the blend yourself."],
            ["Every source", "Each finding lists where its data came from, its license and method, and exports an audit trail."],
          ].map(([k, v]) => (
            <li key={k} className="panel px-3 py-2.5"><div className="text-[12.5px] font-semibold">{k}</div><div className="mt-0.5 text-[12px] text-muted">{v}</div></li>
          ))}
        </ul>
        <div className="mt-6"><BetaToggle on={false} /></div>
        <p className="mt-3 text-[11.5px] text-faint">Free during the beta. Up to five watches each; Edge&apos;s AI use counts toward your daily AI limit. You can turn it off any time in Settings, under Labs.</p>
      </div>
    </div>
  );
}
