"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Crypto keeps the app shell and offers the way back to Crypto's start. */
export default workspaceBoundary("/app/crypto", "Crypto", "Crypto");
