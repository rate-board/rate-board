# Business processes

| Document | BP |
| --- | --- |
| Version | 1.0 |
| Owner | Varun (operations) |
| Last updated | 26 Oct 2026 |

Each operational process: what starts it, who does it, the steps, the systems used and the check that it worked.
"Automatic" means a scheduled job does it; the owner checks the result.

| ID | Process | Trigger | Owner | Frequency |
| --- | --- | --- | --- | --- |
| `BP-01` | Nightly data refresh | Schedule | Automatic; owner checks | Daily |
| `BP-02` | Data feed failure | A sync run reports `partial` or `failed` | Owner | As needed |
| `BP-03` | Sample and manual catalogue upkeep | Monthly, or a provider changes prices | Owner | Monthly |
| `BP-04` | Mortgage agent onboarding | Agent applies in the agent portal | Owner (admin portal) | As needed |
| `BP-05` | Agent rate upkeep | Agent rate reminder email | Agent | Weekly |
| `BP-06` | Consumer lead handling (agent) | Customer requests a call or reveals a number | Agent | Within 1 business day |
| `BP-07` | Quote and broker request handling | Customer submits a quote or broker request | Owner, then partner | Within 2 business days once a partner exists |
| `BP-08` | Inflation Points: confirm, award and claw back | Partner confirms or cancels a switch | Owner | Weekly |
| `BP-09` | Inflation Points: redemption payout | Customer requests a redemption | Owner | Within 10 business days |
| `BP-10` | Point value update (CPI) | ABS releases quarterly CPI | Automatic; owner checks | Quarterly |
| `BP-11` | Customer data requests | Customer asks for access, correction or deletion | Owner | Within 30 days |
| `BP-12` | Complaints | Customer complains by email or form | Owner | Acknowledge in 1 business day; resolve in 30 days |
| `BP-13` | Release to test, then production | Change ready | Owner + Claude | Per change |
| `BP-14` | Incident response | Site down, wrong data or security concern | Owner | Immediately |
| `BP-15` | Credential rotation | Schedule or suspected leak | Owner | Every 12 months, or at once if leaked |
| `BP-16` | Legal and licence review | Before each new product section goes live | Owner + lawyer | Per section |
| `BP-17` | Partner and affiliate onboarding | New provider, insurer or broker | Owner | As needed |

## BP-01 Nightly data refresh

1. 16:00 UTC (3am Sydney): `nightly-rate-sync` updates home loan rates from Open Banking and three lender websites, and the RBA cash rate.
2. 16:20: `catalog-sync-banking` refreshes credit cards, bank, savings, term deposit and business accounts.
3. 16:40: `catalog-sync-loans` refreshes personal, car and business loans.
4. 17:00 and 17:10: `catalog-sync-energy-1` and `-2` refresh residential electricity plan lists and the postcode-to-network map.
5. 17:20: `catalog-sync-cpi` refreshes ABS CPI.
6. **Check (owner, daily):** in Supabase, `select job, status, started_at from catalog_runs order by id desc limit 10;` and the same on `sync_runs`. All should be `ok`. A `partial` run lists the provider that failed. Then go to BP-02.

## BP-02 Data feed failure

1. Read the run's `summary` to find the provider and error.
2. Transient errors (HTTP 500, timeouts) usually clear the next night; no action if the provider succeeded the night before.
3. If the same provider fails 3 nights running: check its Open Banking endpoint by hand, then update `lenders.cdr_base_uri` or the sync mapping and redeploy (BP-13).
4. A scraper failure ("site layout may have changed") writes nothing, so old rates stay; fix the scraper within a week or hide the lender (`lenders.active = false`).
5. Record the fix in [CHANGELOG.md](CHANGELOG.md).

## BP-03 Sample and manual catalogue upkeep

1. Monthly, check each `source = 'sample'` row against the provider's website (internet, mobile, business NBN, share trading, ETFs, super).
2. Update the row, or change `source` to `manual` once checked, so the "sample data" label can come off that category.
3. When a paid data feed is signed for a category, replace the sample rows with a sync job and retire the samples.

## BP-04 Mortgage agent onboarding

1. Agent registers in the agent portal with name, mobile, business, licence or credit representative number.
2. Owner checks the number on ASIC's professional registers.
3. Owner approves or rejects in the admin portal (two-factor sign-in required). The agent is emailed (once email is connected).
4. Suspend an agent in the admin portal if a complaint is upheld or their licence lapses.

## BP-05 Agent rate upkeep

1. `agent-rate-reminders` (23:00 UTC) emails agents whose rates haven't been confirmed recently.
2. Agent confirms, edits or removes each rate in the agent portal.

