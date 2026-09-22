import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { JoinTeam } from "@/components/workspace/JoinTeam";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join a team" };

export default async function JoinPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const { token } = await searchParams;
  return <JoinTeam token={token ?? ""} email={user.email} />;
}
