import { VcWorkspace } from "@/components/vc/VcWorkspace";

export const metadata = { title: "Private markets" };

export default async function VcPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = await searchParams;
  return <VcWorkspace initialTab={tab} />;
}
