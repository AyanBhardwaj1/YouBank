"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Tools keeps the app shell and offers the way back to Tools's start. */
export default workspaceBoundary("/app/tools", "Tools", "This tool");
