import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { BookClient } from "@/components/book/BookClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "The Book" };

export default async function BookPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const { position, view, proposal } = await searchParams;
  // ?position=ID (from an alert): that position opens and scrolls into view. ?view=risk opens the risk panel.
  // ?proposal=ID (from an AI app's propose_position): that proposal is marked.
  return <BookClient focus={typeof position === "string" ? position.slice(0, 40) : undefined} riskOpen={view === "risk"} proposal={typeof proposal === "string" ? proposal.slice(0, 40) : undefined} />;
}
