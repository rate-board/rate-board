# Requirements

| Document | REQ |
| --- | --- |
| Version | 1.1 |
| Status | Approved (all decisions approved 26 Oct 2026; all phases being built as P1) |
| Owner | Varun (product owner) |
| Last updated | 26 Oct 2026 |

Hierarchy: **Section (`SEC`) → Product (`PRD`) → Feature (`FEA`)**, with **Capabilities (`CAP`)** shared across
products and **Business rules (`BR`)** that features must obey. Every item is tagged; see [README](README.md) for the
tag vocabulary.

## 1. Product hierarchy

| Section | Products |
| --- | --- |
| `SEC-01` Platform | `PRD-001` Accounts · `PRD-002` My money (profile and assets) · `PRD-003` Inflation Points · `PRD-004` Calculators · `PRD-005` Product hub |
| `SEC-02` Loans | `PRD-101` Home loans · `PRD-102` Personal loans · `PRD-103` Car loans · `PRD-104` Business loans |
| `SEC-03` Banking | `PRD-201` Credit cards · `PRD-202` Bank accounts · `PRD-203` Savings accounts · `PRD-204` Term deposits · `PRD-205` Money transfers · `PRD-206` Business bank accounts |
| `SEC-04` Insurance | `PRD-301` Health · `PRD-302` Car · `PRD-303` Home · `PRD-304` Contents · `PRD-305` Landlord · `PRD-306` Travel · `PRD-307` Pet · `PRD-308` Life · `PRD-309` Income protection · `PRD-310` Business · `PRD-311` Overseas visitor and student health |
| `SEC-05` Utilities | `PRD-401` Energy · `PRD-402` Internet · `PRD-403` Mobile · `PRD-404` Business NBN · `PRD-405` Fuel prices |
| `SEC-06` Investing | `PRD-501` Super funds · `PRD-502` Share trading platforms · `PRD-503` ETFs |
| `SEC-07` Marketplace | `PRD-601` Mortgage agent marketplace · `PRD-602` Expert marketplace (car, business, insurance, energy brokers) |
| `SEC-08` Administration | `PRD-701` Admin portal · `PRD-702` Catalogue and data operations |

## 2. Products

| ID | Product | Mode | Data source | Switch flow | Tags |
| --- | --- | --- | --- | --- | --- |
| `PRD-001` | Accounts | — | Supabase Auth | — | `#status/live #source/user #licence/none` |
| `PRD-002` | My money | Profile, assets, holdings | Customer-entered | — | `#status/test #source/user #licence/none` |
| `PRD-003` | Inflation Points | Loyalty ledger | Ledger + ABS CPI | Redemption requests | `#status/test #source/abs #licence/none` (legal check open) |
| `PRD-004` | Calculators | 10 calculators | Customer inputs | — | `#status/test #licence/none` |
| `PRD-005` | Product hub | Home page: index of all products | Catalogue config | — | `#status/test` |
| `PRD-101` | Home loans | Rate board | Open Banking + 3 scraped lenders | Go to lender; request an agent call | `#status/live #source/cdr #source/scrape #licence/none` |
| `PRD-102` | Personal loans | Comparison table | Open Banking | Go to lender | `#status/test #source/cdr #licence/acl` (referral now) |
| `PRD-103` | Car loans | Comparison table | Open Banking | Go to lender; broker (planned) | `#status/test #source/cdr #licence/acl` |
| `PRD-104` | Business loans | Table + broker request | Open Banking | Broker request | `#status/test #source/cdr #licence/acl` |
| `PRD-201` | Credit cards | Comparison table | Open Banking | Go to issuer | `#status/test #source/cdr #licence/acl` |
| `PRD-202` | Bank accounts | Comparison table | Open Banking | Go to bank | `#status/test #source/cdr #licence/afsl` |
| `PRD-203` | Savings accounts | Comparison table | Open Banking | Go to bank | `#status/test #source/cdr #licence/afsl` |
| `PRD-204` | Term deposits | Comparison table | Open Banking | Go to bank | `#status/test #source/cdr #licence/afsl` |
| `PRD-205` | Money transfers | Live quotes | Wise comparison API | Go to provider | `#status/test #source/wise #licence/none` |
| `PRD-206` | Business bank accounts | Comparison table | Open Banking | Go to bank | `#status/test #source/cdr #licence/afsl` |
| `PRD-301`–`PRD-311` | Insurance (11 products) | Quote request | Customer + partner (none yet) | Saved request | `#status/blocked #source/partner #licence/afsl` (health: `#licence/phi`) |
| `PRD-401` | Energy | Live bill estimate | AER plan data | Plan details on Energy Made Easy | `#status/test #source/aer #licence/none` |
| `PRD-402` | Internet | Comparison table | Sample | Go to provider | `#status/test #source/sample #licence/none` |
| `PRD-403` | Mobile | Comparison table | Sample | Go to provider | `#status/test #source/sample #licence/none` |
| `PRD-404` | Business NBN | Comparison table | Sample | Go to provider | `#status/test #source/sample #licence/none` |
| `PRD-405` | Fuel prices | Live lookup | WA FuelWatch | Map link | `#status/test #source/fuelwatch #licence/none` (other states `#status/blocked` on API keys) |
| `PRD-501` | Super funds | Comparison table | Sample | Go to fund | `#status/test #source/sample #licence/afsl` |
| `PRD-502` | Share trading | Comparison table | Sample | Go to broker | `#status/test #source/sample #licence/afsl` |
| `PRD-503` | ETFs | Comparison table | Sample | Share trading page | `#status/test #source/sample #licence/afsl` |
| `PRD-601` | Mortgage agent marketplace | Agent rates on the board | Agents | Show number, email, call request | `#status/live #source/user` |
| `PRD-602` | Expert marketplace | Broker requests | Customer | Saved request | `#status/planned` |
| `PRD-701` | Admin portal | Local app | — | — | `#status/live` |
| `PRD-702` | Catalogue and data operations | Nightly jobs | All sources | — | `#status/test #area/ops` |

