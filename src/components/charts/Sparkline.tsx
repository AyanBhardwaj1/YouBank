/** Tiny inline line chart: 2px stroke, area wash, end marker with surface ring. No axes. */
export function Sparkline({
  values, width = 120, height = 32, stroke = "var(--chart-1)", className = "",
}: { values: number[]; width?: number; height?: number; stroke?: string; className?: string }) {
  if (values.length < 2) return null;
  const min = Math.min(...values), max = Math.max(...values);
  const span = max - min || 1;
  const px = (i: number) => (i / (values.length - 1)) * (width - 8) + 4;
  const py = (v: number) => height - 4 - ((v - min) / span) * (height - 8);
  const d = values.map((v, i) => `${i ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(" ");
  const last = values.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden>
      <path d={`${d} L${px(last).toFixed(1)},${height} L${px(0).toFixed(1)},${height} Z`} fill={stroke} opacity={0.1} />
      <path d={d} fill="none" stroke={stroke} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={px(last)} cy={py(values[last])} r={4} fill={stroke} stroke="var(--panel)" strokeWidth={2} />
    </svg>
  );
}
