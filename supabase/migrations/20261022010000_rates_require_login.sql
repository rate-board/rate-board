-- Rates and their history are for signed-in users only; lenders and products stay public.

drop policy "Anyone can read rates" on public.rates;
create policy "Signed-in users read rates" on public.rates
  for select to authenticated using (true);

drop policy "Anyone can read rate history" on public.rate_history;
create policy "Signed-in users read rate history" on public.rate_history
  for select to authenticated using (true);
