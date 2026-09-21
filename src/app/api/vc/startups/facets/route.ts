import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { startupFacets } from "@/lib/vc/directory";

export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async () => NextResponse.json(await startupFacets()));
}
