/**
 * The canvas editor's shape while it loads: the header, the block palette, a few blocks on the dotted
 * canvas and the inspector, shimmering (still under reduced motion). The route's loading.tsx shows it
 * while the page is fetched, and the editor until the canvas itself arrives, so one turns into the other.
 */
const BLOCKS = [{ left: "6%", top: "22%" }, { left: "37%", top: "44%" }, { left: "67%", top: "16%" }];

export function CanvasSkeleton() {
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true">
      <span role="status" className="sr-only">Loading the canvas</span>
      <div className="flex items-center gap-2 border-b border-line px-3 py-2" aria-hidden>
        <div className="shimmer h-6 w-6 ctl" />
        <div className="shimmer h-5 w-[min(340px,45%)] ctl" />
        <div className="shimmer h-3.5 w-12 ctl" />
        <div className="ml-auto flex items-center gap-1.5">
          {[0, 1, 2, 3].map((i) => <div key={i} className="shimmer hidden h-7 w-7 ctl sm:block" />)}
          <div className="shimmer h-7 w-[72px] ctl" />
        </div>
      </div>
      <div className="h-7 border-b border-line bg-elevated/60 md:hidden" aria-hidden />
      <div className="flex min-h-0 flex-1" aria-hidden>
        <div className="hidden w-[210px] shrink-0 flex-col gap-1.5 border-r border-line p-2 md:flex">
          <div className="shimmer mb-1.5 h-6 ctl" />
          {Array.from({ length: 8 }).map((_, i) => <div key={i} className="shimmer h-9 ctl" style={{ animationDelay: `${i * 70}ms` }} />)}
        </div>
        <div className="relative min-w-0 flex-1 overflow-hidden" style={{ backgroundImage: "radial-gradient(var(--line) 1px, transparent 1px)", backgroundSize: "22px 22px" }}>
          {BLOCKS.map((b, i) => <div key={i} className="shimmer absolute h-[104px] w-[min(244px,28%)] rounded-xl" style={{ ...b, animationDelay: `${i * 120}ms` }} />)}
        </div>
        <div className="hidden w-[340px] shrink-0 flex-col gap-2.5 border-l border-line p-3 lg:flex">
          <div className="flex gap-1"><div className="shimmer h-6 w-24 ctl" /><div className="shimmer h-6 w-32 ctl" /></div>
          {[0, 1, 2].map((i) => <div key={i} className="shimmer h-16 ctl" style={{ animationDelay: `${i * 90}ms` }} />)}
        </div>
      </div>
    </div>
  );
}
