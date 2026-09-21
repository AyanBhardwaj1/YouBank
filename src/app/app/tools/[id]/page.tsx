import { notFound } from "next/navigation";
import { toolById } from "@/lib/workflows/registry";
import { ToolPageClient } from "./ToolPageClient";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = toolById(id);
  return { title: t ? t.title : "Tool" };
}

export default async function ToolPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const sp = await searchParams;
  if (!toolById(id)) notFound();
  const runId = typeof sp.run === "string" ? Number(sp.run) : undefined;
  const ticker = typeof sp.ticker === "string" ? sp.ticker.toUpperCase() : undefined;
  return <ToolPageClient id={id} runId={runId} ticker={ticker} />;
}
