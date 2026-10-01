import { EdgeSkeleton } from "@/components/edge/EdgeWorkspace";

/** Edge's shape while the page loads: the header, the view switcher, the modules, then the feed. */
export default function Loading() {
  return (
    <div className="h-full overflow-hidden">
      <div className="mx-auto max-w-[1400px] px-4 py-4 md:px-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div><div className="shimmer h-6 w-32 rounded" /><div className="shimmer mt-2 h-3.5 w-80 max-w-full rounded" /></div>
          <div className="shimmer h-8 w-[460px] max-w-full rounded-lg" />
        </div>
        <div className="mt-3 hidden grid-cols-4 gap-2 md:grid">{[0, 1, 2, 3].map((i) => <div key={i} className="shimmer h-[46px] rounded-lg" />)}</div>
        <EdgeSkeleton />
      </div>
    </div>
  );
}