## 3. Capabilities

| ID | Capability | Used by | Implemented in | Tags |
| --- | --- | --- | --- | --- |
| `CAP-01` | Accounts and sign-in (email link, password, admin two-factor) | All | Supabase Auth; `home-loans.html`, `app.js` | `#status/live` |
| `CAP-02` | Comparison engine: config-driven table, inputs, filters, sortable columns, "I have this" | PRD-102–206, 402–404, 501–503 | `catalog.js`, `compare.html` | `#status/test #area/ui` |
| `CAP-03` | Open Banking product sync | PRD-101–104, 201–206 | `sync-rates`, `sync-catalog` (jobs `banking`, `loans`) | `#status/test #source/cdr #area/fn` |
| `CAP-04` | Energy plan sync and bill estimate | PRD-401 | `sync-catalog` (`energy1`, `energy2`), `catalog-live` (`energy`) | `#status/test #source/aer #area/fn` |
| `CAP-05` | Live lookups (fuel, money transfers) | PRD-205, 405 | `catalog-live` | `#status/test #area/fn` |
| `CAP-06` | Quote and broker requests | PRD-104, 301–311 | `compare.html`, `quote_requests` table | `#status/test #area/db` |
| `CAP-07` | Profile, household and assets | PRD-002 | `my-money.html`, `customer_profiles`, `assets` | `#status/test` |
| `CAP-08` | Holdings and savings opportunities | PRD-002 | `my-money.html`, `holdings` | `#status/test` |
| `CAP-09` | Reminders (renewals, maturities, expiries) | PRD-002 | `my-money.html` (on screen); email planned | `#status/test` |
| `CAP-10` | Points ledger, earning and redemption | PRD-003 | `points_*` tables, `award_points`, `redeem_points` | `#status/test #area/db` |
| `CAP-11` | CPI indexing | PRD-003, Beat Inflation check | `sync-catalog` (`cpi`), `cpi_quarters`, `points_cents_per_point` | `#status/test #source/abs` |
| `CAP-12` | Calculators | PRD-004 | `calculators.html` | `#status/test` |
| `CAP-13` | Agent marketplace (agents, agent rates, leads) | PRD-601 | `agent.html`, `marketplace` function | `#status/live` |
| `CAP-14` | Email notifications | PRD-601, reminders | `queue_email`, `marketplace` (`send_email`) | `#status/blocked` (needs Resend) |
| `CAP-15` | Compliance layer (disclosures, sample labels, provider counts) | All products | `compare.html`, page footers | `#status/test #area/legal` |
| `CAP-16` | Analytics | All | — | `#status/planned` |
| `CAP-17` | Admin catalogue editing | PRD-702 | Admin portal | `#status/planned` |
| `CAP-18` | Connect your accounts (Consumer Data Right) | PRD-002 | — | `#status/planned #licence/afsl` |

## 4. Features

