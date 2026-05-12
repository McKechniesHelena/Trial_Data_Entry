-- Migration 001: zip-based location + auto trial #.
-- Paste into Supabase SQL Editor and Run.

-- 1. Add zip/lat/lng columns.
alter table trials add column if not exists zip_code text;
alter table trials add column if not exists latitude numeric;
alter table trials add column if not exists longitude numeric;

-- 2. Trigger to auto-assign trial_num and key_id on insert.
--    SECURITY DEFINER lets the function read max(trial_num) even
--    though the anon role has no SELECT permission on the table.
create or replace function trials_set_trial_num()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  next_num integer;
begin
  if new.trial_num is null and new.year is not null then
    select coalesce(max(trial_num), 0) + 1
      into next_num
      from trials
     where year = new.year;
    new.trial_num := next_num;
  end if;

  if new.key_id is null
     and new.year is not null
     and new.trial_num is not null then
    new.key_id := new.year + new.trial_num / 1000.0;
  end if;

  return new;
end;
$$;

drop trigger if exists trials_set_trial_num_trg on trials;
create trigger trials_set_trial_num_trg
  before insert on trials
  for each row
  execute function trials_set_trial_num();
