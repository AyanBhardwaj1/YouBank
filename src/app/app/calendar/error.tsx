"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Calendar keeps the app shell and offers the way back to Calendar's start. */
export default workspaceBoundary("/app/calendar", "Calendar", "The calendar");
