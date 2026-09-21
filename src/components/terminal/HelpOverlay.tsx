"use client";

import { FUNCTIONS, functionsForProfile } from "@/lib/functions";
import { useWorkspace } from "@/components/workspace/WorkspaceProvider";
import { toolsFor } from "@/lib/workflows/registry";

/** Keyboard and command reference, opened with "?" in the terminal. */
export function HelpOverlay({ onClose }: { onClose: () => void }) {
  const { profile, config } = useWorkspace();
  const fns = functionsForProfile(profile);
  const tools = toolsFor(profile).slice(0, 8);
  const keys: [string, string][] = [
    ["/", "focus the command bar"], ["Cmd or Ctrl + K", "focus and select the command bar"], ["Tab", "complete the highlighted suggestion"],
    ["Enter", "run the command"], ["↑ ↓", "move through suggestions"], ["Esc", "close a menu, restore a maximized panel"], ["?", "this reference"],
  ];
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-auto bg-bg/70 p-6 backdrop-blur-sm" onClick={onClose} role="presentation">
      <div className="rise float w-full max-w-[860px] panel p-5" role="dialog" aria-modal="true" aria-label="Commands and keys" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-[16px] font-semibold">Commands and keys</h2>
          <button type="button" onClick={onClose} className="text-[11px] text-muted hover:text-fg">close (Esc)</button>
        </div>
        <div className="mt-4 grid gap-5 md:grid-cols-2">
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted">Command bar</div>
            <ul className="mt-2 space-y-1 text-[12px]">
              <li><span className="num text-accent">{config.watchlist[0] ?? "SNOW"} COMPS</span> a ticker and a function</li>
              <li><span className="num text-accent">CAP</span> a function alone uses the active ticker</li>
              <li><span className="num text-accent">CCL</span> a ticker alone opens its description</li>
              <li><span className="num text-accent">{config.watchlist[0] ?? "SNOW"} TOOL dcf</span> run a tool in a panel</li>
            </ul>
            <div className="mt-4 text-[10.5px] uppercase tracking-wider text-muted">Keys</div>
            <dl className="mt-2 space-y-1 text-[12px]">
              {keys.map(([k, v]) => <div key={k} className="flex gap-2"><dt className="w-[130px] shrink-0"><kbd className="ctl border border-line bg-elevated px-1.5 py-0.5 text-[10.5px]">{k}</kbd></dt><dd className="text-muted">{v}</dd></div>)}
            </dl>
          </div>
          <div>
            <div className="text-[10.5px] uppercase tracking-wider text-muted">Functions for your seat</div>
            <dl className="mt-2 grid grid-cols-[62px_1fr] gap-x-2 gap-y-1 text-[12px]">
              {fns.map((f) => <div key={f} className="col-span-2 grid grid-cols-subgrid"><dt className="num font-semibold text-accent">{f}</dt><dd className="text-muted">{FUNCTIONS[f].hint}</dd></div>)}
            </dl>
            <div className="mt-4 text-[10.5px] uppercase tracking-wider text-muted">Tools you can run in a panel</div>
            <ul className="mt-2 space-y-0.5 text-[11.5px]">
              {tools.map((t) => <li key={t.id} className="flex gap-2"><span className="num shrink-0 text-accent">{t.id}</span><span className="truncate text-muted">{t.title}</span></li>)}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
