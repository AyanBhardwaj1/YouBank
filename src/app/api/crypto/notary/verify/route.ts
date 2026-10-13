import { NextResponse } from "next/server";
import { guarded } from "@/lib/auth/user";
import { isChainKey } from "@/lib/crypto/chains";
import { checkNotaryTx, isSha256Hex, isTxHash, parseNotaryCalldata } from "@/lib/crypto/notary";
import { isEvmKey } from "@/lib/crypto/rpc";
import { readTx } from "@/lib/crypto/store";

export const dynamic = "force-dynamic";

/**
 * Check any transaction against a file's hash, whoever sent it: does this transaction record this
 * file? The file itself never leaves the browser; only its SHA-256 comes here.
 */
export async function POST(req: Request) {
  return guarded(async () => {
    const b = (await req.json().catch(() => null)) as { txHash?: string; sha256?: string; chain?: string } | null;
    const tx = String(b?.txHash ?? ""), sha = String(b?.sha256 ?? "").toLowerCase();
    if (!isTxHash(tx)) return NextResponse.json({ error: "Paste a transaction hash (0x followed by 64 hex characters)" }, { status: 400 });
    if (!isSha256Hex(sha)) return NextResponse.json({ error: "Choose the file to check first" }, { status: 400 });
    const chain = isChainKey(b?.chain) && isEvmKey(b.chain) ? b.chain : "base";
    const facts = await readTx(chain, tx as `0x${string}`);
    if (!facts) return NextResponse.json({ ok: false, reason: "No such transaction on this chain (yet)", chain });
    const verdict = checkNotaryTx(facts, sha);
    return NextResponse.json({ ...verdict, chain, from: facts.from, recorded: parseNotaryCalldata(facts.input), blockNumber: facts.blockNumber !== null ? Number(facts.blockNumber) : null });
  });
}
