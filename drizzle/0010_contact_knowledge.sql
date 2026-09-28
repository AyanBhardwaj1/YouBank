-- Contact knowledge tracing: the topics each email raised, tagged once by a small model, so the CRM
-- can replay what every contact has been told, what stuck, and what they engage with.
--
-- One nullable column on crm_messages (null means not tagged yet). No data is changed.
--
-- Apply with:  DATABASE_URL=... pnpm exec tsx scripts/apply-sql.mts drizzle/0010_contact_knowledge.sql

ALTER TABLE "crm_messages" ADD COLUMN IF NOT EXISTS "topics" jsonb;
