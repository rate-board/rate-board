-- Initial data: rates sourced from each lender's official site on 2 Oct 2026
-- (owner-occupier, P&I, 60-80% LVR, basic/no-frills product where one exists).

insert into public.products (key, label, sort_order) values
  ('variable', 'Variable', 1),
  ('fixed1', '1-Year Fixed', 2),
  ('fixed2', '2-Year Fixed', 3),
  ('fixed3', '3-Year Fixed', 4);

insert into public.lenders (id, name, source_url, note, sort_order) values
  ('cba', 'CBA', 'https://www.commbank.com.au/home-loans/standard-variable-rate.html', null, 1),
  ('westpac', 'Westpac', 'https://www.westpac.com.au/personal-banking/home-loans/all-interest-rates/', null, 2),
  ('nab', 'NAB', 'https://www.nab.com.au/personal/interest-rates-fees-and-charges/home-loan-interest-rates', 'Variable and fixed figures come from two different NAB loan products — no direct basic-to-basic match.', 3),
  ('anz', 'ANZ', 'https://www.anz.com.au/personal/home-loans/standard-variable-rate/', null, 4),
  ('macquarie', 'Macquarie', 'https://www.macquarie.com.au/home-loans/home-loan-rates.html', null, 5),
  ('ing', 'ING', 'https://www.ing.com.au/rates-and-fees/home-loan-rates.html', null, 6),
  ('bankwest', 'Bankwest', 'https://www.bankwest.com.au/rates/home-loan-rates', null, 7),
  ('suncorp', 'Suncorp', 'https://www.suncorpbank.com.au/home-loans/variable.html', null, 8),
  ('boq', 'BOQ', 'https://www.boq.com.au/personal/help-and-support/rates-and-fees/home-loan-rates-owner-occupier', 'No 1-year fixed term offered.', 9),
  ('st-george', 'St.George', 'https://www.stgeorge.com.au/personal/home-loans/home-loan-interest-rates/table', null, 10),
  ('bendigo-bank', 'Bendigo Bank', 'https://www.bendigobank.com.au/personal/home-loans/rates/', null, 11),
  ('amp-bank', 'AMP Bank', 'https://www.amp.com.au/home-loans/interest-rates-fees', null, 12),
  ('hsbc', 'HSBC', 'https://www.hsbc.com.au/home-loans/products/rates/', 'HSBC Australia is no longer accepting new home loan applications.', 13),
  ('me-bank', 'ME Bank', 'https://www.mebank.com.au/home-loans/rates/owner-occupier/', null, 14),
  ('people-first-bank', 'People First Bank', 'https://www.peoplefirstbank.com.au/rates/home-loan-rates', null, 15),
  ('ubank', 'UBank', 'https://www.ubank.com.au/home-loans/interest-rates-and-fees', 'Rates stated were scheduled to rise 0.25% p.a. from 8 Oct 2026.', 16),
  ('unloan', 'Unloan', 'https://www.unloan.com.au/home-loan', 'Variable-only lender — no fixed-rate option.', 17),
  ('athena-home-loans', 'Athena Home Loans', 'https://www.athena.com.au/home-loans/rates-no-fees', null, 18),
  ('pepper-money', 'Pepper Money', 'https://www.peppermoney.com.au/lending/home-loans/variable', 'Specialist risk-based lender — figures are the lowest advertised rate, actual pricing varies by credit profile. No 1-year fixed term.', 19),
  ('liberty-financial', 'Liberty Financial', 'https://www.liberty.com.au/home-loans/low-rate-home-loans', 'Fixed-rate pricing isn''t published as a rate card — only available via Liberty''s personalised quote tool.', 20),
  ('loans-com-au', 'loans.com.au', 'https://www.loans.com.au/home-loans/variable-rate/', null, 21),
  ('virgin-money', 'Virgin Money', 'https://www.virginmoney.com.au/home-loans/lite', null, 22),
  ('rams', 'RAMS', 'https://www.rams.com.au/', 'Closed to new home loan customers since Aug 2024; loan book sold to a Pepper Money/KKR/PIMCO consortium.', 23),
  ('tic-toc', 'Tic:Toc', 'https://www.finder.com.au/home-loans/tiimely-home-own-home-loans', 'Now branded Tiimely Home. Not published on its own site — figures via Finder/Canstar, unverified against an official source.', 24);

