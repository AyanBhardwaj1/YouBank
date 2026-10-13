"use client";

import { ErrorScreen } from "@/components/ui/ErrorScreen";

/** A crash anywhere outside the workspace (landing, sign-in, onboarding, stories): the whole page. */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} home={{ href: "/", label: "Home" }} what="This page" full />;
}
