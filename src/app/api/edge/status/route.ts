import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { isAdmin } from "@/lib/auth/admin";
import { requireEdge } from "@/lib/edge/access";
import { jobsReady } from "@/lib/edge/infra/jobs";
import { mlReady } from "@/lib/edge/infra/ml";
import { r2Ready } from "@/lib/edge/infra/r2";
import { usageReport, withinFreeTier } from "@/lib/edge/infra/usage";

export const dynamic = "force-dynamic";

/** Whether Edge's services are on and inside their free allowances; administrators also see the numbers. */
export async function GET() {
  return guarded(async (user) => {
    await requireEdge(user.id);
    const [ml, jobs, files] = await Promise.all([withinFreeTier("modal"), withinFreeTier("inngest"), withinFreeTier("r2")]);
    const services = {
      ml: { ready: mlReady(), ...ml }, jobs: { ready: jobsReady(), ...jobs }, files: { ready: r2Ready(), ...files },
    };
    return NextResponse.json({ services, usage: isAdmin(user) ? await usageReport() : null });
  });
}
