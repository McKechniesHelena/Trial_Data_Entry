-- Migration 004: branch column for tracking which branch a trial came from.
-- Paste into Supabase SQL Editor and Run.

alter table trials add column if not exists branch text;

create index if not exists trials_branch_idx on trials(branch);
