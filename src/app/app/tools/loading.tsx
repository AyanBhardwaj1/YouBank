export default function Loading() {
  return (
    <div className="h-full overflow-hidden p-4">
      <div className="shimmer h-6 w-72 ctl" />
      <div className="mt-3 flex gap-1.5">{Array.from({ length: 6 }).map((_, i) => <div key={i} className="shimmer h-5 w-24 rounded-full" style={{ animationDelay: `${i * 60}ms` }} />)}</div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 12 }).map((_, i) => <div key={i} className="shimmer h-24 ctl" style={{ animationDelay: `${i * 50}ms` }} />)}
      </div>
    </div>
  );
}
