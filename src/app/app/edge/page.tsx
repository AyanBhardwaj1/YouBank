import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { edgeProfile } from "@/lib/edge/access";
import { EdgeIntro } from "@/components/edge/BetaToggle";
import { EdgeWorkspace, type EdgeView } from "@/components/edge/EdgeWorkspace";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edge" };

const VIEWS = new Set<EdgeView>(["feed", "map", "whatif"]);

/** Edge: ?view=feed|map|whatif. Before the beta is on, the page explains Edge and offers the switch. */
export default async function EdgePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const p = await edgeProfile(user.id);
  if (!p?.prefs.beta) return <EdgeIntro />;
  const view = (await searchParams).view;
  return <EdgeWorkspace initialView={typeof view === "string" && VIEWS.has(view as EdgeView) ? (view as EdgeView) : "feed"} />;
}