insert into public.rates (lender_id, product_key, rate, comparison_rate, as_of) values
  ('cba', 'variable', 6.49, 6.87, '2026-10-02'), ('cba', 'fixed1', 6.78, 8.31, '2026-10-02'), ('cba', 'fixed2', 6.82, 8.19, '2026-10-02'), ('cba', 'fixed3', 6.89, 8.09, '2026-10-02'),
  ('westpac', 'variable', 6.54, 6.55, '2026-10-02'), ('westpac', 'fixed1', 7.04, 8.76, '2026-10-02'), ('westpac', 'fixed2', 7.04, 8.58, '2026-10-02'), ('westpac', 'fixed3', 7.24, 8.48, '2026-10-02'),
  ('nab', 'variable', 6.44, 6.44, '2026-10-02'), ('nab', 'fixed1', 6.79, 7.09, '2026-10-02'), ('nab', 'fixed2', 6.81, 7.08, '2026-10-02'), ('nab', 'fixed3', 6.92, 7.09, '2026-10-02'),
  ('anz', 'variable', 7.24, 7.24, '2026-10-02'), ('anz', 'fixed1', 6.49, 7.16, '2026-10-02'), ('anz', 'fixed2', 6.49, 7.09, '2026-10-02'), ('anz', 'fixed3', 6.64, 7.07, '2026-10-02'),
  ('macquarie', 'variable', 6.09, 6.11, '2026-10-02'), ('macquarie', 'fixed1', 6.54, 6.16, '2026-10-02'), ('macquarie', 'fixed2', 6.64, 6.22, '2026-10-02'), ('macquarie', 'fixed3', 6.64, 6.27, '2026-10-02'),
  ('ing', 'variable', 6.09, 6.12, '2026-10-02'), ('ing', 'fixed1', 6.74, 6.19, '2026-10-02'), ('ing', 'fixed2', 6.69, 6.24, '2026-10-02'), ('ing', 'fixed3', 6.84, 6.33, '2026-10-02'),
  ('bankwest', 'variable', 6.24, 6.27, '2026-10-02'), ('bankwest', 'fixed1', 6.49, 8.78, '2026-10-02'), ('bankwest', 'fixed2', 6.59, 8.55, '2026-10-02'), ('bankwest', 'fixed3', 6.69, 8.37, '2026-10-02'),
  ('suncorp', 'variable', 6.18, 6.53, '2026-10-02'), ('suncorp', 'fixed1', 6.29, 6.54, '2026-10-02'), ('suncorp', 'fixed2', 6.24, 6.54, '2026-10-02'), ('suncorp', 'fixed3', 6.44, 6.61, '2026-10-02'),
  ('boq', 'variable', 6.33, 6.47, '2026-10-02'), ('boq', 'fixed2', 6.79, 6.59, '2026-10-02'), ('boq', 'fixed3', 6.84, 6.64, '2026-10-02'),
  ('st-george', 'variable', 6.39, 6.40, '2026-10-02'), ('st-george', 'fixed1', 7.04, 8.75, '2026-10-02'), ('st-george', 'fixed2', 7.04, 8.56, '2026-10-02'), ('st-george', 'fixed3', 7.24, 8.46, '2026-10-02'),
  ('bendigo-bank', 'variable', 6.13, 6.15, '2026-10-02'), ('bendigo-bank', 'fixed1', 6.39, 6.18, '2026-10-02'), ('bendigo-bank', 'fixed2', 6.44, 6.21, '2026-10-02'), ('bendigo-bank', 'fixed3', 6.39, 6.22, '2026-10-02'),
  ('amp-bank', 'variable', 6.54, 6.95, '2026-10-02'), ('amp-bank', 'fixed1', 6.39, 7.52, '2026-10-02'), ('amp-bank', 'fixed2', 6.39, 7.40, '2026-10-02'), ('amp-bank', 'fixed3', 6.49, 7.33, '2026-10-02'),
  ('hsbc', 'variable', 6.09, 6.10, '2026-10-02'), ('hsbc', 'fixed1', 7.09, 7.57, '2026-10-02'), ('hsbc', 'fixed2', 7.09, 7.52, '2026-10-02'), ('hsbc', 'fixed3', 7.14, 7.50, '2026-10-02'),
  ('me-bank', 'variable', 6.04, 6.06, '2026-10-02'), ('me-bank', 'fixed1', 6.54, 6.11, '2026-10-02'), ('me-bank', 'fixed2', 6.24, 6.10, '2026-10-02'), ('me-bank', 'fixed3', 6.29, 6.13, '2026-10-02'),
  ('people-first-bank', 'variable', 6.09, 6.10, '2026-10-02'), ('people-first-bank', 'fixed1', 6.49, 6.14, '2026-10-02'), ('people-first-bank', 'fixed2', 6.54, 6.18, '2026-10-02'), ('people-first-bank', 'fixed3', 6.54, 6.22, '2026-10-02'),
  ('ubank', 'variable', 6.14, 6.16, '2026-10-02'), ('ubank', 'fixed1', 6.74, 6.44, '2026-10-02'), ('ubank', 'fixed2', 6.79, 6.51, '2026-10-02'), ('ubank', 'fixed3', 6.84, 6.58, '2026-10-02'),
  ('unloan', 'variable', 5.89, 5.80, '2026-10-02'),
  ('athena-home-loans', 'variable', 6.39, 6.35, '2026-10-02'), ('athena-home-loans', 'fixed1', 6.84, 6.39, '2026-10-02'), ('athena-home-loans', 'fixed2', 6.89, 6.45, '2026-10-02'), ('athena-home-loans', 'fixed3', 6.94, 6.51, '2026-10-02'),
  ('pepper-money', 'variable', 7.09, 7.27, '2026-10-02'), ('pepper-money', 'fixed2', 7.24, 7.02, '2026-10-02'), ('pepper-money', 'fixed3', 7.34, 7.10, '2026-10-02'),
  ('liberty-financial', 'variable', 6.49, 6.57, '2026-10-02'),
  ('loans-com-au', 'variable', 5.94, 5.98, '2026-10-02'), ('loans-com-au', 'fixed1', 6.89, 6.16, '2026-10-02'), ('loans-com-au', 'fixed2', 6.89, 6.25, '2026-10-02'), ('loans-com-au', 'fixed3', 6.89, 6.32, '2026-10-02'),
  ('virgin-money', 'variable', 5.84, 5.86, '2026-10-02'), ('virgin-money', 'fixed1', 6.49, 5.92, '2026-10-02'), ('virgin-money', 'fixed2', 6.24, 5.93, '2026-10-02'), ('virgin-money', 'fixed3', 6.29, 5.98, '2026-10-02'),
  ('tic-toc', 'variable', 5.95, 5.96, '2026-10-02'), ('tic-toc', 'fixed1', 6.39, 6.00, '2026-10-02'), ('tic-toc', 'fixed2', 6.44, 6.05, '2026-10-02'), ('tic-toc', 'fixed3', 6.39, 6.08, '2026-10-02');
