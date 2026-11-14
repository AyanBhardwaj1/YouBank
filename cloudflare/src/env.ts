import type { LedgerSequencer } from "./ledger";
import type { ThesisAgent } from "./thesis";

/** The Worker's bindings and settings (wrangler.jsonc; APP_SECRET is a secret: `wrangler secret put APP_SECRET`). */
export interface Env {
  /** YouBank's address, e.g. https://youbank.dev. */
  APP_URL: string;
  /** Shared with YouBank (its CF_WORKER_SECRET): YouBank sends it to call here, and this Worker sends it back. */
  APP_SECRET: string;
  THESIS: DurableObjectNamespace<ThesisAgent>;
  LEDGER: DurableObjectNamespace<LedgerSequencer>;
  MCP: DurableObjectNamespace;
  BOOK_CHECK: Workflow;
}
