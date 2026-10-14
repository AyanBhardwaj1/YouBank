import { CopyHub } from "@/components/copy/CopyHub";

export const metadata = { title: "Fund copies" };

/** Fund copies: ?tab=discover|copies|following|broker|activity, ?copy=ID opens a copy (&review=1 builds its orders), ?connected=1 after SnapTrade's portal. */
export default async function CopyPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
  const copy = Number(one(q.copy)) || null;
  return <CopyHub initialTab={one(q.tab) || undefined} initialCopy={copy} review={one(q.review) === "1"} connected={one(q.connected) === "1"} />;
}