| ID | Feature | Product | Capability | Tags |
| --- | --- | --- | --- | --- |
| `FEA-001` | Site navigation: All products, My money, Calculators. No product (home loans included) has its own menu item; every product is reached from the hub | PRD-005 | — | `#status/test #area/ui` |
| `FEA-002` | Sign in from any page (password or email link) | PRD-001 | CAP-01 | `#status/test` |
| `FEA-003` | Product hub grouped by section with Live, Quotes and Sample badges | PRD-005 | CAP-02 | `#status/test` |
| `FEA-004` | The product hub is the home page (site root); home loans is one product at `home-loans.html`. Older root links with board filters, `#register`, `#join` or a password-reset token forward to the board | PRD-005, PRD-101 | — | `#status/test #area/ui` |
| `FEA-010` | Household: postcode, income band, adults, children, ages, pets | PRD-002 | CAP-07 | `#status/test` |
| `FEA-011` | Add, edit and delete assets of 8 types with type-specific details | PRD-002 | CAP-07 | `#status/test` |
| `FEA-012` | Add products held, linked to an asset, with rate, amount and renewal date | PRD-002 | CAP-08 | `#status/test` |
| `FEA-013` | "I have this" on any comparison row saves it to My money | PRD-002 | CAP-02, CAP-08 | `#status/test` |
| `FEA-014` | Where you could save: yearly saving against today's best rate | PRD-002 | CAP-08 | `#status/test` |
| `FEA-015` | Coming up: renewals and maturities in the next 90 days | PRD-002 | CAP-09 | `#status/test` |
| `FEA-016` | Beat Inflation check and score against ABS CPI | PRD-002 | CAP-11 | `#status/test` |
| `FEA-017` | Download my data (JSON) | PRD-002 | CAP-07 | `#status/test` |
| `FEA-018` | Quote requests list | PRD-002 | CAP-06 | `#status/test` |
| `FEA-020` | Points balance, dollar value, value per point, pending, lifetime | PRD-003 | CAP-10, CAP-11 | `#status/test` |
| `FEA-021` | Earn on join, first asset of each type, quarterly check-in | PRD-003 | CAP-10 | `#status/test` |
| `FEA-022` | Redeem: gift card, cash, home loan repayment, charity | PRD-003 | CAP-10 | `#status/test` (paid by hand) |
| `FEA-023` | Points history | PRD-003 | CAP-10 | `#status/test` |
| `FEA-024` | Points for switching, referrals and reviews | PRD-003 | CAP-10 | `#status/planned` (admin award only) |
| `FEA-030` | Ten calculators: repayments, borrowing power, refinance, debt consolidation, balance transfer, Medicare levy surcharge, lifetime health cover loading, super fee drag, share trading cost, real return | PRD-004 | CAP-12 | `#status/test` |
| `FEA-101` | Home loan rate board, agent rates, rate history (existing) | PRD-101 | CAP-03, CAP-13 | `#status/live` |
| `FEA-102` | Loan tables: from rate, comparison rate, monthly repayment for amount and term, secured filter | PRD-102–104 | CAP-02 | `#status/test` |
| `FEA-103` | Business finance broker request | PRD-104 | CAP-06 | `#status/test` |
| `FEA-201` | Card table ranked by 2-year cost at the balance you carry | PRD-201 | CAP-02 | `#status/test` |
| `FEA-202` | Savings ranked by first-year interest, with bonus-conditions switch | PRD-203 | CAP-02 | `#status/test` |
| `FEA-203` | Term deposits by exact term with interest earned | PRD-204 | CAP-02 | `#status/test` |
| `FEA-204` | Money transfer quotes for 11 currencies | PRD-205 | CAP-05 | `#status/test` |
| `FEA-205` | Business accounts filtered by type | PRD-206 | CAP-02 | `#status/test` |
| `FEA-301` | Insurance quote forms, prefilled from the profile, with insurer list | PRD-301–311 | CAP-06 | `#status/test` |
| `FEA-302` | Adviser-only request for life and income protection | PRD-308–309 | CAP-06 | `#status/test` |
| `FEA-401` | Energy: postcode, household size, kWh, solar export; plans priced yearly | PRD-401 | CAP-04 | `#status/test` |
| `FEA-402` | Internet, mobile and business NBN tables (sample data) | PRD-402–404 | CAP-02 | `#status/test #source/sample` |
| `FEA-403` | Fuel near a WA suburb by fuel type, with map links | PRD-405 | CAP-05 | `#status/test` |
| `FEA-501` | Super, share trading and ETF tables (sample data) | PRD-501–503 | CAP-02 | `#status/test #source/sample` |

## 5. Business rules

### Data and ranking

