"use client";

/** Two-way sensitivity grid rendered as a heat-mapped table; the base case is outlined. */
export function Sensitivity({ rows, cols, values, rowLabel, colLabel, format, title, baseRow, baseCol }: { rows: string[]; cols: string[]; values: (number | null)[][]; rowLabel: string; colLabel: string; format: (v: number) => string; title?: string; baseRow?: number; baseCol?: number }) {
  const flat = values.flat().filter((v): v is number => v !== null && Number.isFinite(v));
  const lo = Math.min(...flat), hi = Math.max(...flat);
  const shade = (v: number | null) => {
    if (v === null || !Number.isFinite(v) || hi === lo) return "transparent";
    const t = (v - lo) / (hi - lo);
    return `color-mix(in srgb, var(--chart-1) ${Math.round(8 + t * 42)}%, transparent)`;
  };
  return (
    <figure className="m-0">
      {title && <figcaption className="mb-1 text-[11px] text-muted">{title}</figcaption>}
      <div className="overflow-auto">
        <table className="text-[11px]">
          <thead>
            <tr>
              <th className="px-2 py-1 text-left text-[10px] font-normal uppercase tracking-wider text-muted">{rowLabel} ↓ / {colLabel} →</th>
              {cols.map((c) => <th key={c} className="px-2 py-1 text-right text-[10px] font-normal uppercase tracking-wider text-muted">{c}</th>)}
            </tr>
          </thead>
          <tbody className="stagger">
            {rows.map((r, ri) => (
              <tr key={r}>
                <td className="px-2 py-1 text-muted">{r}</td>
                {cols.map((c, ci) => {
                  const v = values[ri]?.[ci] ?? null;
                  const base = ri === baseRow && ci === baseCol;
                  return (
                    <td key={c} className={`px-2 py-1 text-right ${base ? "font-semibold text-fg outline outline-1 outline-accent" : ""}`} style={{ background: shade(v) }}>
                      {v === null || !Number.isFinite(v) ? "n/a" : format(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
