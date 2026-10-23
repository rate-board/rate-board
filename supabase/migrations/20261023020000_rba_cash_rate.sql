-- RBA cash rate target decisions, kept current by the nightly sync, for marking rate charts.
create table public.rba_cash_rate (
  effective_date date primary key,
  change numeric(4,2) not null,
  cash_rate numeric(5,2) not null check (cash_rate >= 0 and cash_rate < 25)
);
alter table public.rba_cash_rate enable row level security;
create policy "Anyone can read RBA cash rate" on public.rba_cash_rate
  for select to anon, authenticated using (true);
