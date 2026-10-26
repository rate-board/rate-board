-- Super app: one catalogue for every product category beyond home loans, the customer's household and assets,
-- insurance quote requests, and the Inflation Points loyalty program. Additive only: nothing existing changes.

-- Catalogue ----------------------------------------------------------------------------------------------

-- One row per product in a category. `rate` is the number the category ranks on (interest rate, monthly fee,
-- price); everything category-specific lives in attrs. Synced rows come from Open Banking (cdr) or the energy
-- regulator (aer); sample rows are placeholders for categories with no open data feed yet.
create table public.catalog_items (
  id bigint generated always as identity primary key,
  category text not null,
  provider text not null,
  name text not null,
  url text,
  rate numeric,
  attrs jsonb not null default '{}',
  source text not null check (source in ('cdr', 'aer', 'sample', 'manual')),
  source_ref text not null,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  unique (category, provider, source_ref)
);
create index catalog_items_category on public.catalog_items (category) where active;
-- Energy plans are looked up by the network (distributor) that serves a postcode.
create index catalog_items_energy on public.catalog_items using gin (attrs jsonb_path_ops) where category = 'energy_plan';

create table public.catalog_runs (
  id bigint generated always as identity primary key,
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  summary jsonb
);

-- Which electricity network serves each postcode, built from the plans' published geography.
create table public.energy_postcodes (
  postcode text not null,
  distributor text not null,
  primary key (postcode, distributor)
);

-- Energy plan details fetched on demand from the AER; read only by the edge function.
create table public.energy_plan_cache (
  plan_key text primary key,
  detail jsonb not null,
  fetched_at timestamptz not null default now()
);

-- ABS CPI, all groups, weighted average of eight capital cities (index points), by quarter ("2026-Q3").
create table public.cpi_quarters (
  quarter text primary key check (quarter ~ '^\d{4}-Q[1-4]$'),
  index_value numeric not null
);

alter table public.catalog_items enable row level security;
alter table public.catalog_runs enable row level security;
alter table public.energy_postcodes enable row level security;
alter table public.energy_plan_cache enable row level security;
alter table public.cpi_quarters enable row level security;

create policy "Anyone can read the catalogue" on public.catalog_items
  for select to anon, authenticated using (active);
create policy "Admins manage the catalogue" on public.catalog_items
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
create policy "Admins read catalogue runs" on public.catalog_runs
  for select to authenticated using (public.is_admin());
create policy "Anyone can read energy postcodes" on public.energy_postcodes
  for select to anon, authenticated using (true);
create policy "Anyone can read CPI" on public.cpi_quarters
  for select to anon, authenticated using (true);

-- Household, assets and products held -------------------------------------------------------------------

create table public.customer_profiles (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  postcode text check (postcode ~ '^\d{4}$'),
  income_band text check (income_band in ('under_50k', '50k_100k', '100k_150k', '150k_200k', 'over_200k')),
  household jsonb not null default '{"people": [], "pets": []}',
  checked_in_at timestamptz,
  updated_at timestamptz not null default now()
);

create table public.assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('home', 'investment_property', 'vehicle', 'cash', 'super', 'investments', 'debt', 'business')),
  label text not null check (length(label) between 1 and 80),
  value numeric check (value >= 0),
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index assets_user on public.assets (user_id);

-- A product the customer holds today, attached to the asset it belongs to (a loan on a home, a policy on a car).
create table public.holdings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  asset_id uuid references public.assets(id) on delete cascade,
  category text not null,
  provider text check (length(provider) <= 80),
  product_name text check (length(product_name) <= 120),
  rate numeric check (rate >= 0 and rate < 100),
  amount numeric check (amount >= 0),
  renewal_date date,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index holdings_user on public.holdings (user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger customer_profiles_touch before update on public.customer_profiles for each row execute function public.touch_updated_at();
create trigger assets_touch before update on public.assets for each row execute function public.touch_updated_at();
create trigger holdings_touch before update on public.holdings for each row execute function public.touch_updated_at();

alter table public.customer_profiles enable row level security;
alter table public.assets enable row level security;
alter table public.holdings enable row level security;

create policy "Own profile" on public.customer_profiles
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "Own assets" on public.assets
  for all to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- A holding may only hang off one of the customer's own assets.
create policy "Own holdings" on public.holdings
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and (asset_id is null or exists (select 1 from public.assets a where a.id = asset_id and a.user_id = (select auth.uid())))
  );

-- Insurance and other partner-quoted products: the request is kept until a licensed partner is connected.
create table public.quote_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category text not null,
  details jsonb not null default '{}',
  status text not null default 'new' check (status in ('new', 'sent', 'closed')),
  created_at timestamptz not null default now()
);
alter table public.quote_requests enable row level security;
create policy "Own quote requests" on public.quote_requests
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy "Create own quote requests" on public.quote_requests
  for insert to authenticated with check (user_id = (select auth.uid()));

