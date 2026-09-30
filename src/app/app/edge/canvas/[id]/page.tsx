import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/user";
import { edgeProfile } from "@/lib/edge/access";
import { CanvasEditor } from "@/components/edge/canvas/CanvasEditor";

export const dynamic = "force-dynamic";
export const metadata = { title: "Edge canvas" };

/** One canvas, full screen: ?run=<id> opens that run's results. */
export default async function CanvasPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await currentUser();
  if (!user) redirect("/sign-in");
  const p = await edgeProfile(user.id);
  if (!p?.prefs.beta) redirect("/app/edge");
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) redirect("/app/edge?view=canvases");
  return <CanvasEditor id={id} />;
}
