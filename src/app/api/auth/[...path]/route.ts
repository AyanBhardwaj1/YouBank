import { auth } from "@/lib/auth/server";

/**
 * Neon Auth's own endpoints (sign-in, callbacks, session). The handlers are looked up per request so a
 * missing auth setting fails the request (logged, see instrumentation) rather than the module's import.
 */
type Handlers = ReturnType<typeof auth.handler>;
const on = (method: keyof Handlers): Handlers[typeof method] => (req, ctx) => auth.handler()[method](req, ctx);

export const GET = on("GET");
export const POST = on("POST");
export const PUT = on("PUT");
export const DELETE = on("DELETE");
export const PATCH = on("PATCH");
