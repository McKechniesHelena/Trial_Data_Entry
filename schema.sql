-- Run this in the Supabase SQL editor (one time).

create table if not exists trials (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  submitted_by text,

  key_id numeric,
  rep text,
  trial_num integer,
  crop text,
  check_yield numeric,
  trt_yield numeric,
  trt_increase numeric,
  pct_increase numeric,
  std_dev numeric,
  check_trt text,
  treatment_type text,
  product_names text,
  treatment_with_rate text,
  product_cost numeric,
  application_cost numeric,
  trt_cost numeric,
  dollar_per_acre_increase numeric,
  net_per_acre numeric,
  roi numeric,
  growth_stage_applied text,
  year integer,
  state text,
  location text,
  sales_rep text,
  spatial_data text,
  customer_info text,
  size text
);

create index if not exists trials_year_idx on trials(year);
create index if not exists trials_crop_idx on trials(crop);
create index if not exists trials_state_idx on trials(state);
create index if not exists trials_sales_rep_idx on trials(sales_rep);

alter table trials enable row level security;

-- Anonymous users (reps in the field) can INSERT, nothing else.
drop policy if exists "anon can insert" on trials;
create policy "anon can insert"
  on trials for insert
  to anon
  with check (true);

-- Logged-in users (dashboard viewers) can read everything.
drop policy if exists "auth can read" on trials;
create policy "auth can read"
  on trials for select
  to authenticated
  using (true);

-- Logged-in users can update/delete their own future cleanups.
drop policy if exists "auth can update" on trials;
create policy "auth can update"
  on trials for update
  to authenticated
  using (true) with check (true);

drop policy if exists "auth can delete" on trials;
create policy "auth can delete"
  on trials for delete
  to authenticated
  using (true);
