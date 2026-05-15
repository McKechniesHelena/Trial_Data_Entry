-- Migration 006: RPC to fetch the distinct list of product names.
-- Paste into Supabase SQL Editor and Run. Idempotent.
--
-- Allows the unauthenticated entry form to populate a product-name datalist
-- without exposing any trial data — the function returns only distinct
-- product strings (no rates, yields, ROIs, etc.).

create or replace function public.distinct_products()
returns table (product text)
language sql
security definer
set search_path = public
as $$
  select distinct trim(p) as product
    from (
      select product_1 as p from trials where product_1 is not null and trim(product_1) <> ''
      union all select product_2 from trials where product_2 is not null and trim(product_2) <> ''
      union all select product_3 from trials where product_3 is not null and trim(product_3) <> ''
      union all select product_4 from trials where product_4 is not null and trim(product_4) <> ''
      union all select product_5 from trials where product_5 is not null and trim(product_5) <> ''
    ) t
   order by 1;
$$;

revoke all on function public.distinct_products() from public;
grant execute on function public.distinct_products() to anon, authenticated;
