import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { requireDb, schema } from "@/db";

export type StartupRow = typeof schema.startups.$inferSelect;
export type NewStartup = Omit<typeof schema.startups.$inferInsert, "id" | "syncedAt">;

export const SOURCES = { yc: "Y Combinator", a16z: "a16z portfolio", thiel: "Thiel Fellowship", hn: "Show HN", formd: "SEC Form D", web: "Web discovery", user: "Added by users" } as const;
export type SourceId = keyof typeof SOURCES;

export const slugify = (s: string) => s.toLowerCase().replace(/https?:\/\/(www\.)?/, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);

/** Insert or update by (source, source_id). Chunked. Returns the number of rows written. */
export async function upsertStartups(rows: NewStartup[]): Promise<number> {
  const db = requireDb();
  const seen = new Set<string>();
  const clean = rows.filter((r) => { const k = `${r.source}|${r.sourceId}`; if (seen.has(k) || !r.name) return false; seen.add(k); return true; });
  for (let i = 0; i < clean.length; i += 200) {
    const chunk = clean.slice(i, i + 200).map((r) => ({ ...r, syncedAt: new Date() }));
    await db.insert(schema.startups).values(chunk).onConflictDoUpdate({
      target: [schema.startups.source, schema.startups.sourceId],
      set: {
        name: sql`excluded.name`, oneLiner: sql`excluded.one_liner`, description: sql`excluded.description`, website: sql`excluded.website`, url: sql`excluded.url`, logo: sql`excluded.logo`,
        program: sql`excluded.program`, status: sql`excluded.status`, foundedYear: sql`excluded.founded_year`, founders: sql`excluded.founders`, location: sql`excluded.location`, country: sql`excluded.country`,
        industries: sql`excluded.industries`, tags: sql`excluded.tags`, teamSize: sql`excluded.team_size`, fundingStage: sql`excluded.funding_stage`, investors: sql`excluded.investors`, raised: sql`excluded.raised`,
        raisedUsd: sql`excluded.raised_usd`, isHiring: sql`excluded.is_hiring`, sourceDate: sql`excluded.source_date`, data: sql`excluded.data`, syncedAt: sql`excluded.synced_at`,
      },
    });
  }
  return clean.length;
}

export type StartupQuery = { q?: string; source?: string; country?: string; industry?: string; program?: string; hiring?: boolean; page?: number; pageSize?: number };

export async function searchStartups(qy: StartupQuery) {
  const db = requireDb();
  const conds = [];
  if (qy.q) conds.push(or(ilike(schema.startups.name, `%${qy.q}%`), ilike(schema.startups.oneLiner, `%${qy.q}%`), ilike(schema.startups.description, `%${qy.q}%`), ilike(schema.startups.founders, `%${qy.q}%`)));
  if (qy.source) conds.push(eq(schema.startups.source, qy.source));
  if (qy.country) conds.push(eq(schema.startups.country, qy.country));
  if (qy.program) conds.push(eq(schema.startups.program, qy.program));
  if (qy.industry) conds.push(sql`${schema.startups.industries} @> ${JSON.stringify([qy.industry])}::jsonb`);
  if (qy.hiring) conds.push(eq(schema.startups.isHiring, 1));
  const where = conds.length ? and(...conds) : undefined;
  const pageSize = Math.min(qy.pageSize ?? 50, 100);
  const page = Math.max(qy.page ?? 1, 1);
  const [{ total }] = await db.select({ total: sql<number>`count(*)::int` }).from(schema.startups).where(where);
  const rows = await db.select().from(schema.startups).where(where).orderBy(desc(schema.startups.sourceDate), desc(schema.startups.id)).limit(pageSize).offset((page - 1) * pageSize);
  return { total, page, pageSize, rows };
}

export async function startupFacets() {
  const db = requireDb();
  const sources = await db.select({ source: schema.startups.source, n: sql<number>`count(*)::int` }).from(schema.startups).groupBy(schema.startups.source);
  const countries = await db.select({ country: schema.startups.country, n: sql<number>`count(*)::int` }).from(schema.startups).where(sql`${schema.startups.country} <> ''`).groupBy(schema.startups.country).orderBy(desc(sql`count(*)`)).limit(60);
  const programs = await db.select({ program: schema.startups.program, n: sql<number>`count(*)::int` }).from(schema.startups).where(sql`${schema.startups.program} <> ''`).groupBy(schema.startups.program).orderBy(desc(sql`count(*)`)).limit(80);
  const industries = await db.execute(sql`select ind as industry, count(*)::int as n from ${schema.startups}, jsonb_array_elements_text(industries) as ind group by ind order by n desc limit 60`);
  const [{ total, last }] = await db.select({ total: sql<number>`count(*)::int`, last: sql<string | null>`max(synced_at)` }).from(schema.startups);
  return { sources, countries, programs, industries: industries.rows as { industry: string; n: number }[], total, lastSync: last };
}

export async function getStartup(id: number) {
  const [row] = await requireDb().select().from(schema.startups).where(eq(schema.startups.id, id));
  return row ?? null;
}
