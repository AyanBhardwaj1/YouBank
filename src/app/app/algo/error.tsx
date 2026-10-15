"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Algo trading keeps the app shell and offers the way back to Algo trading's start. */
export default workspaceBoundary("/app/algo", "Algo trading", "Algo trading");
