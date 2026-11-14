import { PredictHub } from "@/components/predict/PredictHub";

export const metadata = { title: "Prediction markets" };

/** Prediction markets: ?tab=markets|spreads|exposure|watch, ?market=<venue:id> opens one market; the browser's filters are ?q=&venue=&cat=&sort=. */
export default async function PredictPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const one = (k: string) => (typeof q[k] === "string" ? (q[k] as string) : undefined);
  return <PredictHub initialTab={one("tab")} initialMarket={one("market")?.slice(0, 140)} initialParams={{ q: one("q"), venue: one("venue"), cat: one("cat"), sort: one("sort"), min: one("min") }} />;
}
