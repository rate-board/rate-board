-- The site is now called Find the Cheapest Home Loan: sign every notification email with the new name.
create or replace function public.queue_email(p_to text, p_subject text, p_body text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.email_outbox (to_email, subject, body)
  select p_to, p_subject, p_body || E'\n\n— Find the Cheapest Home Loan\nhttps://rate-board.github.io/rate-board/'
  where p_to is not null;
$$;
revoke execute on function public.queue_email(text, text, text) from public, anon, authenticated;
