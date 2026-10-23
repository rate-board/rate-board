-- Nightly sync of rates from lenders' Open Banking (CDR) product APIs.

-- Where each lender publishes its products; null = maintained by hand.
alter table public.lenders add column cdr_base_uri text;

update public.lenders l set cdr_base_uri = v.uri
from (values
  ('cba', 'https://api.commbank.com.au/public'),
  ('westpac', 'https://digital-api.westpac.com.au'),
  ('nab', 'https://openbank.api.nab.com.au'),
  ('anz', 'https://api.anz'),
  ('macquarie', 'https://api.macquariebank.io'),
  ('ing', 'https://id.ob.ing.com.au'),
  ('bankwest', 'https://open-api.bankwest.com.au/bwpublic'),
  ('boq', 'https://api.cds.boq.com.au'),
  ('st-george', 'https://digital-api.stgeorge.com.au'),
  ('bendigo-bank', 'https://api.cdr.bendigobank.com.au'),
  ('amp-bank', 'https://api.cdr-api.amp.com.au'),
  ('me-bank', 'https://api.cds.mebank.com.au'),
  ('people-first-bank', 'https://public.openbanking.peoplefirstbank.com.au'),
  ('ubank', 'https://public.cdr-api.86400.com.au'),
  ('unloan', 'https://public.api.cdr.unloan.com.au'),
  ('liberty-financial', 'https://services.liberty.com.au/api/data-holder-public'),
  ('virgin-money', 'https://api.cds.virginmoney.com.au'),
  ('tic-toc', 'https://api.tiimely.app.bendigobank.com.au')
) as v(id, uri)
where l.id = v.id;

-- Which lender product a rate came from, whether it was synced or entered by hand, and when it was last confirmed.
alter table public.rates
  add column source text not null default 'manual' check (source in ('manual', 'cdr')),
  add column product_name text,
  add column checked_at timestamptz;

-- Split variable into basic (no package) and package (offset / annual package fee) columns.
update public.products set label = 'Variable (Basic)' where key = 'variable';
update public.products set sort_order = sort_order + 1 where key in ('fixed1', 'fixed2', 'fixed3');
insert into public.products (key, label, sort_order) values ('variable_package', 'Variable (Package)', 2);

-- One row per sync run, with per-lender results; visible to admins only.
create table public.sync_runs (
  id bigint generated always as identity primary key,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'partial', 'failed')),
  summary jsonb
);
alter table public.sync_runs enable row level security;
create policy "Admins read sync runs" on public.sync_runs
  for select to authenticated using (public.is_admin());

-- Run nightly at 16:00 UTC = 3am Sydney daylight time (2am standard time).
create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

select cron.schedule(
  'nightly-rate-sync',
  '0 16 * * *',
  $$
  select net.http_post(
    url := 'https://fwjiofgwolontlglwrog.supabase.co/functions/v1/sync-rates',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $$
);
