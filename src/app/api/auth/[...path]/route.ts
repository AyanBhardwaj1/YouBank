import { auth } from "@/lib/auth/server";

/**
 * Neon Auth's own endpoints (sign-in, callbacks, session). The handlers are built on the first request,
 * not at import, so a missing auth setting fails the request (logged, see instrumentation) rather than
 * the module's import; once built they are reused.
 */
type Handlers = ReturnType<typeof auth.handler>;
let handlers: Handlers | null = null;
const on = (method: keyof Handlers): Handlers[typeof method] => (req, ctx) => (handlers ??= auth.handler())[method](req, ctx);

export const GET = on("GET");
export const POST = on("POST");
export const PUT = on("PUT");
export const DELETE = on("DELETE");
export const PATCH = on("PATCH");
