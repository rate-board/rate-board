-- Agent marketplace: any account can switch into agent mode and post rates below a lender's; consumers contact
-- agents (each contact is a lead, priced by a configurable per-lead charge); admins work from a private portal
-- and must pass the authenticator step; notifications go through an email outbox.

begin;

-- Admins ----------------------------------------------------------------------------------------

-- Admin rights now also need a session that has passed the authenticator (TOTP) step.
create or replace function public.is_admin()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
     and exists (select 1 from public.profiles where id = auth.uid() and role = 'admin');
$$;

-- Run from the SQL editor only: select public.make_admin('you@example.com');
create or replace function public.make_admin(p_email text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.profiles set role = 'admin'
  where id = (select id from auth.users where lower(email) = lower(p_email));
  if not found then raise exception 'No account with email %', p_email; end if;
end;
$$;
revoke execute on function public.make_admin(text) from public, anon, authenticated;

-- Profiles: contact details people can keep, and a suspension flag only admins set ---------------

alter table public.profiles
  add column full_name text check (char_length(full_name) <= 100),
  add column mobile text check (mobile ~ '^04[0-9]{8}$'),
  add column suspended boolean not null default false;
grant update (full_name, mobile) on public.profiles to authenticated;

create policy "Admins read profiles" on public.profiles
  for select to authenticated using (public.is_admin());

create or replace function public.guard_profile_flags()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  -- auth.uid() is null in the SQL editor and edge functions, where make_admin() and admin tools run.
  if auth.uid() is not null and new.role is distinct from old.role then
    raise exception 'The admin role can only be granted with make_admin() in the SQL editor';
  end if;
  if auth.uid() is not null and new.suspended is distinct from old.suspended and not public.is_admin() then
    raise exception 'Only admins can suspend accounts';
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.guard_profile_flags();

-- Lender rates for every loan type --------------------------------------------------------------

-- Mirrors REPAY_ADJUST, PURPOSE_ADJUST and LVR_ADJUST in common.js; keep the two in step.
create or replace function public.rate_adjustment(p_product text, p_purpose text, p_repay text, p_lvr text)
returns numeric
language sql immutable set search_path = ''
as $$
  select (case when p_repay = 'io' then case when p_product like 'fixed%' then 0.45 else 0.40 end else 0 end)
       + (case when p_purpose = 'investor'
               then case p_product when 'fixed1' then 0.18 when 'fixed2' then 0.20 when 'fixed3' then 0.20 else 0.15 end
               else 0 end)
       + (case p_lvr when '60' then -0.10 when '90' then 0.35 else 0 end);
$$;

-- The lender rate the board shows for a cell, to 2 decimals; null when the lender doesn't offer it.
create or replace function public.lender_rate(p_lender text, p_product text, p_purpose text, p_repay text, p_lvr text)
returns numeric
language sql stable set search_path = ''
as $$
  select round(r.rate + public.rate_adjustment(p_product, p_purpose, p_repay, p_lvr), 2)
  from public.rates r join public.lenders l on l.id = r.lender_id
  where r.lender_id = p_lender and r.product_key = p_product and l.active;
$$;

create or replace function public.cell_label(p_lender text, p_product text, p_purpose text, p_repay text, p_lvr text)
returns text
language sql stable set search_path = ''
as $$
  select l.name || ' ' || p.label || ' ('
      || case p_purpose when 'owner' then 'Owner Occupied' else 'Investment' end || ', '
      || case p_repay when 'pi' then 'P&I' else 'Interest Only' end || ', '
      || case p_lvr when '60' then '≤60%' when '80' then '60–80%' else '80–90%' end || ' LVR)'
  from public.lenders l, public.products p
  where l.id = p_lender and p.key = p_product;
$$;

-- Email outbox: every notification is queued here, then sent by the marketplace edge function -----

create table public.email_outbox (
  id bigint generated always as identity primary key,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'expired')),
  error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
alter table public.email_outbox enable row level security;
create policy "Admins read email outbox" on public.email_outbox
  for select to authenticated using (public.is_admin());

