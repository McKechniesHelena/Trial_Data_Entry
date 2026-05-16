-- Migration 009: rename crop 'SB' to 'Soybeans'.
-- Paste into Supabase SQL Editor and Run. Idempotent.

update trials
   set crop = 'Soybeans'
 where crop = 'SB';

-- Sanity check (uncomment to run):
-- select crop, count(*) from trials group by 1 order by 2 desc;
