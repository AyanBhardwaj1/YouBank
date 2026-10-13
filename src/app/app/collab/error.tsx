"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Together keeps the app shell and offers the way back to Together's start. */
export default workspaceBoundary("/app/collab", "Together", "This session");
