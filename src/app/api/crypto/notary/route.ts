import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { listNotarizations, recordNotarization } from "@/lib/crypto/store";

export const dynamic = "force-dynamic";

/**
 * Notarizations. GET: the person's records (?sha256=… finds a file's), with pending ones re-checked on
 * chain. POST: record a transaction the person's wallet just sent; the server reads it back from a
 * Base node and confirms it only if it carries this file's hash. The server never signs anything.
 */
export async function GET(req: Request) {
  return guarded(async (user) => {
    const sha = new URL(req.url).searchParams.get("sha256") ?? undefined;
    return NextResponse.json({ records: await listNotarizations(user.id, sha && /^[0-9a-f]{64}$/i.test(sha) ? sha : undefined) }, { headers: { "cache-control": "no-store" } });
  });
}

export async function POST(req: Request) {
  return guarded(async (user) => {
    const b = (await req.json().catch(() => null)) as { sha256?: string; txHash?: string; fromAddress?: string; subject?: string; kind?: string; studioDocId?: number; studioEventId?: number; chain?: string } | null;
    const row = await recordNotarization(user.id, {
      sha256: String(b?.sha256 ?? ""), txHash: String(b?.txHash ?? ""), fromAddress: String(b?.fromAddress ?? ""), subject: b?.subject, kind: b?.kind,
      studioDocId: Number.isInteger(b?.studioDocId) ? b!.studioDocId : null, studioEventId: Number.isInteger(b?.studioEventId) ? b!.studioEventId : null, chain: b?.chain,
    });
    return NextResponse.json({ record: row });
  });
}
