"use client";

/**
 * Where a question typed anywhere in the app goes: the terminal's AI function, about the first name on
 * the person's watchlist. Kept apart from Home's widgets so a composer (Prompt's) can use it cheaply.
 */
import { useRouter } from "next/navigation";
import { useWorkspace } from "../WorkspaceProvider";

export function useAsk() {
  const { config } = useWorkspace();
  const router = useRouter();
  const first = config.watchlist[0] ?? "SNOW";
  const href = (q: string) => `/app/terminal?ticker=${encodeURIComponent(first)}&fn=AI&arg=${encodeURIComponent(q)}`;
  return { first, href, ask: (q: string) => { const t = q.trim(); if (t) router.push(href(t)); }, prompts: config.suggestedPrompts(first) };
}
