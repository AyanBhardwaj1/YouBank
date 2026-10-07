"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Studio keeps the app shell and offers the way back to Studio's start. */
export default workspaceBoundary("/app/studio", "Studio", "This model");
