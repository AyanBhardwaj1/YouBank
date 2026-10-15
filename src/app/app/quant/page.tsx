import { QuantHub } from "@/components/quant/QuantHub";

export const metadata = { title: "Quant" };

/** Quant: ?tab=overview|integrity|factors|risk|sizing|costs|insiders|drills|signals. */
export default async function QuantPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  return <QuantHub initialTab={typeof q.tab === "string" ? q.tab : undefined} />;
}
