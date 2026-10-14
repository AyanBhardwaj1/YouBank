import { defineConfig } from "drizzle-kit";

// Schema pushes need a direct (Neon) or session (Supabase, port 5432) connection in DATABASE_URL_UNPOOLED.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // PostGIS keeps its own table (spatial_ref_sys) in public; it is not ours to create, rename or drop.
  extensionsFilters: ["postgis"],
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
});
