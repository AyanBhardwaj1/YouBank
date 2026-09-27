import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { StudioHome } from "@/components/studio/StudioHome";
import { newDocument } from "@/lib/studio/create";
import { createDoc } from "@/lib/studio/db";
import { TEMPLATES, type TemplateId } from "@/lib/studio/templates";

export const dynamic = "force-dynamic";
export const metadata = { title: "Studio" };

/** /app/studio?template=dcf&ticker=SNOW opens a new model straight away (linked from the terminal). */
export default async function StudioPage({ searchParams }: { searchParams: Promise<{ template?: string; ticker?: string }> }) {
  const { template, ticker } = await searchParams;
  if (template && TEMPLATES.some((t) => t.id === template)) {
    const user = await currentUser();
    if (!user) redirect("/sign-in");
    const clean = ticker?.toUpperCase().replace(/[^A-Z.\-]/g, "").slice(0, 10) || null;
    const d = await newDocument(template as TemplateId, { ticker: clean });
    const row = await createDoc(user, { ...d, kind: template, ticker: clean ?? "" });
    redirect(`/app/studio/${row.id}`);
  }
  return <StudioHome />;
}
