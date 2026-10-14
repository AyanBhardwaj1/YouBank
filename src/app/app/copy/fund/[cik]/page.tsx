import { notFound } from "next/navigation";
import { FundPage } from "@/components/copy/FundPage";
import { curatedByCik, padCik } from "@/lib/copytrade/funds";

export async function generateMetadata({ params }: { params: Promise<{ cik: string }> }) {
  const cik = padCik((await params).cik);
  return { title: curatedByCik(cik)?.name ?? "Fund" };
}

/** A fund's 13F holdings, changes, statistics, backtest and filings. */
export default async function FundRoute({ params }: { params: Promise<{ cik: string }> }) {
  const cik = padCik((await params).cik);
  if (!cik) notFound();
  return <FundPage cik={cik} />;
}
