-- Signed-out sneak peek: published rates for the first half of the lenders (by display order), readable without
-- signing in. Capped at 12 lenders in the database, so the full table still needs an account. No agent rates.
create or replace function public.rate_preview(p_limit int default 10)
returns table (lender_id text, product_key text, rate numeric, comparison_rate numeric)
language sql stable security definer set search_path = ''
as $$
  select r.lender_id, r.product_key, r.rate, r.comparison_rate
  from public.rates r
  join (
    select id from public.lenders where active order by sort_order limit least(greatest(coalesce(p_limit, 10), 1), 12)
  ) l on l.id = r.lender_id;
$$;
grant execute on function public.rate_preview(int) to anon, authenticated;
