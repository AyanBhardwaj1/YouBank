import type { NewStartup } from "../directory";
import { slugify } from "../directory";

/** Notable Thiel Fellows from Wikipedia's article (a seed; web discovery extends it). */
export async function fetchThiel(): Promise<NewStartup[]> {
  const res = await fetch("https://en.wikipedia.org/w/api.php?action=parse&page=Thiel_Fellowship&prop=wikitext&format=json", { headers: { "User-Agent": "YouBank directory (contact: see site)" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  const w = ((await res.json()) as { parse: { wikitext: { "*": string } } }).parse.wikitext["*"];
  const out: NewStartup[] = [];
  for (const m of w.matchAll(/\n\*\s*\[\[([^\]|]+)(?:\|[^\]]*)?\]\]([^\n]*)/g)) {
    const person = m[1].replace(/\s*\(.*?\)\s*$/, "").trim();
    let rest = m[2].replace(/<ref[\s\S]*?<\/ref>|<ref[^>]*\/>/g, "").replace(/\{\{[^}]*\}\}/g, "").replace(/&nbsp;/g, " ");
    const meta = /^\s*\(([^)]*)\)/.exec(rest); rest = rest.replace(/^\s*\([^)]*\)\s*[–—:-]?\s*/, "");
    const year = meta ? (/(20\d{2})/.exec(meta[1])?.[1] ?? "") : "";
    const country = meta ? meta[1].replace(/,?\s*20\d{2}.*$/, "").split(",").pop()?.trim().replace(/^U\.S\.?$|^US$/, "United States") ?? "" : "";
    const links = [...rest.matchAll(/\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g)].map((x) => x[1]);
    const company = links[0] ?? (/(?:founder|CEO|creator)[^,.;]*?\s(?:of|at)\s+([A-Z][\w.&' -]{1,40})/.exec(rest)?.[1] ?? "");
    const desc = rest.replace(/\[\[([^\]|]+)(?:\|([^\]]*))?\]\]/g, (_, a, b) => b || a).replace(/'''?/g, "").trim();
    out.push({
      source: "thiel", sourceId: slugify(person), name: company || person, oneLiner: desc.slice(0, 200), description: `${person}${year ? ` (Thiel Fellow ${year})` : ""}: ${desc}`, website: "", url: "https://en.wikipedia.org/wiki/Thiel_Fellowship", logo: "",
      program: "Thiel Fellowship", status: "", foundedYear: year ? Number(year) : null, founders: person, location: "", country, industries: [], tags: year ? [`Fellow ${year}`] : [], teamSize: null, fundingStage: "Thiel Fellowship grant", investors: ["Thiel Foundation"], raised: "$100K grant", raisedUsd: 100000, isHiring: 0, sourceDate: year ? `${year}-01-01` : "", data: null,
    });
  }
  return out;
}
