-- Migration 003: structured product columns (up to 5 products per trial).
-- Paste into Supabase SQL Editor and Run.

-- 1. Add 15 columns: product_N (text), rate_N (numeric), unit_N (text) for N in 1..5.
alter table trials
  add column if not exists product_1 text,
  add column if not exists rate_1 numeric,
  add column if not exists unit_1 text,
  add column if not exists product_2 text,
  add column if not exists rate_2 numeric,
  add column if not exists unit_2 text,
  add column if not exists product_3 text,
  add column if not exists rate_3 numeric,
  add column if not exists unit_3 text,
  add column if not exists product_4 text,
  add column if not exists rate_4 numeric,
  add column if not exists unit_4 text,
  add column if not exists product_5 text,
  add column if not exists rate_5 numeric,
  add column if not exists unit_5 text;

-- 2. Backfill from existing treatment_with_rate strings.
--    Format expected: "Name @ rate unit + Name @ rate unit + ..."
--    Names without "@ rate unit" still get product_N populated.
--    Only rows where product_1 is still null are touched, so this is idempotent.
do $$
declare
  t record;
  parts text[];
  part text;
  i int;
  m text[];
  prod text;
  r numeric;
  u text;
begin
  for t in
    select id, treatment_with_rate
      from trials
     where treatment_with_rate is not null
       and treatment_with_rate <> ''
       and product_1 is null
  loop
    parts := regexp_split_to_array(t.treatment_with_rate, '\s*\+\s*');
    for i in 1..least(coalesce(array_length(parts, 1), 0), 5) loop
      part := trim(parts[i]);
      if part = '' then continue; end if;

      -- Try "Name @ rate unit"
      m := regexp_match(part, '^(.+?)\s*@\s*([\d.]+)\s*(.*)$');
      if m is not null then
        prod := trim(m[1]);
        r := nullif(m[2], '')::numeric;
        u := nullif(trim(m[3]), '');
      else
        prod := part;
        r := null;
        u := null;
      end if;

      if i = 1 then
        update trials set product_1 = prod, rate_1 = r, unit_1 = u where id = t.id;
      elsif i = 2 then
        update trials set product_2 = prod, rate_2 = r, unit_2 = u where id = t.id;
      elsif i = 3 then
        update trials set product_3 = prod, rate_3 = r, unit_3 = u where id = t.id;
      elsif i = 4 then
        update trials set product_4 = prod, rate_4 = r, unit_4 = u where id = t.id;
      elsif i = 5 then
        update trials set product_5 = prod, rate_5 = r, unit_5 = u where id = t.id;
      end if;
    end loop;
  end loop;
end $$;

-- 3. Quick sanity check (uncomment to run):
-- select count(*) filter (where product_1 is not null) as parsed,
--        count(*) filter (where product_1 is null and treatment_with_rate is not null) as unparsed,
--        count(*) as total
-- from trials;
