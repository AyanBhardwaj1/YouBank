"use client";

/**
 * A failed request shown in line, where it happened. When the server refused a premium feature the
 * person's plan does not include (402 from requireFeature, whose message names the plan), the message
 * comes with a lock and a link to the plans instead of reading like a crash; anything else shows as a
 * plain error. Messages are the server's own, already safe to show (lib/errors).
 */
import Link from "next/link";
import { Icon } from "@/components/ui/Icon";

/** requireFeature's message: "<Feature> is part of the <Plan> plan. Upgrade in Settings, under Plan, to use it." */
const PLAN_MESSAGE = /is part of the .+ plan\. Upgrade in Settings/;

/** Whether an error (or its message) is a plan refusal rather than a failure. */
export function isPlanError(e: unknown): boolean {
  if ((e as { status?: unknown } | null)?.status === 402) return true;
  const m = typeof e === "string" ? e : e instanceof Error ? e.message : "";
  return PLAN_MESSAGE.test(m);
}

export const messageOf = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : String(e ?? ""));

export function PlanNotice({ error, className = "" }: { error: unknown; className?: string }) {
  const message = messageOf(error);
  if (!message) return null;
  if (!isPlanError(error)) return <p className={`text-[12px] text-neg ${className}`} role="alert">{message}</p>;
  return (
    <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-accent/40 bg-accent-soft px-2.5 py-1.5 text-[12px] ${className}`} role="status">
      <Icon name="Lock" className="h-3.5 w-3.5 shrink-0 text-accent" />
      <span className="min-w-0 flex-1 text-fg">{message}</span>
      <Link href="/app/settings?tab=plan" className="font-medium text-accent hover:underline">See plans</Link>
    </div>
  );
}
