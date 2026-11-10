"use client";

import { MotionConfig } from "motion/react";
import { useEffect, useState } from "react";

/**
 * Every `motion` animation in the app follows the system's "reduce motion" setting: springs and
 * slides become instant, opacity fades stay. Components that already check `useReducedMotion`
 * keep working; this covers the ones that do not. (CSS animations are handled in globals.css.)
 * Reduced motion chosen in Settings → Style (html[data-motion="reduced"]) wins over the system.
 */
export function MotionPrefs({ children }: { children: React.ReactNode }) {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const html = document.documentElement;
    const read = () => setReduced(html.dataset.motion === "reduced");
    read();
    const watch = new MutationObserver(read);
    watch.observe(html, { attributes: true, attributeFilter: ["data-motion"] });
    return () => watch.disconnect();
  }, []);
  return <MotionConfig reducedMotion={reduced ? "always" : "user"}>{children}</MotionConfig>;
}
