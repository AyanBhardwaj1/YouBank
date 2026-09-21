export default function Loading() {
  return (
    <div className="h-full overflow-hidden p-5">
      <div className="mx-auto max-w-[1280px]">
        <div className="shimmer h-7 w-64 ctl" />
        <div className="mt-2 shimmer h-4 w-80 ctl" />
        <div className="mt-6 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="shimmer h-20 ctl" style={{ animationDelay: `${i * 70}ms` }} />)}
        </div>
        <div className="mt-4 shimmer h-52 ctl" />
      </div>
    </div>
  );
}
