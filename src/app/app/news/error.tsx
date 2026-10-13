"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Newsroom keeps the app shell and offers the way back to Newsroom's start. */
export default workspaceBoundary("/app/news", "Newsroom", "The Newsroom");
