import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireDb, schema } from "@/db";
import { guarded } from "@/lib/auth/user";
import { requireEdge } from "@/lib/edge/access";

export const dynamic = "force-dynamic";

/** The person's recent questions. */
export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const rows = await requireDb().select({ id: schema.edgeAnswers.id, question: schema.edgeAnswers.question, mode: schema.edgeAnswers.mode, createdAt: schema.edgeAnswers.createdAt, answer: schema.edgeAnswers.answer })
      .from(schema.edgeAnswers).where(eq(schema.edgeAnswers.ownerId, user.id)).orderBy(desc(schema.edgeAnswers.createdAt)).limit(30);
    return NextResponse.json({ answers: rows.map((r) => ({ id: r.id, question: r.question, mode: r.mode, createdAt: r.createdAt.toISOString(), notFound: !!(r.answer as { notFound?: boolean }).notFound })) });
  });
}
