import { cryptoRaises, type Raise } from "@/lib/crypto/deals";
import type { NewStartup } from "../directory";
import { slugify } from "../directory";

const money = (v: number) => (v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v / 1e3)}K`);

/**
 * Crypto projects from DefiLlama's raises database: one directory entry per project, with every
 * disclosed round summed, the latest round as its stage, and the union of its investors. Pure, for
 * tests. Amounts are as announced; undisclosed amounts count as zero.
 */
export function raisesToStartups(raises: Raise[], days = 0, now = new Date()): NewStartup[] {
  const cut = days > 0 ? new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10) : "";
  const byProject = new Map<string, Raise[]>();
  for (const r of raises) { const k = slugify(r.name); if (!k) continue; (byProject.get(k) ?? byProject.set(k, []).get(k)!).push(r); }
  const out: NewStartup[] = [];
  for (const [id, rs] of byProject) {
    rs.sort((a, b) => (a.date < b.date ? 1 : -1));
    const latest = rs[0];
    if (cut && latest.date < cut) continue;
    const total = rs.reduce((s, r) => s + (r.amountUsd ?? 0), 0);
    const investors = [...new Set(rs.flatMap((r) => [...r.leads, ...r.others]))].slice(0, 30);
    const rounds = rs.slice(0, 6).map((r) => `${r.date}: ${r.round || "round"}${r.amountUsd ? ` ${money(r.amountUsd)}` : ""}${r.leads.length ? ` led by ${r.leads.join(", ")}` : ""}`);
    out.push({
      source: "defillama", sourceId: id, name: latest.name, oneLiner: [latest.category || latest.sector, latest.chains.slice(0, 3).join(", ")].filter(Boolean).join(" on ").slice(0, 200),
      description: `Crypto project. Disclosed rounds: ${rounds.join("; ")}.`, website: "", url: /^https?:\/\//.test(latest.source) ? latest.source : "https://defillama.com/raises", logo: "",
      program: "Crypto", status: "", foundedYear: null, founders: "", location: "", country: "", industries: [latest.category || latest.sector || "Crypto"].filter(Boolean), tags: latest.chains.slice(0, 6),
      teamSize: null, fundingStage: latest.round, investors, raised: total ? money(total) : "", raisedUsd: total || null, isHiring: 0, sourceDate: latest.date,
      data: { rounds: rs.slice(0, 12).map((r) => ({ date: r.date, round: r.round, amountUsd: r.amountUsd, valuationUsd: r.valuationUsd, leads: r.leads, source: r.source })) },
    });
  }
  return out;
}

/** The directory's crypto source: free DefiLlama raises (the open API, never the paid one). */
export async function fetchDefiLlama(days = 0): Promise<NewStartup[]> {
  return raisesToStartups(await cryptoRaises(false), days);
}
