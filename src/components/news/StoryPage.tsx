"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { LookId } from "@/lib/news/prefs";
import { MotionContext, useEffectiveMotion, type MotionLevel } from "./client";
import { StoryBody } from "./StoryReader";

/** The full-page reader: the same body as the side peek, with room for depth. */
export function StoryPage({ id, look, motion }: { id: number; look: LookId; motion: MotionLevel }) {
  const level = useEffectiveMotion(motion);
  return (
    <MotionContext value={level}>
      <div className="nr h-full overflow-y-auto" data-look={look} data-motion={level}>
        <div className="mx-auto max-w-[760px] px-5 pt-5"><Link href="/app/news" className="inline-flex items-center gap-1.5 text-[12px] text-muted hover:text-fg"><ArrowLeft className="h-3.5 w-3.5" /> Back to the Newsroom</Link></div>
        <StoryBody id={id} mode="page" />
      </div>
    </MotionContext>
  );
}
