import { guarded, type CurrentUser } from "@/lib/auth/user";
import { BillingError } from "./stripe";

/**
 * guarded() for billing routes: a BillingError becomes its own response (its message is already safe
 * to show, and a Stripe failure was logged with its reference where it happened); anything else goes
 * through guarded's usual handling.
 */
export function billingRoute(fn: (user: CurrentUser) => Promise<Response>): Promise<Response> {
  return guarded((user) => fn(user).catch((e: unknown) => {
    if (e instanceof BillingError) return Response.json({ error: e.message }, { status: e.status });
    throw e;
  }));
}
