import { CanvasSkeleton } from "@/components/edge/canvas/Skeleton";

/** Shown at once on opening a canvas while the page is fetched; the editor keeps the same shape until the canvas arrives. */
export default function Loading() {
  return <CanvasSkeleton />;
}
