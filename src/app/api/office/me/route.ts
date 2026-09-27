import { NextResponse } from "next/server";
import { guardedFor } from "@/lib/office/auth";

export const dynamic = "force-dynamic";

/** Who the add-in is connected as; a 401 tells it to connect again. */
export async function GET(req: Request) {
  return guardedFor(req, async (user) => NextResponse.json({ user: { name: user.name, email: user.email } }));
}
