"use client";

/**
 * Home's arrange mode: the page itself becomes the editor. Drag a widget onto another to move it (on the
 * Desk layout, dropping into the other column also changes its width), or use the arrows; make it wide
 * or narrow; take it off; put others on from the tray at the bottom. Every change applies and saves at
 * once (setDesk), and the widgets stay visible but inert while arranging, so a drag never opens a link.
 */
import { createContext, useContext, useState } from "react";
import { Icon } from "@/components/ui/Icon";
import { useWorkspace } from "../WorkspaceProvider";
import { WIDGET_HINT, WIDGET_LABEL, isWide, moveWidget, nudgeWidget, toggleWidget, widgetsFor, type HomeLayout, type WidgetId, type WidgetPref } from "@/lib/desk/desk";

type Arrange = { dragging: WidgetId | null; over: WidgetId | null; setDragging: (id: WidgetId | null) => void; setOver: (id: WidgetId | null) => void };
const Ctx = createContext<Arrange | null>(null);

export function ArrangeProvider({ on, children }: { on: boolean; children: React.ReactNode }) {
  const [dragging, setDragging] = useState<WidgetId | null>(null);
  const [over, setOver] = useState<WidgetId | null>(null);
  return <Ctx.Provider value={on ? { dragging, over, setDragging, setOver } : null}>{children}</Ctx.Provider>;
}

/** A widget on Home: as it is, or, while arranging, inside a frame with its controls. */
export function Slot({ w, layout, children }: { w: WidgetPref; layout: HomeLayout; children: React.ReactNode }) {
  const a = useContext(Ctx);
  const { desk, setDesk } = useWorkspace();
  if (!a) return <>{children}</>;
  const wide = isWide(w);
  // On the Desk layout each column is its own order; elsewhere it is one list.
  const among = (x: WidgetPref) => layout !== "desk" || isWide(x) === wide;
  const shown = desk.widgets.filter((x) => x.on && among(x));
  const idx = shown.findIndex((x) => x.id === w.id);
  const set = (widgets: WidgetPref[]) => setDesk({ widgets });
  const drop = (target: WidgetId) => {
    const from = a.dragging;
    a.setDragging(null); a.setOver(null);
    if (!from || from === target) return;
    let next = moveWidget(desk.widgets, from, target);
    // On the Desk layout the columns are the widths: dropping into the other column takes its width.
    if (layout === "desk") {
      const t = desk.widgets.find((x) => x.id === target)!;
      next = next.map((x) => (x.id === from ? { ...x, size: isWide(t) ? "wide" : "narrow" } : x));
    }
    set(next);
  };
  const btn = "grid h-6 w-6 place-items-center ctl text-muted hover:bg-elevated hover:text-fg disabled:opacity-30";
  return (
    <div
      draggable
      onDragStart={(e) => { e.dataTransfer.setData("text/plain", w.id); e.dataTransfer.effectAllowed = "move"; a.setDragging(w.id); }}
      onDragEnd={() => { a.setDragging(null); a.setOver(null); }}
      onDragOver={(e) => { if (a.dragging && a.dragging !== w.id) { e.preventDefault(); e.dataTransfer.dropEffect = "move"; if (a.over !== w.id) a.setOver(w.id); } }}
      onDragLeave={() => { if (a.over === w.id) a.setOver(null); }}
      onDrop={(e) => { e.preventDefault(); drop(w.id); }}
      className={`ctl outline-dashed outline-offset-2 transition ${a.over === w.id ? "outline-2 outline-accent" : "outline-1 outline-accent/40"} ${a.dragging === w.id ? "opacity-40" : ""}`}>
      <div className="mb-1.5 flex items-center gap-1 ctl border border-line-strong bg-raised px-1.5 py-1 text-[11.5px]">
        <Icon name="GripVertical" className="h-4 w-4 shrink-0 cursor-grab text-muted active:cursor-grabbing" aria-hidden />
        <span className="min-w-0 flex-1 truncate font-medium text-fg">{WIDGET_LABEL[w.id]}</span>
        <button type="button" className={btn} disabled={idx <= 0} onClick={() => set(nudgeWidget(desk.widgets, w.id, -1, among))} aria-label={`Move ${WIDGET_LABEL[w.id]} earlier`} title="Earlier"><Icon name="ArrowUp" className="h-3.5 w-3.5" /></button>
        <button type="button" className={btn} disabled={idx < 0 || idx >= shown.length - 1} onClick={() => set(nudgeWidget(desk.widgets, w.id, 1, among))} aria-label={`Move ${WIDGET_LABEL[w.id]} later`} title="Later"><Icon name="ArrowDown" className="h-3.5 w-3.5" /></button>
        {layout !== "focus" && (
          <button type="button" onClick={() => set(desk.widgets.map((x) => (x.id === w.id ? { ...x, size: wide ? "narrow" : "wide" } : x)))}
            className="ctl border border-line px-1.5 py-0.5 text-[10.5px] text-muted hover:text-fg" aria-label={`Make ${WIDGET_LABEL[w.id]} ${wide ? "narrow" : "wide"}`}>
            {wide ? "Wide" : "Narrow"}
          </button>
        )}
        <button type="button" className={btn} onClick={() => set(toggleWidget(desk.widgets, w.id, false))} aria-label={`Take ${WIDGET_LABEL[w.id]} off Home`} title="Take it off"><Icon name="X" className="h-3.5 w-3.5" /></button>
      </div>
      <div inert className="pointer-events-none select-none opacity-80">{children}</div>
    </div>
  );
}

/** The bar above the widgets while arranging, and the tray of widgets that are off. */
export function ArrangeBar({ onDone, layout }: { onDone: () => void; layout: HomeLayout }) {
  const { desk, setDesk, profile } = useWorkspace();
  const off = desk.widgets.filter((w) => !w.on);
  return (
    <div className="rise mb-4 ctl border border-accent/50 bg-accent-soft/40 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Icon name="LayoutGrid" className="h-4 w-4 text-accent" />
        <span className="text-[12.5px] font-medium text-fg">Arranging Home</span>
        <span className="text-[11.5px] text-muted max-sm:hidden">Drag a widget onto another to move it{layout === "desk" ? ", or into the other column" : ""}. Changes save as you go.</span>
        <span className="ml-auto flex gap-1.5">
          <button type="button" onClick={() => setDesk({ widgets: widgetsFor(layout, profile.role) })} className="ctl border border-line px-2.5 py-1 text-[11.5px] text-muted hover:text-fg">Reset</button>
          <button type="button" onClick={onDone} className="ctl bg-accent px-3 py-1 text-[11.5px] font-semibold text-accent-fg">Done</button>
        </span>
      </div>
      {off.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-muted">Add:</span>
          {off.map((w) => (
            <button key={w.id} type="button" title={WIDGET_HINT[w.id]} onClick={() => setDesk({ widgets: toggleWidget(desk.widgets, w.id, true) })}
              className="ctl flex items-center gap-1 border border-line bg-panel px-2 py-1 text-[11.5px] text-fg hover:border-accent/60">
              <Icon name="Plus" className="h-3 w-3 text-accent" />{WIDGET_LABEL[w.id]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
