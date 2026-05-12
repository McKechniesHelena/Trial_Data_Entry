-- Migration 002: soft-delete support.
-- Paste into Supabase SQL Editor and Run.

alter table trials add column if not exists deleted_at timestamptz;

-- Partial index speeds up "show only live rows" queries.
create index if not exists trials_deleted_at_idx
  on trials(deleted_at)
  where deleted_at is null;
