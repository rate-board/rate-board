-- Consumer experience additions: cancelling a call request, and reporting a rate that looks wrong.
-- Additive only, so the live board and agent portal keep working unchanged.

begin;

-- Cancelling a call request ------------------------------------------------------------------------------

alter table public.leads add column cancelled_at timestamptz;

-- A consumer can cancel their request until the agent has moved it past "new"; it is no longer billed.
create or replace function public.cancel_call_request(p_id bigint)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  l public.leads;
begin
  select * into l from public.leads where id = p_id and consumer_id = auth.uid() and kind = 'request';
  if not found then raise exception 'Request not found'; end if;
  if l.cancelled_at is not null then raise exception 'This request is already cancelled'; end if;
  if l.status <> 'new' then raise exception 'The agent has already been in touch, so this request can''t be cancelled'; end if;
  update public.leads set cancelled_at = now(), billable = false, charge = 0 where id = p_id;
  perform public.queue_email(
    (select contact_email from public.agents where id = l.agent_id),
    'Call request cancelled: ' || coalesce(l.name, 'a consumer'),
    coalesce(l.name, 'A consumer') || ' cancelled their call request about your ' || to_char(l.rate, 'FM90.00') || '% rate on '
      || public.cell_label(l.lender_id, l.product_key, l.purpose, l.repay, l.lvr)
      || E'. Please don''t contact them about it. This lead won''t be billed.');
end;
$$;

-- my_requests gains cancelled_at; its result shape changes, so it is dropped and recreated.
drop function public.my_requests();
create function public.my_requests()
returns table (
  id bigint, agent_rate_id bigint, created_at timestamptz, status text, lender_id text, product_key text,
  purpose text, repay text, lvr text, rate numeric, agent_name text, business text, cancelled_at timestamptz
)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.agent_rate_id, l.created_at, l.status, l.lender_id, l.product_key, l.purpose, l.repay, l.lvr, l.rate,
         a.full_name, a.business, l.cancelled_at
  from public.leads l join public.agents a on a.id = l.agent_id
  where l.consumer_id = auth.uid() and l.kind = 'request'
  order by l.created_at desc;
$$;

-- Reporting a wrong rate ---------------------------------------------------------------------------------

create table public.rate_reports (
  id bigint generated always as identity primary key,
  reporter_id uuid references public.profiles(id) on delete set null,
  lender_id text not null,
  product_key text not null,
  purpose text not null,
  repay text not null,
  lvr text not null,
  shown_rate numeric(5,2),
  message text not null check (char_length(message) between 5 and 500),
  status text not null default 'open' check (status in ('open', 'resolved')),
  created_at timestamptz not null default now()
);
alter table public.rate_reports enable row level security;
create policy "Admins read rate reports" on public.rate_reports
  for select to authenticated using (public.is_admin());
create policy "Admins update rate reports" on public.rate_reports
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.report_rate(
  p_lender text, p_product text, p_purpose text, p_repay text, p_lvr text, p_shown_rate numeric, p_message text
)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  me uuid := auth.uid();
begin
  if me is null then raise exception 'Sign in first'; end if;
  p_message := trim(coalesce(p_message, ''));
  if char_length(p_message) < 5 then raise exception 'Tell us briefly what looks wrong'; end if;
  if char_length(p_message) > 500 then raise exception 'Keep it under 500 characters'; end if;
  if (select count(*) from public.rate_reports where reporter_id = me and created_at > now() - interval '1 day') >= 5 then
    raise exception 'You can send up to 5 reports a day';
  end if;
  insert into public.rate_reports (reporter_id, lender_id, product_key, purpose, repay, lvr, shown_rate, message)
  values (me, p_lender, p_product, p_purpose, p_repay, p_lvr, p_shown_rate, p_message);
  perform public.email_admins(
    'Rate reported as wrong: ' || coalesce(public.cell_label(p_lender, p_product, p_purpose, p_repay, p_lvr), p_lender || ' ' || p_product),
    'Shown as ' || coalesce(to_char(p_shown_rate, 'FM90.00') || '%', 'not offered') || E'.\n\nReport: ' || p_message);
end;
$$;

revoke execute on function public.cancel_call_request(bigint) from public, anon;
revoke execute on function public.my_requests() from public, anon;
revoke execute on function public.report_rate(text, text, text, text, text, numeric, text) from public, anon;

commit;
