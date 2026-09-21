import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { toolCount } from "@/lib/workflows/registry";
import { Landing } from "@/components/marketing/Landing";

export default async function Home() {
  const user = await currentUser();
  if (user) redirect("/app");
  return <Landing toolCounts={toolCount()} />;
}
