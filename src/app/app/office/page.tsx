import { OfficeConnect } from "@/components/office/OfficeConnect";

export const dynamic = "force-dynamic";
export const metadata = { title: "Excel and PowerPoint" };

/** Install the add-in, approve the code it shows, and manage connected installs. ?code= comes from the add-in. */
export default async function OfficePage({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { code } = await searchParams;
  return <OfficeConnect initialCode={(code ?? "").toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 9)} />;
}
