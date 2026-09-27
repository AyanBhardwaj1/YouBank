import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { addContact, contactsOverview } from "@/lib/crm/contacts";

export const dynamic = "force-dynamic";

export async function GET() {
  return guarded(async (user) => NextResponse.json(await contactsOverview(user.id)));
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    const body = (await req.json().catch(() => null)) as { email?: string; name?: string; title?: string; company?: string; kind?: string; notes?: string } | null;
    if (!body?.email) return NextResponse.json({ error: "An email address is required" }, { status: 400 });
    return NextResponse.json(await addContact(user.id, { ...body, email: body.email }), { status: 201 });
  });
}