create or replace function public.user_email(p_user uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select email from auth.users where id = p_user;
$$;

create or replace function public.queue_email(p_to text, p_subject text, p_body text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.email_outbox (to_email, subject, body)
  select p_to, p_subject, p_body || E'\n\n— Home Loan Interest Rates\nhttps://rate-board.github.io/rate-board/'
  where p_to is not null;
$$;

create or replace function public.email_admins(p_subject text, p_body text)
returns void
language sql security definer set search_path = ''
as $$
  select public.queue_email(u.email, p_subject, p_body)
  from public.profiles p join auth.users u on u.id = p.id
  where p.role = 'admin';
$$;

create or replace function public.dispatch_email()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform net.http_post(
    url := 'https://fwjiofgwolontlglwrog.supabase.co/functions/v1/marketplace',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object('action', 'send_email', 'id', new.id),
    timeout_milliseconds := 30000
  );
  return null;
end;
$$;

create trigger email_outbox_dispatch
  after insert on public.email_outbox
  for each row execute function public.dispatch_email();

-- Agents ------------------------------------------------------------------------------------------

-- The agent's mobile lives in profiles.mobile and is only handed out through contact_agent().
create table public.agents (
  id uuid primary key references public.profiles(id) on delete cascade,
  full_name text not null check (char_length(full_name) between 2 and 100),
  business text not null check (char_length(business) between 2 and 120),
  contact_email text not null,
  licence_number text not null check (licence_number ~ '^[0-9]{3,10}$'),
  aggregator text check (char_length(aggregator) <= 80),
  lenders text[] not null check (cardinality(lenders) > 0),
  photo_url text,
  bio text check (char_length(bio) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.agents enable row level security;
create policy "Agents read own agent profile" on public.agents
  for select to authenticated using (id = (select auth.uid()));
create policy "Admins read agents" on public.agents
  for select to authenticated using (public.is_admin());

create or replace function public.agent_status_emails()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.status = 'pending' and (tg_op = 'INSERT' or old.status <> 'pending') then
    perform public.email_admins(
      'Agent waiting for approval: ' || new.full_name,
      new.full_name || ' (' || new.business || ', licence ' || new.licence_number || ') is waiting for approval.'
        || E'\nOpen the admin portal to check the licence on the ASIC register and approve or reject.');
  elsif tg_op = 'UPDATE' and new.status <> old.status then
    perform public.queue_email(
      new.contact_email,
      case new.status
        when 'approved' then 'You''re approved to post agent rates'
        when 'rejected' then 'Your agent application wasn''t approved'
        else 'Your agent account is suspended' end,
      case new.status
        when 'approved' then 'Your agent account is approved. You can now post rates in the agent portal:'
                             || E'\nhttps://rate-board.github.io/rate-board/agent.html'
        when 'rejected' then 'Your application to post agent rates wasn''t approved.'
        else 'Your agent rates are hidden while your account is suspended.' end
        || coalesce(E'\n\nReason: ' || new.status_reason, ''));
  end if;
  return null;
end;
$$;

create trigger agents_status_emails
  after insert or update of status on public.agents
  for each row execute function public.agent_status_emails();

-- Agent rates ---------------------------------------------------------------------------------------

create table public.agent_rates (
  id bigint generated always as identity primary key,
  agent_id uuid not null references public.agents(id) on delete cascade,
  lender_id text not null references public.lenders(id) on delete cascade,
  product_key text not null references public.products(key) on delete cascade,
  purpose text not null check (purpose in ('owner', 'investor')),
  repay text not null check (repay in ('pi', 'io')),
  lvr text not null check (lvr in ('60', '80', '90')),
  rate numeric(5,2) not null check (rate > 0 and rate < 25),
  comparison_rate numeric(5,2) not null check (comparison_rate > 0 and comparison_rate < 25),
  conditions text check (char_length(conditions) <= 200),
  status text not null default 'live' check (status in ('live', 'withdrawn', 'removed')),
  removed_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reminded_at timestamptz
);
create unique index agent_rates_one_live_per_cell on public.agent_rates (agent_id, lender_id, product_key, purpose, repay, lvr)
  where status = 'live';
create index agent_rates_cell on public.agent_rates (lender_id, product_key, purpose, repay, lvr) where status = 'live';
alter table public.agent_rates enable row level security;
create policy "Agents read own rates" on public.agent_rates
  for select to authenticated using (agent_id = (select auth.uid()));
create policy "Admins read agent rates" on public.agent_rates
  for select to authenticated using (public.is_admin());

-- When a lender cuts a rate, agent rates no longer below it drop off the board; tell those agents.
create or replace function public.notify_hidden_agent_rates()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.queue_email(
    public.user_email(ar.agent_id),
    'Your agent rate is hidden: ' || public.cell_label(ar.lender_id, ar.product_key, ar.purpose, ar.repay, ar.lvr),
    'The lender cut its rate to ' || to_char(round(new.rate + public.rate_adjustment(ar.product_key, ar.purpose, ar.repay, ar.lvr), 2), 'FM90.00')
      || '%, so your ' || to_char(ar.rate, 'FM90.00') || '% is no longer below it and consumers can''t see it.'
      || E'\nPost a lower rate in the agent portal to show again: https://rate-board.github.io/rate-board/agent.html')
  from public.agent_rates ar
  where ar.status = 'live' and ar.lender_id = new.lender_id and ar.product_key = new.product_key
    and ar.rate < round(old.rate + public.rate_adjustment(ar.product_key, ar.purpose, ar.repay, ar.lvr), 2)
    and ar.rate >= round(new.rate + public.rate_adjustment(ar.product_key, ar.purpose, ar.repay, ar.lvr), 2);
  return null;
end;
$$;

create trigger rates_hide_agent_rates
  after update of rate on public.rates
  for each row when (new.rate < old.rate)
  execute function public.notify_hidden_agent_rates();

-- Pricing -------------------------------------------------------------------------------------------

create table public.settings (
  id int primary key default 1 check (id = 1),
  per_lead_charge numeric(8,2) not null default 0 check (per_lead_charge >= 0),
  charge_from date not null default current_date,
  previous_charge numeric(8,2) not null default 0,
  live_rate_limit int not null default 50 check (live_rate_limit between 1 and 1000),
  updated_at timestamptz not null default now()
);
insert into public.settings default values;
alter table public.settings enable row level security;
create policy "Signed-in users read settings" on public.settings
  for select to authenticated using (true);
create policy "Admins update settings" on public.settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.lead_charge()
returns numeric
language sql stable security definer set search_path = ''
as $$
  select case when current_date >= charge_from then per_lead_charge else previous_charge end
  from public.settings where id = 1;
$$;

-- A new charge keeps the old one until its start date; a higher charge needs 30 days' notice to agents.
create or replace function public.stamp_settings()
returns trigger
language plpgsql set search_path = ''
as $$
declare
  current_charge numeric;
begin
  current_charge := case when current_date >= old.charge_from then old.per_lead_charge else old.previous_charge end;
  if new.per_lead_charge is distinct from old.per_lead_charge or new.charge_from is distinct from old.charge_from then
    if new.per_lead_charge > current_charge and new.charge_from < current_date + 30 then
      raise exception 'Give agents 30 days'' notice: set the start date to % or later', to_char(current_date + 30, 'DD Mon YYYY');
    end if;
    new.previous_charge := current_charge;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger settings_stamp
  before update on public.settings
  for each row execute function public.stamp_settings();

create or replace function public.settings_emails()
returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.per_lead_charge is distinct from old.per_lead_charge then
    perform public.queue_email(
      a.contact_email,
      'The charge per lead is changing',
      'From ' || to_char(new.charge_from, 'DD Mon YYYY') || ', each lead costs $' || to_char(new.per_lead_charge, 'FM9990.00')
        || ' (ex GST). Until then it stays at $' || to_char(new.previous_charge, 'FM9990.00') || '.')
    from public.agents a where a.status = 'approved';
  end if;
  return null;
end;
$$;

create trigger settings_emails
  after update on public.settings
  for each row execute function public.settings_emails();

-- Leads -----------------------------------------------------------------------------------------------

-- One row per contact: a revealed number or email click (anonymous to the agent), or a call request
-- (shared with the agent on the consumer's consent). Cell and rate are copied so the record outlives the rate.
create table public.leads (
  id bigint generated always as identity primary key,
  agent_id uuid not null references public.agents(id) on delete cascade,
  agent_rate_id bigint references public.agent_rates(id) on delete set null,
  consumer_id uuid references public.profiles(id) on delete set null,
  kind text not null check (kind in ('number', 'email', 'request')),
  lender_id text not null,
  product_key text not null,
  purpose text not null,
  repay text not null,
  lvr text not null,
  rate numeric(5,2) not null,
  name text check (char_length(name) <= 100),
  mobile text,
  email text,
  best_time text check (best_time in ('morning', 'afternoon', 'evening', 'any')),
  message text check (char_length(message) <= 300),
  consent_at timestamptz,
  status text not null default 'new' check (status in ('new', 'contacted', 'applied', 'settled', 'lost')),
  notes text check (char_length(notes) <= 2000),
  billable boolean not null default false,
  charge numeric(8,2) not null default 0,
  dispute_reason text check (char_length(dispute_reason) <= 300),
  dispute_status text check (dispute_status in ('open', 'accepted', 'rejected')),
  created_at timestamptz not null default now()
);
create unique index leads_one_request_per_rate on public.leads (consumer_id, agent_rate_id) where kind = 'request';
create index leads_agent on public.leads (agent_id, created_at desc);
create index leads_consumer on public.leads (consumer_id, created_at desc);
alter table public.leads enable row level security;
create policy "Admins read leads" on public.leads
  for select to authenticated using (public.is_admin());
create policy "Admins update leads" on public.leads
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Billed once per consumer per agent in 30 days, however often they make contact.
create or replace function public.lead_is_billable(p_consumer uuid, p_agent uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from public.leads
    where consumer_id = p_consumer and agent_id = p_agent and billable and created_at > now() - interval '30 days'
  );
$$;

-- Admin activity log ------------------------------------------------------------------------------------

create table public.admin_log (
  id bigint generated always as identity primary key,
  admin_id uuid references public.profiles(id) on delete set null,
  action text not null,
  target text,
  detail jsonb,
  created_at timestamptz not null default now()
);
alter table public.admin_log enable row level security;
create policy "Admins read admin log" on public.admin_log
  for select to authenticated using (public.is_admin());

-- Records every change an admin session makes; nobody can edit or delete the log.
create or replace function public.log_admin_change()
returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  row_after jsonb;
  row_before jsonb;
  target_row jsonb;
begin
  if public.is_admin() then
    if tg_op <> 'DELETE' then row_after := to_jsonb(new); end if;
    if tg_op <> 'INSERT' then row_before := to_jsonb(old); end if;
    target_row := coalesce(row_after, row_before);
    insert into public.admin_log (admin_id, action, target, detail)
    values (auth.uid(), lower(tg_op) || ' ' || tg_table_name,
            coalesce(target_row ->> 'id', concat_ws('/', target_row ->> 'lender_id', target_row ->> 'product_key')),
            jsonb_strip_nulls(jsonb_build_object('before', row_before, 'after', row_after)));
  end if;
  return null;
end;
$$;

create trigger agents_admin_log after insert or update or delete on public.agents
  for each row execute function public.log_admin_change();
create trigger agent_rates_admin_log after insert or update or delete on public.agent_rates
  for each row execute function public.log_admin_change();
create trigger leads_admin_log after insert or update or delete on public.leads
  for each row execute function public.log_admin_change();
create trigger settings_admin_log after update on public.settings
  for each row execute function public.log_admin_change();
create trigger profiles_admin_log after update on public.profiles
  for each row execute function public.log_admin_change();
create trigger rates_admin_log after insert or update or delete on public.rates
  for each row execute function public.log_admin_change();
create trigger lenders_admin_log after insert or update or delete on public.lenders
  for each row execute function public.log_admin_change();

-- Agent photos ----------------------------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('agent-photos', 'agent-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "Agents upload own photo" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'agent-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Agents replace own photo" on storage.objects
  for update to authenticated
  using (bucket_id = 'agent-photos' and (storage.foldername(name))[1] = (select auth.uid()::text))
  with check (bucket_id = 'agent-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));
create policy "Agents delete own photo" on storage.objects
  for delete to authenticated
  using (bucket_id = 'agent-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- Consumer functions ------------------------------------------------------------------------------------------

-- Every live agent rate from approved agents that is still below the lender's, lowest first. No mobiles here.
create or replace function public.board_agent_rates()
returns table (
  id bigint, agent_id uuid, agent_name text, business text, contact_email text, photo_url text, bio text,
  lender_id text, product_key text, purpose text, repay text, lvr text,
  rate numeric, comparison_rate numeric, conditions text, created_at timestamptz, updated_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select ar.id, a.id, a.full_name, a.business, a.contact_email, a.photo_url, a.bio,
         ar.lender_id, ar.product_key, ar.purpose, ar.repay, ar.lvr,
         ar.rate, ar.comparison_rate, ar.conditions, ar.created_at, ar.updated_at
  from public.agent_rates ar
  join public.agents a on a.id = ar.agent_id
  join public.profiles p on p.id = a.id
  where auth.uid() is not null
    and ar.status = 'live' and a.status = 'approved' and not p.suspended
    and ar.rate < public.lender_rate(ar.lender_id, ar.product_key, ar.purpose, ar.repay, ar.lvr)
  order by ar.rate, ar.created_at;
$$;

-- Show number / Email: hands over the agent's contact details and records the lead.
create or replace function public.contact_agent(p_rate_id bigint, p_kind text)
returns table (agent_mobile text, agent_email text)
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r record;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if p_kind not in ('number', 'email') then raise exception 'Unknown contact type'; end if;
  if exists (select 1 from public.profiles where id = me and suspended) then raise exception 'Your account is suspended'; end if;
  select ar.*, a.contact_email, p.mobile as agent_mobile into r
  from public.agent_rates ar join public.agents a on a.id = ar.agent_id join public.profiles p on p.id = a.id
  where ar.id = p_rate_id and ar.status = 'live' and a.status = 'approved' and not p.suspended;
  if not found then raise exception 'This agent rate is no longer available'; end if;

  if r.agent_id <> me and not exists (
    select 1 from public.leads l where l.consumer_id = me and l.agent_id = r.agent_id and l.created_at > now() - interval '30 days'
  ) then
    insert into public.leads (agent_id, agent_rate_id, consumer_id, kind, lender_id, product_key, purpose, repay, lvr, rate, billable, charge)
    values (r.agent_id, r.id, me, p_kind, r.lender_id, r.product_key, r.purpose, r.repay, r.lvr, r.rate,
            public.lead_is_billable(me, r.agent_id),
            case when public.lead_is_billable(me, r.agent_id) then public.lead_charge() else 0 end);
    perform public.queue_email(
      r.contact_email,
      'New lead: ' || public.cell_label(r.lender_id, r.product_key, r.purpose, r.repay, r.lvr),
      'A consumer ' || case p_kind when 'number' then 'viewed your mobile number' else 'clicked to email you' end
        || ' for your ' || to_char(r.rate, 'FM90.00') || '% rate on ' || public.cell_label(r.lender_id, r.product_key, r.purpose, r.repay, r.lvr)
        || E'.\nThey may get in touch directly. See your leads: https://rate-board.github.io/rate-board/agent.html#leads');
  end if;

  return query select r.agent_mobile, r.contact_email;
end;
$$;

create or replace function public.request_call(
  p_rate_id bigint, p_name text, p_mobile text, p_best_time text, p_message text, p_consent boolean, p_save boolean
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  r record;
  is_billable boolean;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.profiles where id = me and suspended) then raise exception 'Your account is suspended'; end if;
  if not coalesce(p_consent, false) then raise exception 'Tick the box to agree to share your details'; end if;
  p_name := trim(coalesce(p_name, ''));
  p_mobile := regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g');
  if char_length(p_name) < 2 then raise exception 'Enter your name'; end if;
  if p_mobile !~ '^04[0-9]{8}$' then raise exception 'Enter an Australian mobile number, e.g. 0412 345 678'; end if;
  if p_best_time is not null and p_best_time not in ('morning', 'afternoon', 'evening', 'any') then p_best_time := null; end if;

  select ar.*, a.contact_email into r
  from public.agent_rates ar join public.agents a on a.id = ar.agent_id join public.profiles p on p.id = a.id
  where ar.id = p_rate_id and ar.status = 'live' and a.status = 'approved' and not p.suspended;
  if not found then raise exception 'This agent rate is no longer available'; end if;
  if r.agent_id = me then raise exception 'You can''t request a call from yourself'; end if;
  if exists (select 1 from public.leads where consumer_id = me and agent_rate_id = p_rate_id and kind = 'request') then
    raise exception 'Already requested';
  end if;
  if (select count(*) from public.leads where consumer_id = me and kind = 'request' and created_at > now() - interval '1 day') >= 10 then
    raise exception 'You can send up to 10 call requests a day';
  end if;

  is_billable := public.lead_is_billable(me, r.agent_id);
  insert into public.leads (agent_id, agent_rate_id, consumer_id, kind, lender_id, product_key, purpose, repay, lvr, rate,
                            name, mobile, email, best_time, message, consent_at, billable, charge)
  values (r.agent_id, r.id, me, 'request', r.lender_id, r.product_key, r.purpose, r.repay, r.lvr, r.rate,
          p_name, p_mobile, public.user_email(me), p_best_time, nullif(trim(coalesce(p_message, '')), ''), now(),
          is_billable, case when is_billable then public.lead_charge() else 0 end);

  if coalesce(p_save, false) then
    update public.profiles set full_name = p_name, mobile = p_mobile where id = me;
  end if;

  perform public.queue_email(
    r.contact_email,
    'Call request from ' || p_name || ': ' || public.cell_label(r.lender_id, r.product_key, r.purpose, r.repay, r.lvr),
    p_name || ' would like a call about your ' || to_char(r.rate, 'FM90.00') || '% rate on '
      || public.cell_label(r.lender_id, r.product_key, r.purpose, r.repay, r.lvr) || '.'
      || E'\n\nMobile: ' || p_mobile
      || E'\nEmail: ' || public.user_email(me)
      || coalesce(E'\nBest time: ' || p_best_time, '')
      || coalesce(E'\nMessage: ' || nullif(trim(coalesce(p_message, '')), ''), '')
      || E'\n\nThey agreed to share these details with you for this rate only.'
      || E'\nManage your leads: https://rate-board.github.io/rate-board/agent.html#leads');
end;
$$;

create or replace function public.my_requests()
returns table (
  id bigint, agent_rate_id bigint, created_at timestamptz, status text, lender_id text, product_key text,
  purpose text, repay text, lvr text, rate numeric, agent_name text, business text
)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.agent_rate_id, l.created_at, l.status, l.lender_id, l.product_key, l.purpose, l.repay, l.lvr, l.rate,
         a.full_name, a.business
  from public.leads l join public.agents a on a.id = l.agent_id
  where l.consumer_id = auth.uid() and l.kind = 'request'
  order by l.created_at desc;
$$;

-- Agent functions ---------------------------------------------------------------------------------------------

-- Creates or updates the caller's agent profile. A new profile, a rejected one, or a licence change needs approval.
create or replace function public.become_agent(
  p_full_name text, p_mobile text, p_business text, p_licence text, p_aggregator text, p_lenders text[],
  p_bio text, p_photo_url text
)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  existing public.agents;
  licence text := regexp_replace(coalesce(p_licence, ''), '\s', '', 'g');
  next_status text;
begin
  if me is null then raise exception 'Sign in first'; end if;
  if exists (select 1 from public.profiles where id = me and suspended) then raise exception 'Your account is suspended'; end if;
  p_full_name := trim(coalesce(p_full_name, ''));
  p_business := trim(coalesce(p_business, ''));
  p_mobile := regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g');
  if char_length(p_full_name) < 2 then raise exception 'Enter your full name'; end if;
  if char_length(p_business) < 2 then raise exception 'Enter your business name'; end if;
  if p_mobile !~ '^04[0-9]{8}$' then raise exception 'Enter an Australian mobile number, e.g. 0412 345 678'; end if;
  if licence !~ '^[0-9]{3,10}$' then raise exception 'Enter your credit licence or credit representative number (digits only)'; end if;
  if coalesce(cardinality(p_lenders), 0) = 0 then raise exception 'Choose at least one lender you are accredited with'; end if;
  if exists (select unnest(p_lenders) except select id from public.lenders) then raise exception 'Unknown lender in your list'; end if;
  if p_photo_url is not null
     and p_photo_url not like 'https://fwjiofgwolontlglwrog.supabase.co/storage/v1/object/public/agent-photos/' || me::text || '/%' then
    raise exception 'Upload your photo again';
  end if;

  update public.profiles set full_name = p_full_name, mobile = p_mobile where id = me;

  select * into existing from public.agents where id = me;
  if not found then
    insert into public.agents (id, full_name, business, contact_email, licence_number, aggregator, lenders, bio, photo_url)
    values (me, p_full_name, p_business, public.user_email(me), licence, nullif(trim(coalesce(p_aggregator, '')), ''),
            p_lenders, nullif(trim(coalesce(p_bio, '')), ''), p_photo_url);
    return 'pending';
  end if;

  next_status := case
    when existing.status = 'rejected' then 'pending'
    when existing.status = 'approved' and existing.licence_number <> licence then 'pending'
    else existing.status end;
  update public.agents set
    full_name = p_full_name, business = p_business, licence_number = licence,
    aggregator = nullif(trim(coalesce(p_aggregator, '')), ''), lenders = p_lenders,
    bio = nullif(trim(coalesce(p_bio, '')), ''), photo_url = p_photo_url,
    status = next_status, status_reason = case when next_status = existing.status then status_reason end,
    updated_at = now()
  where id = me;
  -- Rates on lenders no longer in the accredited list come down.
  update public.agent_rates set status = 'withdrawn', updated_at = now()
  where agent_id = me and status = 'live' and not (lender_id = any (p_lenders));
  return next_status;
end;
$$;

-- Posts a rate on one cell, replacing the agent's earlier rate there. Live at once; no approval per rate.
create or replace function public.post_agent_rate(
  p_lender text, p_product text, p_purpose text, p_repay text, p_lvr text,
  p_rate numeric, p_comparison_rate numeric, p_conditions text
)
returns bigint
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
  agent public.agents;
  lender_name text;
  lr numeric;
  prev_min numeric;
  rate_limit int;
  rate_id bigint;
  label text;
begin
  select * into agent from public.agents where id = me;
  if not found then raise exception 'Become an agent first'; end if;
  if exists (select 1 from public.profiles where id = me and suspended) then raise exception 'Your account is suspended'; end if;
  if agent.status <> 'approved' then
    raise exception 'Your agent account is %', case agent.status when 'pending' then 'waiting for approval' else agent.status end;
  end if;
  if p_purpose not in ('owner', 'investor') or p_repay not in ('pi', 'io') or p_lvr not in ('60', '80', '90') then
    raise exception 'Unknown loan type';
  end if;
  if not (p_lender = any (agent.lenders)) then raise exception 'Add this lender to your accredited lenders first'; end if;
  if p_rate is null or p_comparison_rate is null then raise exception 'Enter your rate and comparison rate'; end if;
  p_rate := round(p_rate, 2);
  p_comparison_rate := round(p_comparison_rate, 2);
  if p_comparison_rate < 1 or p_comparison_rate > 20 then raise exception 'Enter a comparison rate between 1%% and 20%%'; end if;

  select name into lender_name from public.lenders where id = p_lender;
  lr := public.lender_rate(p_lender, p_product, p_purpose, p_repay, p_lvr);
  if lr is null then raise exception '% doesn''t offer this product', coalesce(lender_name, 'This lender'); end if;
  if p_rate > lr - 0.01 then
    raise exception 'Your rate must be lower than %''s %', lender_name, to_char(lr, 'FM90.00') || '%';
  end if;

  select live_rate_limit into rate_limit from public.settings where id = 1;
  if (select count(*) from public.agent_rates
      where agent_id = me and status = 'live'
        and (lender_id, product_key, purpose, repay, lvr) is distinct from (p_lender, p_product, p_purpose, p_repay, p_lvr)) >= rate_limit then
    raise exception 'You can have up to % live rates; withdraw one first', rate_limit;
  end if;

  select min(ar.rate) into prev_min
  from public.agent_rates ar join public.agents a on a.id = ar.agent_id
  where ar.status = 'live' and a.status = 'approved' and ar.agent_id <> me
    and ar.lender_id = p_lender and ar.product_key = p_product and ar.purpose = p_purpose and ar.repay = p_repay and ar.lvr = p_lvr;

  update public.agent_rates
  set rate = p_rate, comparison_rate = p_comparison_rate, conditions = nullif(trim(coalesce(p_conditions, '')), ''),
      updated_at = now(), reminded_at = null
  where agent_id = me and status = 'live'
    and lender_id = p_lender and product_key = p_product and purpose = p_purpose and repay = p_repay and lvr = p_lvr
  returning id into rate_id;
  if rate_id is null then
    insert into public.agent_rates (agent_id, lender_id, product_key, purpose, repay, lvr, rate, comparison_rate, conditions)
    values (me, p_lender, p_product, p_purpose, p_repay, p_lvr, p_rate, p_comparison_rate, nullif(trim(coalesce(p_conditions, '')), ''))
    returning id into rate_id;
  end if;

  -- Agents who held the lowest rate on this cell hear they've been beaten.
  if prev_min is not null and p_rate < prev_min then
    label := public.cell_label(p_lender, p_product, p_purpose, p_repay, p_lvr);
    perform public.queue_email(
      public.user_email(ar.agent_id),
      'Another agent is now lower on ' || label,
      'An agent posted ' || to_char(p_rate, 'FM90.00') || '% on ' || label || ', below your ' || to_char(ar.rate, 'FM90.00') || '%.'
        || E'\nYour rate is still listed. Review it in the agent portal: https://rate-board.github.io/rate-board/agent.html')
    from public.agent_rates ar
    where ar.status = 'live' and ar.agent_id <> me and ar.rate = prev_min
      and ar.lender_id = p_lender and ar.product_key = p_product and ar.purpose = p_purpose and ar.repay = p_repay and ar.lvr = p_lvr;
  end if;
  return rate_id;
end;
$$;

create or replace function public.withdraw_agent_rate(p_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.agent_rates set status = 'withdrawn', updated_at = now()
  where id = p_id and agent_id = auth.uid() and status = 'live';
  if not found then raise exception 'That rate is no longer live'; end if;
end;
$$;

-- Click leads stay anonymous to the agent; only call requests carry the consumer's details.
create or replace function public.my_leads()
returns table (
  id bigint, kind text, created_at timestamptz, lender_id text, product_key text, purpose text, repay text, lvr text,
  rate numeric, name text, mobile text, email text, best_time text, message text, status text, notes text,
  billable boolean, charge numeric, dispute_reason text, dispute_status text
)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.kind, l.created_at, l.lender_id, l.product_key, l.purpose, l.repay, l.lvr, l.rate,
         case when l.kind = 'request' then l.name end,
         case when l.kind = 'request' then l.mobile end,
         case when l.kind = 'request' then l.email end,
         l.best_time, l.message, l.status, l.notes, l.billable, l.charge, l.dispute_reason, l.dispute_status
  from public.leads l
  where l.agent_id = auth.uid()
  order by l.created_at desc;
$$;

create or replace function public.update_lead(p_id bigint, p_status text, p_notes text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if p_status not in ('new', 'contacted', 'applied', 'settled', 'lost') then raise exception 'Unknown status'; end if;
  update public.leads set status = p_status, notes = nullif(trim(coalesce(p_notes, '')), '')
  where id = p_id and agent_id = auth.uid();
  if not found then raise exception 'Lead not found'; end if;
end;
$$;

create or replace function public.dispute_lead(p_id bigint, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.leads;
begin
  p_reason := trim(coalesce(p_reason, ''));
  if char_length(p_reason) < 5 then raise exception 'Say briefly why this lead is invalid'; end if;
  select * into l from public.leads where id = p_id and agent_id = auth.uid();
  if not found then raise exception 'Lead not found'; end if;
  if l.dispute_status is not null then raise exception 'This lead has already been disputed'; end if;
  if l.created_at < now() - interval '7 days' then raise exception 'Leads can be disputed within 7 days'; end if;
  update public.leads set dispute_reason = p_reason, dispute_status = 'open' where id = p_id;
  perform public.email_admins('Lead disputed by ' || (select full_name from public.agents where id = auth.uid()),
                              'Lead ' || p_id || E' was disputed.\nReason: ' || p_reason || E'\nReview it on the Leads page of the admin portal.');
end;
$$;

-- Admin functions ------------------------------------------------------------------------------------------------

create or replace function public.require_admin()
returns void
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admins only (sign in to the admin portal with your authenticator code)'; end if;
end;
$$;

create or replace function public.admin_users()
returns table (
  id uuid, email text, created_at timestamptz, last_sign_in_at timestamptz, full_name text, mobile text,
  suspended boolean, role text, agent_status text, requests_sent bigint, leads_created bigint
)
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return query
  select p.id, u.email::text, u.created_at, u.last_sign_in_at, p.full_name, p.mobile, p.suspended, p.role, a.status,
         (select count(*) from public.leads l where l.consumer_id = p.id and l.kind = 'request'),
         (select count(*) from public.leads l where l.consumer_id = p.id)
  from public.profiles p
  join auth.users u on u.id = p.id
  left join public.agents a on a.id = p.id
  order by u.created_at desc;
end;
$$;

create or replace function public.admin_set_suspended(p_user uuid, p_suspended boolean)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  if exists (select 1 from public.profiles where id = p_user and role = 'admin') then raise exception 'Admins can''t be suspended here'; end if;
  update public.profiles set suspended = p_suspended where id = p_user;
end;
$$;

create or replace function public.admin_set_agent_status(p_agent uuid, p_status text, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  if p_status not in ('approved', 'rejected', 'suspended') then raise exception 'Unknown status'; end if;
  update public.agents set status = p_status, status_reason = nullif(trim(coalesce(p_reason, '')), ''), updated_at = now()
  where id = p_agent;
  if not found then raise exception 'Agent not found'; end if;
end;
$$;

create or replace function public.admin_update_agent(
  p_agent uuid, p_full_name text, p_mobile text, p_business text, p_licence text, p_aggregator text, p_lenders text[], p_bio text
)
returns void
language plpgsql security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  p_mobile := regexp_replace(coalesce(p_mobile, ''), '[^0-9]', '', 'g');
  if p_mobile !~ '^04[0-9]{8}$' then raise exception 'Enter an Australian mobile number'; end if;
  if coalesce(cardinality(p_lenders), 0) = 0 then raise exception 'Choose at least one lender'; end if;
  update public.profiles set full_name = trim(p_full_name), mobile = p_mobile where id = p_agent;
  update public.agents set
    full_name = trim(p_full_name), business = trim(p_business),
    licence_number = regexp_replace(coalesce(p_licence, ''), '\s', '', 'g'),
    aggregator = nullif(trim(coalesce(p_aggregator, '')), ''), lenders = p_lenders,
    bio = nullif(trim(coalesce(p_bio, '')), ''), updated_at = now()
  where id = p_agent;
  if not found then raise exception 'Agent not found'; end if;
  update public.agent_rates set status = 'withdrawn', updated_at = now()
  where agent_id = p_agent and status = 'live' and not (lender_id = any (p_lenders));
end;
$$;

create or replace function public.admin_remove_agent_rate(p_id bigint, p_reason text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  ar public.agent_rates;
begin
  perform public.require_admin();
  p_reason := trim(coalesce(p_reason, ''));
  if char_length(p_reason) < 5 then raise exception 'Give the agent a reason'; end if;
  update public.agent_rates set status = 'removed', removed_reason = p_reason, updated_at = now()
  where id = p_id and status = 'live'
  returning * into ar;
  if ar.id is null then raise exception 'That rate is no longer live'; end if;
  perform public.queue_email(
    public.user_email(ar.agent_id),
    'Your agent rate was removed: ' || public.cell_label(ar.lender_id, ar.product_key, ar.purpose, ar.repay, ar.lvr),
    'Your ' || to_char(ar.rate, 'FM90.00') || '% rate on ' || public.cell_label(ar.lender_id, ar.product_key, ar.purpose, ar.repay, ar.lvr)
      || E' was removed by the site admin.\nReason: ' || p_reason);
end;
$$;

create or replace function public.admin_stats()
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
begin
  perform public.require_admin();
  return jsonb_build_object(
    'consumers_week', (select count(*) from auth.users where created_at > now() - interval '7 days'),
    'agents_week', (select count(*) from public.agents where created_at > now() - interval '7 days'),
    'users_total', (select count(*) from public.profiles),
    'agents_pending', (select count(*) from public.agents where status = 'pending'),
    'agents_approved', (select count(*) from public.agents where status = 'approved'),
    'live_rates', (select count(*) from public.agent_rates where status = 'live'),
    'leads_week', (select count(*) from public.leads where created_at > now() - interval '7 days'),
    'requests_week', (select count(*) from public.leads where kind = 'request' and created_at > now() - interval '7 days'),
    'billable_month', (select count(*) from public.leads where billable and created_at >= date_trunc('month', now())),
    'charges_month', (select coalesce(sum(charge), 0) from public.leads where billable and created_at >= date_trunc('month', now())),
    'open_disputes', (select count(*) from public.leads where dispute_status = 'open'),
    'emails_queued', (select count(*) from public.email_outbox where status = 'queued')
  );
end;
$$;

-- Edge function helper: find an account by email (service role only).
create or replace function public.user_id_by_email(p_email text)
returns uuid
language sql stable security definer set search_path = ''
as $$
  select id from auth.users where lower(email) = lower(p_email);
$$;

-- Reminders --------------------------------------------------------------------------------------------------------

create or replace function public.remind_stale_agent_rates()
returns void
language sql security definer set search_path = ''
as $$
  with stale as (
    update public.agent_rates
    set reminded_at = now()
    where status = 'live' and updated_at < now() - interval '30 days'
      and (reminded_at is null or reminded_at < now() - interval '30 days')
    returning agent_id, lender_id, product_key, purpose, repay, lvr, rate
  )
  select public.queue_email(
    public.user_email(agent_id),
    'Is your rate still current? ' || public.cell_label(lender_id, product_key, purpose, repay, lvr),
    'Your ' || to_char(rate, 'FM90.00') || '% rate on ' || public.cell_label(lender_id, product_key, purpose, repay, lvr)
      || E' hasn''t been updated for 30 days. Consumers see when it was last updated.'
      || E'\nConfirm or change it in the agent portal: https://rate-board.github.io/rate-board/agent.html')
  from stale;
$$;

-- 23:00 UTC = 10am Sydney daylight time.
select cron.schedule('agent-rate-reminders', '0 23 * * *', $$select public.remind_stale_agent_rates()$$);

-- Function access ----------------------------------------------------------------------------------------------------

-- Internal helpers: not callable through the API.
revoke execute on function public.user_email(uuid) from public, anon, authenticated;
revoke execute on function public.queue_email(text, text, text) from public, anon, authenticated;
revoke execute on function public.email_admins(text, text) from public, anon, authenticated;
revoke execute on function public.lead_is_billable(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.user_id_by_email(text) from public, anon, authenticated;
revoke execute on function public.remind_stale_agent_rates() from public, anon, authenticated;

-- Signed-in functions: never for anonymous visitors.
revoke execute on function public.board_agent_rates() from public, anon;
revoke execute on function public.contact_agent(bigint, text) from public, anon;
revoke execute on function public.request_call(bigint, text, text, text, text, boolean, boolean) from public, anon;
revoke execute on function public.my_requests() from public, anon;
revoke execute on function public.become_agent(text, text, text, text, text, text[], text, text) from public, anon;
revoke execute on function public.post_agent_rate(text, text, text, text, text, numeric, numeric, text) from public, anon;
revoke execute on function public.withdraw_agent_rate(bigint) from public, anon;
revoke execute on function public.my_leads() from public, anon;
revoke execute on function public.update_lead(bigint, text, text) from public, anon;
revoke execute on function public.dispute_lead(bigint, text) from public, anon;
revoke execute on function public.admin_users() from public, anon;
revoke execute on function public.admin_set_suspended(uuid, boolean) from public, anon;
revoke execute on function public.admin_set_agent_status(uuid, text, text) from public, anon;
revoke execute on function public.admin_update_agent(uuid, text, text, text, text, text, text[], text) from public, anon;
revoke execute on function public.admin_remove_agent_rate(bigint, text) from public, anon;
revoke execute on function public.admin_stats() from public, anon;

commit;
