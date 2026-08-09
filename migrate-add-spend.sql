-- Run this once against your EXISTING database (the one schema.sql already
-- created tables in). Safe to re-run — IF NOT EXISTS makes it a no-op if
-- you've already applied it.
--
-- Usage:
--   psql "$DATABASE_URL" -f migrate-add-spend.sql

ALTER TABLE students
  ADD COLUMN IF NOT EXISTS semester_spend_slsh INTEGER NOT NULL DEFAULT 0;
