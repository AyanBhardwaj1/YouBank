"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Team keeps the app shell and offers the way back to Team's start. */
export default workspaceBoundary("/app/team", "Team", "The team page");
