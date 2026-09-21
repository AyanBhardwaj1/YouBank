import { NextResponse } from "next/server";
import OpenAI from "openai";
import { cacheJson } from "@/lib/cache";
import { availableProviders } from "@/lib/ai/config";
import { EFFORTS, MODELS } from "@/lib/ai/models";
import { guarded } from "@/lib/auth/user";

export const dynamic = "force-dynamic";

/** Model catalogue with live availability: OpenAI ids are checked against /v1/models (cached an hour). */
export async function GET() {
  return guarded(async () => {
    const providers = availableProviders();
    let openaiIds: string[] | null = null;
    if (providers.includes("openai")) {
      openaiIds = await cacheJson("openai:models", 3_600_000, async () => {
        const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
        const ids: string[] = [];
        for await (const m of client.models.list()) ids.push(m.id);
        return ids;
      }).catch(() => null);
    }
    const models = MODELS.map((m) => ({
      ...m,
      available: m.provider === "openai" ? (providers.includes("openai") && (openaiIds ? openaiIds.includes(m.id) : true)) : providers.includes("anthropic"),
    }));
    return NextResponse.json({ providers, models, efforts: EFFORTS });
  });
}
