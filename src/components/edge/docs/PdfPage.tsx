"use client";

/**
 * One page of a stored PDF, drawn with pdf.js at the width of its panel, with the cited words
 * highlighted where they sit on the page. The file is read in ranges, so opening page 140 of a data
 * room binder does not download the whole binder. pdf.js (its build with polyfills, for Safari and
 * older browsers) parses in a web worker, started once per page load the first time a PDF opens, so a
 * heavy page does not freeze the screen; where a worker cannot start, it runs in the page instead.
 */
import { useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { locateQuote } from "@/lib/edge/docs/text";

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
type PdfDoc = Awaited<ReturnType<PdfJs["getDocument"]>["promise"]>;

let lib: Promise<PdfJs> | null = null;
let port: Promise<Worker | null> | null = null;
const docs = new Map<string, Promise<PdfDoc>>();

/** pdf.js's worker, or null when it cannot start (a blocked or missing script) or stays silent for 30 s. */
function startWorker(): Promise<Worker | null> {
  return new Promise((resolve) => {
    let w: Worker;
    try { w = new Worker(new URL("pdfjs-dist/legacy/build/pdf.worker.min.mjs", import.meta.url), { type: "module" }); } catch { resolve(null); return; }
    // The worker posts "ready" once its code has loaded. pdf.js trusts a port it is handed without
    // waiting for that, so it is awaited here: a worker that never starts would hang every PDF.
    const done = (ok: boolean) => { clearTimeout(timer); w.removeEventListener("message", onMessage); w.removeEventListener("error", onError); if (!ok) w.terminate(); resolve(ok ? w : null); };
    const onMessage = (e: MessageEvent) => { if ((e.data as { action?: string } | null)?.action === "ready") done(true); };
    const onError = () => done(false);
    const timer = setTimeout(() => done(false), 30_000);
    w.addEventListener("message", onMessage);
    w.addEventListener("error", onError);
  });
}

function pdfjs(): Promise<PdfJs> {
  if (!lib) {
    lib = (async () => {
      port ??= startWorker();
      const [p, worker] = await Promise.all([import("pdfjs-dist/legacy/build/pdf.mjs"), port]);
      if (worker) p.GlobalWorkerOptions.workerPort = worker;
      else {
        // No worker: pdf.js runs on the main thread with its worker module imported here, as it did before.
        const m = await import("pdfjs-dist/legacy/build/pdf.worker.min.mjs");
        const g = globalThis as { pdfjsWorker?: { WorkerMessageHandler: unknown } };
        g.pdfjsWorker ??= { WorkerMessageHandler: m.WorkerMessageHandler };
      }
      return p;
    })();
    // A failed load (a dropped chunk) is tried again the next time a PDF opens; the worker is kept.
    lib.catch(() => { lib = null; });
  }
  return lib;
}

function open(url: string): Promise<PdfDoc> {
  let d = docs.get(url);
  if (!d) {
    d = pdfjs().then((p) => p.getDocument({ url, rangeChunkSize: 512 * 1024, disableAutoFetch: true, disableStream: true }).promise);
    d.catch(() => docs.delete(url));
    docs.set(url, d);
  }
  return d;
}

type Box = { x: number; y: number; w: number; h: number };

export function PdfPage({ url, page, quote }: { url: string; page: number; quote?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [at, setAt] = useState(Math.max(1, page || 1));
  const [count, setCount] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; boxes: Box[]; size: { w: number; h: number }; error?: string } | null>(null);
  const key = `${url}#${at}@${width}#${attempt}`;

  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!width) return;
    let live = true;
    let task: { cancel: () => void; promise: Promise<void> } | null = null;
    (async () => {
      const [p, doc] = await Promise.all([pdfjs(), open(url)]);
      if (!live) return;
      setCount(doc.numPages);
      const pg = await doc.getPage(Math.min(Math.max(1, at), doc.numPages));
      const base = pg.getViewport({ scale: 1 });
      const viewport = pg.getViewport({ scale: width / base.width });
      const c = canvas.current;
      if (!c || !live) return;
      const ratio = Math.min(2, window.devicePixelRatio || 1);
      c.width = Math.floor(viewport.width * ratio);
      c.height = Math.floor(viewport.height * ratio);
      c.style.width = `${viewport.width}px`;
      c.style.height = `${viewport.height}px`;
      task = pg.render({ canvas: c, viewport, transform: ratio !== 1 ? [ratio, 0, 0, ratio, 0, 0] : undefined });
      await task.promise;
      let boxes: Box[] = [];
      if (quote) {
        const content = await pg.getTextContent();
        const items = content.items.filter((i): i is typeof i & { str: string; transform: number[]; width: number } => "str" in i);
        boxes = locateQuote(items.map((i) => i.str), quote).map((n) => {
          const tx = p.Util.transform(viewport.transform, items[n].transform) as number[];
          const h = Math.hypot(tx[2], tx[3]);
          return { x: tx[4], y: tx[5] - h, w: items[n].width * viewport.scale, h: h * 1.15 };
        });
      }
      if (live) setState({ key, boxes, size: { w: viewport.width, h: viewport.height } });
    })().catch((e) => {
      if (live && (e as { name?: string })?.name !== "RenderingCancelledException") setState({ key, boxes: [], size: { w: 0, h: 0 }, error: "This PDF could not be drawn here; open the original instead." });
    });
    return () => { live = false; task?.cancel(); };
  }, [url, at, width, quote, key]);

  const ready = state?.key === key;
  const first = ready ? state.boxes[0] : undefined;
  const reduce = useReducedMotion();
  useEffect(() => {
    if (!first || !wrap.current) return;
    const scroller = wrap.current.closest("[data-viewer-scroll]");
    if (scroller) scroller.scrollTo({ top: Math.max(0, wrap.current.offsetTop + first.y - 120), behavior: reduce ? "auto" : "smooth" });
  }, [first, reduce]);

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2 text-[11.5px] text-muted">
        <button type="button" onClick={() => setAt((n) => Math.max(1, n - 1))} disabled={at <= 1} className="ctl flex items-center gap-1 border border-line px-2 py-1 hover:text-fg disabled:opacity-40"><ChevronLeft className="h-3.5 w-3.5" />Previous</button>
        <span className="num">Page {at}{count ? ` of ${count}` : ""}{at !== page && page ? <button type="button" onClick={() => setAt(page)} className="ml-2 text-accent hover:underline">back to the cited page</button> : null}</span>
        <button type="button" onClick={() => setAt((n) => (count ? Math.min(count, n + 1) : n + 1))} disabled={!!count && at >= count} className="ctl flex items-center gap-1 border border-line px-2 py-1 hover:text-fg disabled:opacity-40">Next<ChevronRight className="h-3.5 w-3.5" /></button>
      </div>
      <div ref={wrap} className={`relative w-full overflow-hidden rounded-md border border-line bg-white ${ready ? "" : "min-h-[16rem]"}`}>
        <canvas ref={canvas} className="block" role="img" aria-label={`Page ${at}`} />
        {ready && state.boxes.map((b, i) => (
          <span key={i} aria-hidden className="pointer-events-none absolute rounded-[2px] bg-yellow-300/45 mix-blend-multiply ring-1 ring-yellow-500/40" style={{ left: b.x - 1, top: b.y - 1, width: b.w + 2, height: b.h + 2 }} />
        ))}
        {!ready && <div className="absolute inset-0 flex items-center justify-center bg-bg/70 text-[12px] text-muted"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Opening the page…</div>}
        {ready && state.error && <p className="p-3 text-[12px] text-neg">{state.error} <button type="button" onClick={() => setAttempt((n) => n + 1)} className="text-accent hover:underline">Try again</button></p>}
      </div>
      {ready && quote && !state.error && !state.boxes.length && at === page && <p className="mt-1.5 text-[11px] text-muted">The quote is on this page but its layout kept Edge from marking it; it is shown above in full.</p>}
    </div>
  );
}
