"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Edge keeps the app shell and offers the way back to Edge's start. */
export default workspaceBoundary("/app/edge", "Edge", "Edge");
