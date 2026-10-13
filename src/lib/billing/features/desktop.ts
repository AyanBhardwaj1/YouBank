import type { PremiumFeature } from "./types";

/**
 * How many local files one person may index from their computer on any plan. Past this, indexing
 * more needs `desktop.folders`. Counted per person across all their computers; a changed file that is
 * already indexed does not count again.
 */
export const DESKTOP_FREE_FILES = 25;

/**
 * Premium features: The desktop app (the desktop work owns this file).
 *
 * The app itself, the wrapped site, notifications, quick ask (which draws on the normal daily AI
 * allowance, like the assistant in the browser), pulling Studio files to the computer and pushing edits
 * back are free. What follows costs us money each time it runs, so it needs a plan:
 * - reading a local file into Edge runs the document parser (OCR for scans) and embeds every passage;
 * - a scheduled AI task runs a model, or the satellite checks, without anyone at the keyboard, so it
 *   runs only when the person switched that task on for that computer (stored on the server, checked
 *   there);
 * - an AI edit to a local Office file is a full Studio agent run (up to two dozen model turns).
 * Costs are rough per-use estimates for the pricing model, not quotes.
 */
export const DESKTOP_FEATURES: PremiumFeature[] = [
  {
    id: "desktop.folders",
    area: "desktop",
    name: "Unlimited local files",
    description: `Index more than ${DESKTOP_FREE_FILES} PDFs, Word and Excel files from folders on your computer, so research, Edge and Studio can cite them.`,
    minPlan: "pro",
    metered: true,
    inAiAllowance: true,
    costPerUseUsd: 0.03,
  },
  {
    id: "desktop.background_ai",
    area: "desktop",
    name: "Scheduled AI tasks on desktop",
    description: "Let the desktop app write your Edge brief and check your watched sites on a schedule you set, while it sits in the tray. Off until you switch each task on.",
    minPlan: "pro",
    metered: true,
    inAiAllowance: true,
    costPerUseUsd: 0.05,
  },
  {
    id: "desktop.office_agent",
    area: "desktop",
    name: "AI edits to local Office files",
    description: "Ask the agent to change an Excel model or PowerPoint deck on your computer. It works on the linked Studio copy and writes the result back to your file, keeping a backup.",
    minPlan: "pro",
    metered: true,
    inAiAllowance: true,
    costPerUseUsd: 0.5,
  },
];
