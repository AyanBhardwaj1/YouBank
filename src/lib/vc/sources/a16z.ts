import type { NewStartup } from "../directory";

type A16zCompany = { id: string; title: string; web?: string; logo?: string; year_founded?: string; stages?: string[]; invest_date?: string; exit_date?: string; founders?: string; overview?: string; ticker_symbol?: string; acquirer?: string; socials?: { url: string }[] };

/** The a16z portfolio page assigns its whole dataset to a JavaScript global; parse it from the HTML. */
export async function fetchA16z(): Promise<NewStartup[]> {
  const res = await fetch("https://a16z.com/portfolio/", { headers: { "User-Agent": "Mozilla/5.0 (YouBank directory)" }, cache: "no-store" });
  if (!res.ok) throw new Error(`a16z ${res.status}`);
  const html = await res.text();
  const m = /window\.a16z_portfolio_companies\s*=\s*(\[[\s\S]*?\]);\s*(?:\n|window|<\/script>)/.exec(html);
  if (!m) throw new Error("a16z portfolio data not found in page");
  const arr = JSON.parse(m[1]) as A16zCompany[];
  return arr.map((c) => ({
    source: "a16z", sourceId: c.id, name: c.title, oneLiner: (c.overview ?? "").split(/(?<=\.)\s/)[0]?.slice(0, 200) ?? "", description: c.overview ?? "", website: c.web ?? "", url: "https://a16z.com/portfolio/",
    logo: c.logo ?? "", program: "a16z", status: c.acquirer ? `Acquired by ${c.acquirer}` : c.ticker_symbol ? `Public (${c.ticker_symbol})` : "Active", foundedYear: /^\d{4}$/.test(c.year_founded ?? "") ? Number(c.year_founded) : null,
    founders: c.founders ?? "", location: "", country: "", industries: [], tags: (Array.isArray(c.stages) ? c.stages : []).filter(Boolean), teamSize: null, fundingStage: (Array.isArray(c.stages) ? c.stages : []).join(", "), investors: ["a16z"], raised: "", raisedUsd: null, isHiring: 0,
    sourceDate: /^\d{4}-\d{2}-\d{2}$/.test(c.invest_date ?? "") ? c.invest_date! : /^\d{4}$/.test(c.year_founded ?? "") ? `${c.year_founded}-01-01` : "", data: { ticker: c.ticker_symbol, acquirer: c.acquirer, socials: Array.isArray(c.socials) ? c.socials.map((s) => s?.url).filter(Boolean) : [] },
  }));
}
