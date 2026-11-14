/** Prediction markets' shape while the page loads: the header, the tabs, the filters, then rows of markets. */
export default function Loading() {
  return (
    <div className="h-full overflow-hidden">
      <div className="mx-auto max-w-6xl p-3 sm:p-4">
        <div className="shimmer h-7 w-56 ctl" />
        <div className="mt-2 shimmer h-4 w-full max-w-xl ctl" />
        <div className="mt-4 flex gap-1">{[0, 1, 2, 3].map((i) => <div key={i} className="shimmer h-8 w-24 ctl" />)}</div>
        <div className="mt-3 shimmer h-10 w-full ctl" />
        <div className="mt-3 space-y-2">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="shimmer h-14 ctl" style={{ animationDelay: `${i * 60}ms` }} />)}</div>
      </div>
    </div>
  );
}