| ID | Rule | Applies to | Tags |
| --- | --- | --- | --- |
| `BR-001` | Rank by what the product costs or earns for the customer's own numbers, not the headline rate; show the headline rate too. | All tables | `#status/test` |
| `BR-002` | Sponsored products, if ever added, sit in a labelled box and never change the order of the neutral table. | All tables | `#status/planned` |
| `BR-003` | Every table states how many products and providers it compares and that it doesn't cover the whole market. | All tables | `#status/test` |
| `BR-004` | Sample data is labelled as unchecked on every page that shows it. | PRD-402–404, 501–503 | `#status/test` |
| `BR-005` | Open Banking rows are retired (not deleted) when a bank stops publishing them. Nothing is retired from a category whose fetch had a failed request or came back empty that night. | CAP-03 | `#status/test` |
| `BR-006` | A sync job runs at most once every 30 minutes, whoever triggers it. | CAP-03, CAP-04, CAP-11 | `#status/test` |
| `BR-007` | Savings: bonus rates are margins over the base rate; intro rates are margins over the best ongoing rate; if the sum exceeds 9%, the bank published a total. | PRD-203 | `#status/test` |
| `BR-008` | Products are business products when the bank's eligibility says BUSINESS or the name says business, corporate, commercial, SMSF, wholesale or farm. | PRD-201–206 | `#status/test` |
| `BR-009` | A credit card must look like a card (card in the name, a purchase rate, or interest-free days); loans and packages filed as cards are dropped. | PRD-201 | `#status/test` |
| `BR-010` | Cards with no published annual fee show "Not published" and rank after cards with a known fee. | PRD-201 | `#status/test` |
| `BR-011` | Energy estimates price single-rate residential plans only, include GST and guaranteed discounts, and list conditional discounts without deducting them. | PRD-401 | `#status/test` |
| `BR-012` | Energy shows one row per retailer and price; up to 10 plans per retailer are priced per search. | PRD-401 | `#status/test` |
| `BR-013` | Energy plan details are cached for 3 days. | PRD-401 | `#status/test` |
| `BR-014` | Fuel prices are live only where a state feed needs no key (WA); other states show a not-connected message. | PRD-405 | `#status/blocked` |
| `BR-015` | Home loan rates: only owner-occupier P&I 60–80% LVR is sourced; other combinations are estimated from it (existing rule). | PRD-101 | `#status/live` |

### Customer data

| ID | Rule | Tags |
| --- | --- | --- |
| `BR-101` | A customer sees and changes only their own profile, assets, holdings, quote requests and points (row-level security). | `#status/test #area/db` |
| `BR-102` | A holding can only be linked to one of the customer's own assets. | `#status/test` |
| `BR-103` | Every profile and asset field is optional; ranges and bands are accepted instead of exact figures. | `#status/test` |
| `BR-104` | Asset data is never sold and is shared with an agent or partner only when the customer sends that request. | `#status/test #area/legal` |
| `BR-105` | Customers can download all their data at any time; account deletion removes it (existing delete flow). | `#status/test` |
| `BR-106` | Savings opportunities are shown only when the gap to the best rate is more than 0.05% and an amount is entered. | `#status/test` |

### Inflation Points

| ID | Rule | Tags |
| --- | --- | --- |
| `BR-201` | 100 points = $1 at launch (1 cent a point, base quarter 2026-Q3). | `#status/test` |
| `BR-202` | The value of a point rises with ABS CPI each quarter, never falls, and rises at most 5% a year. | `#status/test` |
| `BR-203` | Earn: join 500 (once); add an asset 200 (once per asset type); quarterly check-in 100 (once a quarter); act on an alert 200 (up to 4 a year). | `#status/test` |
| `BR-204` | Earn (admin-awarded): provider review 100, referral 2,000, product switch set per product at 30–50% of commission received. | `#status/planned` |
| `BR-205` | No points on super, life insurance or income protection. | `#status/test #area/legal` |
| `BR-206` | Switch points stay pending until the provider confirms, and are clawed back if the product is cancelled within 90 days. | `#status/planned` |
| `BR-207` | Redemption minimum 2,000 points; gift cards and charity at full value; cash and home loan repayments at 90%. | `#status/test` |
| `BR-208` | The ledger is append-only; redemptions, expiry and clawbacks are negative entries. | `#status/test #area/db` |
| `BR-209` | Points expire only after 24 months of no account activity, with emails 60 and 30 days before. | `#status/planned` |
| `BR-210` | Earn and spend rules change only with 30 days' notice and never reduce points already earned. | `#status/planned #area/legal` |

### Requests and compliance

| ID | Rule | Tags |
| --- | --- | --- |
| `BR-301` | Insurance and broker requests need a signed-in customer and are stored until a licensed partner is connected; customers are told so. | `#status/test` |
| `BR-302` | Life and income protection go only to a licensed adviser, never by unsolicited call (hawking ban). | `#status/test #area/legal` |
| `BR-303` | Super comparisons are general information; no rewards for switching super. | `#status/test #area/legal` |
| `BR-304` | Every comparison page carries a general-information disclaimer and its data source. | `#status/test` |
| `BR-305` | The test site is labelled and kept out of search engines. | `#status/live` |
