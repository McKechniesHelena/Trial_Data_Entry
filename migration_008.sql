-- Migration 008: allow authenticated users to INSERT.
-- Paste into Supabase SQL Editor and Run. Idempotent.
--
-- The original schema only granted INSERT to the anon role (entry form).
-- The dashboard's CSV Import runs as the logged-in (authenticated) role,
-- which previously had no INSERT policy and was rejected by RLS.

drop policy if exists "auth can insert" on trials;
create policy "auth can insert"
  on trials for insert
  to authenticated
  with check (true);
