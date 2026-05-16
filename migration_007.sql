-- Migration 007: harvest type, yield unit, and moisture columns.
-- Paste into Supabase SQL Editor and Run.

alter table trials
  add column if not exists harvest_type   text,    -- 'Grain' | 'Silage' | 'Feed'
  add column if not exists yield_unit     text,    -- 'bushel' for grain, 'tons' for silage/feed
  add column if not exists check_moisture numeric, -- moisture % for the check yield (Grain & Silage)
  add column if not exists trt_moisture   numeric; -- moisture % for the treated yield (Grain & Silage)

-- Reasonable default for historical rows: Corn / SB / Wheat trials are
-- almost always grain. Leaves Alfalfa + Other untouched so the user can
-- assign those manually (Silage vs Feed isn't derivable from crop).
update trials
   set harvest_type = 'Grain',
       yield_unit   = 'bushel'
 where harvest_type is null
   and crop in ('Corn', 'SB', 'Wheat');

-- Sanity check (uncomment to run):
-- select harvest_type, yield_unit, count(*)
--   from trials
--  group by 1, 2
--  order by 3 desc;
