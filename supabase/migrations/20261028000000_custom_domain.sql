-- The site moved to https://www.beatinflation.com.au/. Every notification email goes through queue_email, so links to
-- the old GitHub Pages address are rewritten here rather than in each function that builds a message.
create or replace function public.queue_email(p_to text, p_subject text, p_body text)
returns void
language sql security definer set search_path = ''
as $$
  insert into public.email_outbox (to_email, subject, body)
  select p_to, p_subject,
         replace(p_body, 'https://rate-board.github.io/rate-board/', 'https://www.beatinflation.com.au/')
           || E'\n\n— Find the Cheapest Home Loan\nhttps://www.beatinflation.com.au/'
  where p_to is not null;
$$;
revoke execute on function public.queue_email(text, text, text) from public, anon, authenticated;
