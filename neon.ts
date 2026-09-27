import { defineConfig } from "@neon/config/v1";

// The autopilot heartbeat (neon/autopilot.ts) is deployed on the production branch with the CLI rather
// than from this file, because it carries secrets and must not be redeployed by `neon deploy`:
//   neon functions deploy autopilot --src neon/autopilot.ts --env YOUBANK_URL=... --env AUTOPILOT_SECRET=...
//   neon triggers create --function-slug autopilot --name autopilot-heartbeat --cron '*/5 * * * *'
// Triggers and functions that exist remotely but are not declared here are left alone by `neon deploy`.
export default defineConfig({
  auth: true,
  preview: {
    // Upgrade to a paid plan to enable AI Gateway for your project.
    // aiGateway: true,
    functions: {
      api: { name: "api", source: "./hello.ts" },
    },
  },
});
