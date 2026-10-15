"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Library keeps the app shell and offers the way back to Library's start. */
export default workspaceBoundary("/app/library", "Library", "The library");
