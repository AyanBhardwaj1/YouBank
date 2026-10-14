/**
 * The signals the series store holds (F2), with what each means and where it comes from. One registry, so
 * the store, the Pulse panel, the canvas and the audit trail describe a metric the same way. Department
 * and tell metrics are families: `jobs.dept.engineering`, `jobs.tell.ipo`. Pure, safe on the client.
 */

export type Cadence = "weekly" | "monthly";
export type MetricDef = { label: string; unit: string; cadence: Cadence; family: string; source: string; better?: "up" | "down" };

/** Each source as it is cited: name, home page, licence and terms. */
export const SOURCES: Record<string, { name: string; url: string; license: string }> = {
  greenhouse: { name: "Greenhouse job board API", url: "https://developers.greenhouse.io/job-board.html", license: "Public job-board API; counts and titles only, linked back" },
  lever: { name: "Lever postings API", url: "https://github.com/lever/postings-api", license: "Public postings API; counts and titles only, linked back" },
  ashby: { name: "Ashby job board API", url: "https://developers.ashbyhq.com/docs/public-job-posting-api", license: "Public job-board API; counts and titles only, linked back" },
  wikimedia: { name: "Wikimedia pageviews API", url: "https://wikimedia.org/api/rest_v1/", license: "CC0 (Wikimedia analytics data)" },
  usaspending: { name: "USAspending.gov API", url: "https://api.usaspending.gov/", license: "Public domain (US government data)" },
  warn: { name: "State WARN notices", url: "https://www.dol.gov/agencies/eta/layoffs/warn", license: "Public records (state labour departments)" },
  patentsview: { name: "PatentsView PatentSearch API", url: "https://search.patentsview.org/docs/", license: "CC BY 4.0 (USPTO PatentsView)" },
  odds: { name: "Edge Deal Radar", url: "", license: "YouBank model output on public data" },
};

const W = (label: string, unit: string, family: string, source: string, better?: "up" | "down"): MetricDef => ({ label, unit, cadence: "weekly", family, source, better });
const M = (label: string, unit: string, family: string, source: string): MetricDef => ({ label, unit, cadence: "monthly", family, source });

export const METRICS: Record<string, MetricDef> = {
  "jobs.open": W("Open job postings", "postings", "jobs", "ats"),
  "jobs.new": W("New postings this week", "postings", "jobs", "ats"),
  "wiki.views": W("Wikipedia page views", "views a week", "attention", "wikimedia"),
  "usasp.obligated": M("Federal award obligations", "USD", "contracts", "usaspending"),
  "usasp.awards": M("New federal awards", "awards", "contracts", "usaspending"),
  "warn.employees": M("Employees in WARN layoff notices", "employees", "layoffs", "warn"),
  "patents.grants": M("Patents granted", "patents", "patents", "patentsview"),
  "patents.apps": M("Patent applications published", "applications", "patents", "patentsview"),
  "odds.target12": W("12-month sale odds (Deal Radar)", "probability", "odds", "odds"),
};

export const DEPARTMENTS = ["engineering", "sales", "operations", "finance", "legal", "people", "marketing", "product", "data", "field", "other"] as const;
export type Department = (typeof DEPARTMENTS)[number];
export const TELLS = ["ipo", "integration", "corpdev", "restructuring", "expansion", "buildout"] as const;
export type Tell = (typeof TELLS)[number];
export const TELL_LABEL: Record<Tell, string> = {
  ipo: "IPO readiness", integration: "M&A integration", corpdev: "Corporate development", restructuring: "Restructuring", expansion: "Geographic expansion", buildout: "Plant build-out",
};

/** A metric's definition, families included (`jobs.dept.<d>`, `jobs.tell.<t>`). Pure. */
export function metricDef(metric: string): MetricDef | null {
  if (METRICS[metric]) return METRICS[metric];
  const dept = /^jobs\.dept\.([a-z]+)$/.exec(metric);
  if (dept) return W(`Open postings: ${dept[1]}`, "postings", "jobs.dept", "ats");
  const tell = /^jobs\.tell\.([a-z]+)$/.exec(metric);
  if (tell) return W(`${TELL_LABEL[tell[1] as Tell] ?? tell[1]} postings`, "postings", "jobs.tell", "ats");
  return null;
}

/** How long each cadence is kept in Postgres: three years of weekly points, five of monthly (series/store.ts prunes). */
export const RETAIN_DAYS: Record<Cadence, number> = { weekly: 3 * 365, monthly: 5 * 365 };
