import type { CompanyData } from "@/lib/types";

const BADGE: Record<string, string> = {
  "10-K": "bg-accent-soft text-accent",
  "10-K/A": "bg-accent-soft text-accent",
  "10-Q": "bg-info/15 text-info",
  "10-Q/A": "bg-info/15 text-info",
  "8-K": "bg-elevated text-muted",
  "DEF 14A": "bg-elevated text-muted",
};

export function FilScreen({ company: c }: { company: CompanyData }) {
  const edgar = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${c.cik}&type=&dateb=&owner=include&count=40`;
  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-line px-3 py-1.5 text-[11px]">
        <span className="text-muted">CIK <span className="num text-fg">{c.cik}</span> · FYE {c.fye} · {c.filings.length} recent</span>
        <a href={edgar} target="_blank" rel="noreferrer" className="text-info hover:underline">All filings on EDGAR ↗</a>
      </div>
      <ul className="min-h-0 flex-1 overflow-auto">
        {c.filings.map((f, i) => (
          <li key={i} className="flex items-center gap-3 border-b border-line/50 px-3 py-2 hover:bg-elevated/70">
            <span className={`num w-16 shrink-0 rounded px-1.5 py-0.5 text-center text-[10.5px] font-semibold ${BADGE[f.form] ?? "bg-elevated text-muted"}`}>{f.form}</span>
            <span className="num w-24 shrink-0 text-muted">{f.filed}</span>
            <span className="min-w-0 flex-1 truncate">{f.title}{f.period ? <span className="text-muted"> · period {f.period}</span> : null}</span>
            <a href={f.url} target="_blank" rel="noreferrer" className="text-[11px] text-muted hover:text-info">open ↗</a>
          </li>
        ))}
      </ul>
      <div className="border-t border-line px-3 py-1 text-[10px] text-muted">Live from SEC EDGAR submissions. AI highlights per filing come with the AI panel.</div>
    </div>
  );
}
