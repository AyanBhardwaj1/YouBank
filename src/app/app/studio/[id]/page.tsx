import { notFound } from "next/navigation";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio" };

export default async function StudioDocPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ask?: string; tab?: string; slide?: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  const { ask, tab, slide } = await searchParams;
  return <StudioWorkspace id={id} initialAsk={ask ?? null} initialTab={tab === "deck" || slide ? "deck" : "model"} initialSlide={slide ? Number(slide) : null} />;
}
