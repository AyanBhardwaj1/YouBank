import { defineConfig } from "drizzle-kit";

// Schema pushes use the direct (non-pooled) connection, per Neon guidance.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
});