-- Inflation Points -------------------------------------------------------------------------------------------

-- How many points each action earns and how often. 'switch' is set per product when commission is confirmed.
create table public.points_actions (
  action text primary key,
  points int not null check (points >= 0),
  per text not null check (per in ('once', 'once_per_ref', 'quarter', 'four_a_year')),
  self_service boolean not null default false,
  label text not null
);
insert into public.points_actions (action, points, per, self_service, label) values
  ('join', 500, 'once', true, 'Joined BeatInflation'),
  ('add_asset', 200, 'once_per_ref', true, 'Added an asset to your profile'),
  ('quarterly_checkin', 100, 'quarter', true, 'Quarterly check-in'),
  ('act_on_alert', 200, 'four_a_year', true, 'Acted on an alert'),
  ('review', 100, 'once_per_ref', false, 'Reviewed a provider'),
  ('referral', 2000, 'once_per_ref', false, 'A friend you referred switched'),
  ('switch', 0, 'once_per_ref', false, 'Switched a product through BeatInflation');

-- Append-only. Redemptions, expiry and clawbacks are negative entries, so the balance is a plain sum.
create table public.points_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  points int not null,
  status text not null check (status in ('pending', 'confirmed', 'redeemed', 'expired', 'clawed_back')),
  action text not null,
  ref text,
  created_at timestamptz not null default now()
);
create index points_ledger_user on public.points_ledger (user_id, created_at desc);

create table public.points_redemptions (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  option text not null check (option in ('gift_card', 'cash', 'home_loan', 'charity')),
  points int not null check (points >= 2000),
  value_dollars numeric not null,
  status text not null default 'requested' check (status in ('requested', 'paid', 'cancelled')),
  created_at timestamptz not null default now()
);

alter table public.points_actions enable row level security;
alter table public.points_ledger enable row level security;
alter table public.points_redemptions enable row level security;
create policy "Anyone can read points actions" on public.points_actions
  for select to anon, authenticated using (true);
create policy "Own points ledger" on public.points_ledger
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());
create policy "Own redemptions" on public.points_redemptions
  for select to authenticated using (user_id = (select auth.uid()) or public.is_admin());

-- Cents per point: 1 cent at launch (2026-Q3), rising with CPI, capped at 5% a year.
create or replace function public.points_cents_per_point()
returns numeric
language sql stable security definer set search_path = ''
as $$
  with base as (select index_value from public.cpi_quarters where quarter = '2026-Q3'),
       latest as (select quarter, index_value from public.cpi_quarters order by quarter desc limit 1),
       growth as (
         select latest.index_value / base.index_value as ratio,
                -- whole quarters since launch, for the cap
                ((left(latest.quarter, 4)::int - 2026) * 4 + right(latest.quarter, 1)::int - 3) as quarters
         from base, latest
       )
  select coalesce(
    (select round(least(greatest(ratio, 1), power(1.05, quarters / 4.0)), 4) from growth),
    1.0);
$$;

create or replace function public.points_summary()
returns table (balance int, pending int, lifetime int, cents_per_point numeric, dollar_value numeric)
language sql stable security definer set search_path = ''
as $$
  with mine as (select points, status from public.points_ledger where user_id = auth.uid()),
       totals as (
         select coalesce(sum(points) filter (where status <> 'pending'), 0)::int as balance,
                coalesce(sum(points) filter (where status = 'pending'), 0)::int as pending,
                coalesce(sum(points) filter (where status = 'confirmed'), 0)::int as lifetime
         from mine
       )
  select t.balance, t.pending, t.lifetime, c.cents, round(t.balance * c.cents / 100, 2)
  from totals t, (select public.points_cents_per_point() as cents) c;
$$;

-- Self-service earning: joining, adding an asset (once per asset type), the quarterly check-in and acting on
-- an alert. Returns the points awarded, or 0 when the action has already been rewarded for its period.
create or replace function public.award_points(p_action text, p_ref text default null)
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  rule public.points_actions;
  already boolean;
