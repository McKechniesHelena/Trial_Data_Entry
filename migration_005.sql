-- Migration 005: backfill branch from legacy location for historical rows.
-- Paste into Supabase SQL Editor and Run.
--
-- Historical pre-zip rows used the 'location' column to store branch names
-- (e.g. 'Menno', 'Mason City'). Newer rows store 'City, State' in location
-- (from the zip-lookup form), so we limit this fill to rows that don't have
-- latitude/longitude — i.e. were imported before the zip feature shipped.

update trials
   set branch = location
 where branch is null
   and location is not null
   and location <> ''
   and latitude is null
   and longitude is null;

-- Sanity check (uncomment to run):
-- select count(*) filter (where branch is not null) as with_branch,
--        count(*) filter (where branch is null) as without_branch,
--        count(*) as total
-- from trials;
