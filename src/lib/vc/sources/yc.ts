import type { NewStartup } from "../directory";

type YcApiCompany = {
  id: number; name: string; slug: string; website?: string; smallLogoUrl?: string; oneLiner?: string; longDescription?: string; teamSize?: number | null;
  url?: string; batch?: string; tags?: string[]; status?: string; industries?: string[]; regions?: string[]; locations?: string[]; isHiring?: boolean;
};

const GENERIC_REGION = /Remote|America \/ Canada|^Europe$|^Asia$|^Africa$|South America|Oceania|Middle East|Latin America/i;
const batchDate = (b: string) => { const m = /^([A-Z])(\d{2})$/.exec(b); if (!m) return ""; const mm = { W: "01", X: "03", S: "06", F: "09", P: "07" }[m[1]] ?? "06"; return `20${m[2]}-${mm}-01`; };

export async function fetchYc(): Promise<NewStartup[]> {
  const first = await fetch("https://api.ycombinator.com/v0.1/companies?page=1", { cache: "no-store" });
  if (!first.ok) throw new Error(`YC API ${first.status}`);
  const j = (await first.json()) as { companies: YcApiCompany[]; totalPages: number };
  const pages = [j.companies];
  const queue = Array.from({ length: Math.min(j.totalPages ?? 1, 400) - 1 }, (_, i) => i + 2);
  const fetchPage = async (p: number) => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const r = await fetch(`https://api.ycombinator.com/v0.1/companies?page=${p}`, { cache: "no-store" });
      if (r.ok) return ((await r.json()) as { companies: YcApiCompany[] }).companies;
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1) * (r.status === 429 ? 3 : 1)));
    }
    return [];
  };
  await Promise.all(Array.from({ length: 3 }, async () => { while (queue.length) pages.push(await fetchPage(queue.shift()!)); }));
  return pages.flat().map((c) => ({
    source: "yc", sourceId: String(c.id), name: c.name, oneLiner: c.oneLiner ?? "", description: c.longDescription ?? "", website: c.website ?? "", url: c.url ?? "", logo: c.smallLogoUrl ?? "",
    program: c.batch ? `YC ${c.batch}` : "YC", status: c.status ?? "", founders: "", location: (c.locations ?? []).join(", "), country: ((c.regions ?? []).find((r) => !GENERIC_REGION.test(r)) ?? "").replace(/^United States of America$/, "United States"),
    industries: c.industries ?? [], tags: c.tags ?? [], teamSize: c.teamSize ?? null, fundingStage: "Accelerator", investors: ["Y Combinator"], raised: "", raisedUsd: null, isHiring: c.isHiring ? 1 : 0,
    sourceDate: batchDate(c.batch ?? ""), data: null,
  }));
}
