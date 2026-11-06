import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { BookClient } from "@/components/book/BookClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "The Book" };

export default async function BookPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  return <BookClient />;
}
