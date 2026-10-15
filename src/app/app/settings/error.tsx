"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Settings keeps the app shell and offers the way back to Settings's start. */
export default workspaceBoundary("/app/settings", "Settings", "Settings");
