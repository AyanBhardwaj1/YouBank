import { Sparkline } from "@/components/charts/Sparkline";

/** Stat tile: label, value, optional signed delta, optional sparkline. Value uses proportional figures. */
export function StatTile({
  label, value, delta, deltaGood, trend, hint,
}: { label: string; value: string; delta?: string; deltaGood?: boolean; trend?: number[]; hint?: string }) {
  return (
    <div className="flex min-w-0 flex-col justify-between rounded-md border border-line bg-elevated/60 px-2.5 py-2" title={hint}>
      <div className="text-[10.5px] uppercase tracking-wider text-muted">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div>
          <div className="text-[17px] font-semibold leading-none text-fg">{value}</div>
          {delta && (
            <div className={`mt-1 text-[11px] ${deltaGood === undefined ? "text-muted" : deltaGood ? "text-pos" : "text-neg"}`}>{delta}</div>
          )}
        </div>
        {trend && <Sparkline values={trend} width={64} height={24} stroke="var(--chart-1)" />}
      </div>
    </div>
  );
}
