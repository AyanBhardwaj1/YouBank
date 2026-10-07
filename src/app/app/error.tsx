"use client";

import { ErrorScreen } from "@/components/ui/ErrorScreen";

/**
 * A crash in any workspace page. It renders inside the app shell (the layout above is untouched), so
 * the navigation stays and the person can go elsewhere; the workspaces below add their own boundary
 * so "home" returns to that workspace's start.
 */
export default function WorkspaceError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} what="This page" />;
}
