import { auth } from "@/lib/auth/server";

/**
 * Sign-in's own endpoints (Google redirect and callback, session, sign-out). The handler is built on the
 * first request, not at import, so a missing auth setting fails the request (logged, see
 * instrumentation) rather than the module's import.
 */
const handle = (req: Request) => auth.handler(req);

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const DELETE = handle;
export const PATCH = handle;
