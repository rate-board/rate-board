-- Rate Board schema: lenders, products, current rates, rate history, user profiles.

create table public.lenders (
  id text primary key,
  name text not null unique,
  source_url text,
  note text,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.products (
  key text primary key,
  label text not null,
  sort_order int not null default 0
);

-- Current published rate: owner-occupier, P&I, 60-80% LVR. No row = product not offered.
create table public.rates (
  lender_id text not null references public.lenders(id) on delete cascade,
  product_key text not null references public.products(key) on delete cascade,
  rate numeric(5,3) not null check (rate > 0 and rate < 25),
  comparison_rate numeric(5,3) not null check (comparison_rate > 0 and comparison_rate < 25),
  as_of date not null default current_date,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  primary key (lender_id, product_key)
);

-- Append-only log of every rate change; written only by the trigger below.
create table public.rate_history (
  id bigint generated always as identity primary key,
  lender_id text not null references public.lenders(id) on delete cascade,
  product_key text not null references public.products(key) on delete cascade,
  rate numeric(5,3),
  comparison_rate numeric(5,3),
  as_of date,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null
);
create index rate_history_lookup on public.rate_history (lender_id, product_key, changed_at desc);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now()
);

-- Helpers and triggers ------------------------------------------------------

create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.stamp_rate()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

create trigger rates_stamp
  before insert or update on public.rates
  for each row execute function public.stamp_rate();

create or replace function public.log_rate_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    insert into public.rate_history (lender_id, product_key, rate, comparison_rate, as_of, changed_by)
    values (old.lender_id, old.product_key, null, null, current_date, auth.uid());
  elsif tg_op = 'INSERT'
     or (old.rate, old.comparison_rate, old.as_of) is distinct from (new.rate, new.comparison_rate, new.as_of) then
    insert into public.rate_history (lender_id, product_key, rate, comparison_rate, as_of, changed_by)
    values (new.lender_id, new.product_key, new.rate, new.comparison_rate, new.as_of, auth.uid());
  end if;
  return null;
end;
$$;

create trigger rates_log
  after insert or update or delete on public.rates
  for each row execute function public.log_rate_change();

-- Row-level security ----------------------------------------------------------

alter table public.lenders enable row level security;
alter table public.products enable row level security;
alter table public.rates enable row level security;
alter table public.rate_history enable row level security;
alter table public.profiles enable row level security;

create policy "Anyone can read lenders" on public.lenders
  for select to anon, authenticated using (true);
create policy "Admins manage lenders" on public.lenders
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Anyone can read products" on public.products
  for select to anon, authenticated using (true);
create policy "Admins manage products" on public.products
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Anyone can read rates" on public.rates
  for select to anon, authenticated using (true);
create policy "Admins manage rates" on public.rates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Anyone can read rate history" on public.rate_history
  for select to anon, authenticated using (true);

create policy "Users read own profile" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "Users update own profile" on public.profiles
  for update to authenticated using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- Users may edit their display name but never their own role.
revoke update on public.profiles from anon, authenticated;
grant update (display_name) on public.profiles to authenticated;
