-- Rates read from lenders' own websites (for lenders outside Open Banking) are tagged 'scrape'.
alter table public.rates drop constraint rates_source_check;
alter table public.rates add constraint rates_source_check check (source in ('manual', 'cdr', 'scrape'));
