import { serve } from "inngest/next";
import { functions } from "@/lib/edge/functions";
import { inngest } from "@/lib/edge/infra/jobs";

export const dynamic = "force-dynamic";
/** Inngest hands each step here; its checkpointing returns well inside this (see infra/jobs). */
export const maxDuration = 300;

/** Inngest Cloud calls this, signed with INNGEST_SIGNING_KEY; the SDK verifies every request. */
export const { GET, POST, PUT } = serve({ client: inngest, functions });
