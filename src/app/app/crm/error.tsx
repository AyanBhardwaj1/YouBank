"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Relationships keeps the app shell and offers the way back to Relationships's start. */
export default workspaceBoundary("/app/crm", "Relationships", "Relationships");
