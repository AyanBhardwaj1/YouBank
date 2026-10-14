/**
 * Job titles as departments and tells (E3). Rules first, by the words a title uses; whatever the rules
 * leave unsorted can be read by the small model in batches of 200 (about $0.002 per 1,000 titles), only
 * when an administrator has set EDGE_PULSE_TITLE_AI (platform spend, never a person's). Tells pick out
 * the hires that come before an announcement:
 *   ipo           SEC reporting, SOX, investor relations, equity plans: counted at private companies only
 *   integration   integration manager or office, TSA, carve-out, "Day 1"
 *   corpdev       corporate development, M&A
 *   restructuring restructuring, turnaround, interim CFO
 *   expansion     a posting in a country or metro the company has not hired in for six months
 *   buildout      three or more field or operations postings at a new site
 * The last two come from locations, not titles (pulse/ingest.ts). Pure.
 */
import type { Department, Tell } from "../series/metrics";

const RULES: [Department, RegExp][] = [
  ["legal", /\b(counsel|attorney|lawyer|paralegal|legal|compliance|privacy officer|regulatory affairs)\b/i],
  ["finance", /\b(accountant|accounting|controller|fp&a|financial (analyst|planning)|finance|tax|treasury|payroll|auditor|audit|billing|accounts (payable|receivable)|cfo)\b/i],
  ["people", /\b(recruit\w*|talent|human resources|hr\b|people (partner|operations|ops)|benefits|compensation analyst|learning and development)\b/i],
  ["data", /\b(data scien\w*|machine learning|ml engineer|analytics|data analyst|business intelligence|bi analyst|statistician|ai (researcher|scientist))\b/i],
  ["engineering", /\b(engineer\w*|developer|software|sre\b|devops|programmer|architect|firmware|qa\b|quality assurance|security analyst|it (support|specialist)|systems administrator)\b/i],
  ["product", /\b(product (manager|owner|lead|designer)|designer|ux\b|ui\b|user research\w*)\b/i],
  ["sales", /\b(account executive|sales|business development|bdr\b|sdr\b|account manager|partnerships?|customer success|solutions consultant|pre-?sales)\b/i],
  ["marketing", /\b(marketing|brand|content (writer|strategist|manager)|communications|public relations|pr manager|seo|growth marketer|social media)\b/i],
  ["field", /\b(technician|operator|driver|electrician|mechanic|welder|lineman|linemen|field (service|engineer|technician)|plant|maintenance|rig|installer|foreman|crew|machinist|assembler|warehouse associate)\b/i],
  ["operations", /\b(operations|supply chain|logistics|procurement|purchasing|facilities|warehouse|fulfillment|planner|scheduler|dispatcher|program manager|project manager)\b/i],
];

const TELL_RULES: [Tell, RegExp][] = [
  ["integration", /\b(integration (manager|lead|director|program|office|management)|imo\b|transition services|tsa\b|carve-?out|day ?1\b|post-?merger|separation (manager|lead|program))/i],
  ["corpdev", /\b(corporate development|corp\.? ?dev|m&a\b|mergers (and|&) acquisitions)/i],
  ["restructuring", /\b(restructuring|turnaround|interim cfo|chief restructuring)/i],
  ["ipo", /\b(sec reporting|sox\b|sarbanes|investor relations|ir (director|manager|lead)|equity plan|stock (plan|administration)|public company (readiness|reporting)|technical accounting)/i],
];

/** A title's department by the rules, or "other". Pure. */
export function departmentOf(title: string, department = ""): Department {
  const text = `${title} ${department}`;
  for (const [d, re] of RULES) if (re.test(title)) return d;
  for (const [d, re] of RULES) if (re.test(text)) return d;
  return "other";
}

/** The tells a title shows (IPO readiness only at a private company). Pure. */
export function tellsOf(title: string, opts: { privateCompany: boolean }): Tell[] {
  return TELL_RULES.filter(([t, re]) => re.test(title) && (t !== "ipo" || opts.privateCompany)).map(([t]) => t);
}

/** A location in a comparable form: "New York, NY" and "New York City" as "new york"; remote as "remote". Pure. */
export function metroOf(location: string): string {
  const l = location.toLowerCase().replace(/\(.*?\)/g, " ").trim();
  if (!l) return "";
  if (/\bremote\b|anywhere|work from home/.test(l)) return "remote";
  return l.split(/[,;/|-]/)[0].replace(/\bcity\b/, "").replace(/\s+/g, " ").trim().slice(0, 60);
}

/** Whether the model fallback may read unsorted titles (platform spend, an administrator's switch). */
export const titleAiOn = () => /^(1|true|yes|on)$/i.test(process.env.EDGE_PULSE_TITLE_AI?.trim() ?? "");