## BP-06 Consumer lead handling (agent)

1. Customer reveals an agent's number, emails them or requests a call; a lead is recorded and is billable at the configured price (currently $0).
2. Agent contacts the customer within 1 business day and marks the request as in touch.
3. Owner reviews leads monthly for billing once a price is set.

## BP-07 Quote and broker request handling

1. Customer submits an insurance quote request or a business finance broker request; it is saved in `quote_requests` with status `new`.
2. **Until a partner exists:** owner reviews new requests weekly and, if appropriate, emails the customer that a partner isn't connected yet.
3. **Once a partner exists:** requests are sent to the partner (status `sent`) the same business day, with the customer's consent captured on the form.
4. Close the request (`closed`) when the partner reports an outcome; record any switch for BP-08.

## BP-08 Inflation Points: confirm, award and claw back

1. Weekly, take the affiliate and partner reports of confirmed and cancelled sales.
2. Confirmed switch: `admin_award_points(user, 'switch', points, ref)` with points per the product's rate (BR-204), status `pending`, then `confirmed` after the 90-day clawback window.
3. Cancellation within 90 days: add a `clawed_back` entry for the same amount.
4. Reviews and referrals: award with `admin_award_points` after checking they're genuine.

## BP-09 Inflation Points: redemption payout

1. Customer requests a redemption; points are deducted and a `points_redemptions` row is created with status `requested`.
2. Owner checks the customer's identity for the first cash or home loan payout.
3. Owner pays: gift card through the gift card partner, bank transfer for cash, payment to the lender for home loans, or donation to the chosen charity.
4. Mark the redemption `paid` (or `cancelled` and refund the points with an admin entry).

## BP-10 Point value update (CPI)

1. ABS releases quarterly CPI; `catalog-sync-cpi` loads it the following night.
2. Owner checks that `select points_cents_per_point();` moved by the CPI change, capped at 5% a year (BR-202).
3. Customers see the new value in My money; the quarterly notification email is planned.

## BP-11 Customer data requests

1. Access: customers can download their data from My money; for anything else, export their rows on request.
2. Correction: customers edit their own profile, assets and holdings; admin corrects anything else.
3. Deletion: customer deletes the account from Profile, or owner deletes on request; profile, assets, holdings, quotes and points are removed with it.

## BP-12 Complaints

1. Acknowledge within 1 business day.
2. Investigate (data issue → BP-02; agent → BP-04 step 4; points → BP-09).
3. Respond with an outcome within 30 days. Once licensed, tell the customer they can go to AFCA if unhappy.
4. Log the complaint and outcome.

## BP-13 Release to test, then production

1. Work happens on a branch. Database changes are new migration files in `supabase/migrations`; nothing edits an applied migration.
2. Push the branch to the test site (`git push test <branch>:main`, with the CNAME removed on the test branch).
3. Apply migrations through the Supabase SQL editor, checking the file's SHA-256 against the commit; deploy changed edge functions from the dashboard and check their hash.
4. Check the test site: every changed page, no console errors, accessibility checks for new UI.
5. Owner approves; merge to `main`, which publishes www.beatinflation.com.au. Tag `release-YYYY-MM-DD` and update [CHANGELOG.md](CHANGELOG.md).

## BP-14 Incident response

1. Site down: check GitHub Pages status and DNS (GoDaddy); the database: Supabase status.
2. Wrong data on the site: hide the provider (`lenders.active = false`) or retire the catalogue rows, then fix via BP-02.
3. Security concern: rotate the affected credential (BP-15), review Supabase auth logs, notify affected customers if personal data was exposed (Notifiable Data Breaches scheme).

## BP-15 Credential rotation

1. Follow [CREDENTIALS.md](CREDENTIALS.md) for where each credential lives.
2. Rotate secret keys every 12 months or at once if exposed; public keys (publishable, anon) only if the project's JWT secret is rotated.
3. After rotating: update Supabase secrets, the site's public keys if they changed, and the cron job commands (BP-13).

## BP-16 Legal and licence review

1. Before a product section goes live in production, a lawyer reviews its pages, disclosures and flows against [REQUIREMENTS.md](REQUIREMENTS.md) section 5.
2. Record the outcome and any changes required.
3. Sections needing a licence arrangement (credit, AFS, health insurance broker) stay on the test site until it is in place.

## BP-17 Partner and affiliate onboarding

1. Sign the agreement; record commission terms (needed for BR-204 point rates).
2. Add tracked links or quote API details; record credentials in [CREDENTIALS.md](CREDENTIALS.md) (location only).
3. Add or update the category's data source and badge; release via BP-13.
