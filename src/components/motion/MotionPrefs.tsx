"use client";

import { MotionConfig } from "motion/react";

/**
 * Every `motion` animation in the app follows the system's "reduce motion" setting: springs and
 * slides become instant, opacity fades stay. Components that already check `useReducedMotion`
 * keep working; this covers the ones that do not. (CSS animations are handled in globals.css.)
 */
export function MotionPrefs({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
