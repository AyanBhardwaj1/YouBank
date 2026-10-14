import { defineConfig } from "drizzle-kit";

// Schema pushes need a session connection: Supabase's session pooler (port 5432) in DATABASE_URL_UNPOOLED, not the transaction pooler.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // PostGIS keeps its own table (spatial_ref_sys) in public; it is not ours to create, rename or drop.
  extensionsFilters: ["postgis"],
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL ?? "" },
});
