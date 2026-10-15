import { AlgoHub } from "@/components/algo/AlgoHub";
import { storedMessage } from "@/lib/errors";

export const metadata = { title: "Algo trading" };

/** Algo trading: ?tab=strategies|brokers|agent|activity, ?strategy=ID opens one; ?connected=1|0 (&reason=) after Alpaca's sign-in. */
export default async function AlgoPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  return <AlgoHub initialTab={one(q.tab) || undefined} initialStrategy={Number(one(q.strategy)) || null} connected={one(q.connected) || null} reason={storedMessage(one(q.reason).slice(0, 200), "Alpaca did not complete the connection.") || null} />;
}
