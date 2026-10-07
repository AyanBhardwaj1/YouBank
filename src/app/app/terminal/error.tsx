"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Terminal keeps the app shell and offers the way back to Terminal's start. */
export default workspaceBoundary("/app/terminal", "Terminal", "The terminal");