begin
  if uid is null then raise exception 'Sign in to earn Inflation Points'; end if;
  select * into rule from public.points_actions where action = p_action;
  if not found or not rule.self_service then raise exception 'That action does not earn points here'; end if;

  if p_action = 'add_asset' and not exists (select 1 from public.assets where user_id = uid and kind = p_ref) then
    raise exception 'Add the asset first';
  end if;

  select case rule.per
    when 'once' then exists (select 1 from public.points_ledger where user_id = uid and action = p_action)
    when 'once_per_ref' then exists (select 1 from public.points_ledger where user_id = uid and action = p_action and ref = p_ref)
    when 'quarter' then exists (select 1 from public.points_ledger where user_id = uid and action = p_action
                                  and date_trunc('quarter', created_at) = date_trunc('quarter', now()))
    when 'four_a_year' then (select count(*) >= 4 from public.points_ledger where user_id = uid and action = p_action
                               and created_at > now() - interval '1 year')
  end into already;
  if already then return 0; end if;

  insert into public.points_ledger (user_id, points, status, action, ref) values (uid, rule.points, 'confirmed', p_action, p_ref);
  if p_action = 'quarterly_checkin' then
    update public.customer_profiles set checked_in_at = now() where user_id = uid;
  end if;
  return rule.points;
end;
$$;

-- Spend points: gift cards and charity at full value; cash or a home loan repayment at 90%. Minimum 2,000 points.
-- Payment is made by hand from the admin portal until a gift card partner is connected.
create or replace function public.redeem_points(p_option text, p_points int)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  bal int;
  cents numeric := public.points_cents_per_point();
  dollars numeric;
  rid bigint;
begin
  if uid is null then raise exception 'Sign in to use your points'; end if;
  if p_option not in ('gift_card', 'cash', 'home_loan', 'charity') then raise exception 'Choose how to use your points'; end if;
  if p_points is null or p_points < 2000 then raise exception 'The minimum is 2,000 points'; end if;
  perform pg_advisory_xact_lock(hashtext(uid::text));
  select coalesce(sum(points) filter (where status <> 'pending'), 0) into bal from public.points_ledger where user_id = uid;
  if p_points > bal then raise exception 'You have % points available', bal; end if;
  dollars := round(p_points * cents / 100 * (case when p_option in ('cash', 'home_loan') then 0.9 else 1 end), 2);
  insert into public.points_ledger (user_id, points, status, action, ref) values (uid, -p_points, 'redeemed', 'redeem', p_option);
  insert into public.points_redemptions (user_id, option, points, value_dollars) values (uid, p_option, p_points, dollars)
    returning id into rid;
  return rid;
end;
$$;

-- Admin-only earning (reviews, referrals, switches confirmed by a partner).
create or replace function public.admin_award_points(p_user uuid, p_action text, p_points int, p_ref text, p_status text default 'confirmed')
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only'; end if;
  if p_status not in ('pending', 'confirmed', 'clawed_back') then raise exception 'Bad status'; end if;
  insert into public.points_ledger (user_id, points, status, action, ref) values (p_user, p_points, p_status, p_action, p_ref);
end;
$$;

revoke execute on function public.award_points(text, text) from public, anon;
revoke execute on function public.redeem_points(text, int) from public, anon;
revoke execute on function public.points_summary() from public, anon;
revoke execute on function public.admin_award_points(uuid, text, int, text, text) from public, anon;
grant execute on function public.award_points(text, text) to authenticated;
grant execute on function public.redeem_points(text, int) to authenticated;
grant execute on function public.points_summary() to authenticated;
grant execute on function public.admin_award_points(uuid, text, int, text, text) to authenticated;
grant execute on function public.points_cents_per_point() to anon, authenticated;

-- Nightly catalogue sync, staggered after the home loan sync (16:00 UTC): banking at 16:20, loans 16:40,
-- energy plan lists in two halves at 17:00 and 17:10, CPI 17:20.
select cron.schedule('catalog-sync-banking', '20 16 * * *', $$
  select net.http_post(url := 'https://fwjiofgwolontlglwrog.supabase.co/functions/v1/sync-catalog?job=banking',
    headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 150000);
$$);
select cron.schedule('catalog-sync-loans', '40 16 * * *', $$
  select net.http_post(url := 'https://fwjiofgwolontlglwrog.supabase.co/functions/v1/sync-catalog?job=loans',
    headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 150000);
$$);
select cron.schedule('catalog-sync-energy-1', '0 17 * * *', $$
  select net.http_post(url := 'https://fwjiofgwolontlglwrog.supabase.co/functions/v1/sync-catalog?job=energy1',
    headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 150000);
$$);
select cron.schedule('catalog-sync-energy-2', '10 17 * * *', $$
  select net.http_post(url := 'https://fwjiofgwolontlglwrog.supabase.co/functions/v1/sync-catalog?job=energy2',
    headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 150000);
$$);
select cron.schedule('catalog-sync-cpi', '20 17 * * *', $$
  select net.http_post(url := 'https://fwjiofgwolontlglwrog.supabase.co/functions/v1/sync-catalog?job=cpi',
    headers := '{"Content-Type": "application/json"}'::jsonb, body := '{}'::jsonb, timeout_milliseconds := 150000);
$$);
