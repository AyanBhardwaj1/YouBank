"use client";

import { workspaceBoundary } from "@/components/ui/ErrorScreen";

/** A crash in the Book keeps the app shell and offers the way back to the Book. */
export default workspaceBoundary("/app/book", "Book", "the Book");
