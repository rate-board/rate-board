-- Record where each historical rate came from, so a change of product or method isn't mistaken for a rate move.
alter table public.rate_history
  add column source text,
  add column product_name text;

create or replace function public.log_rate_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.rate_history (lender_id, product_key, rate, comparison_rate, as_of, changed_by, source, product_name)
    values (old.lender_id, old.product_key, null, null, current_date, auth.uid(), old.source, old.product_name);
  elsif tg_op = 'INSERT'
     or (old.rate, old.comparison_rate, old.as_of) is distinct from (new.rate, new.comparison_rate, new.as_of) then
    insert into public.rate_history (lender_id, product_key, rate, comparison_rate, as_of, changed_by, source, product_name)
    values (new.lender_id, new.product_key, new.rate, new.comparison_rate, new.as_of, auth.uid(), new.source, new.product_name);
  end if;
  return null;
end;
$$;

-- Backfill: the 2 Oct 2026 entries are the hand-collected seed; later entries match the rates they produced.
update public.rate_history set source = 'manual' where as_of = '2026-10-02';
update public.rate_history h
set source = r.source, product_name = r.product_name
from public.rates r
where h.source is null and h.lender_id = r.lender_id and h.product_key = r.product_key;
