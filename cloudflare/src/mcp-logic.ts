/**
 * Which tool calls the hosted MCP server holds for the person's confirmation. Pure (test/run.ts).
 * A tool YouBank marks as writing (annotations.readOnlyHint === false) is gated when the AI app can ask the
 * person (MCP elicitation); without that capability the call goes through and YouBank's Needs you queue is
 * the gate, as it is for every AI app.
 */
type ToolLike = { name: string; title?: string; annotations?: { readOnlyHint?: boolean } };

export function gateFor(tool: ToolLike | undefined, canAsk: boolean): { message: string; confirmTitle: string } | null {
  if (!tool || !canAsk || tool.annotations?.readOnlyHint !== false) return null;
  const what = tool.title ?? tool.name;
  return { message: `Send “${what}” to YouBank? It lands in your Needs you queue for review; nothing changes in your book until you approve it there.`, confirmTitle: "Send it" };
}

/** The bearer token on an MCP request, if it looks like one. Pure. */
export function bearer(req: Request): string | null {
  const m = /^Bearer\s+([\w.~+/=-]{16,400})$/.exec(req.headers.get("authorization") ?? "");
  return m ? m[1] : null;
}
