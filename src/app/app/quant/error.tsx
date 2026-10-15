"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in Quant keeps the app shell and offers the way back to Quant's start. */
export default workspaceBoundary("/app/quant", "Quant", "Quant");
