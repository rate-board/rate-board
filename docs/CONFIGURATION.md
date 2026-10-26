# Configuration

| Document | CFG |
| --- | --- |
| Version | 1.0 |
| Last updated | 26 Oct 2026 |

Every setting outside the code that the system depends on. Change a setting and this file in the same commit.

## CFG-01 Environments

| | Production | Test |
| --- | --- | --- |
| URL | https://www.beatinflation.com.au/ | https://rate-board.github.io/rate-board-test/ |
| Repository | `rate-board/rate-board`, branch `main` | `rate-board/rate-board-test`, branch `main` (pushed from a local branch with `CNAME` removed) |
| Database | Supabase `fwjiofgwolontlglwrog` (shared) | Same database: test data is live data |
| Search engines | Indexed | `noindex` added by `common.js` |
| Label | — | "Test version" banner |

## CFG-02 Domain and DNS (GoDaddy)

| Record | Name | Value |
| --- | --- | --- |
| A | @ | 185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153 (GitHub Pages) |
| CNAME | www | rate-board.github.io |
| TXT | _dmarc | Unchanged from GoDaddy default |

GitHub Pages custom domain `www.beatinflation.com.au`, HTTPS enforced; the bare domain and the old
`rate-board.github.io/rate-board/` redirect to www.

## CFG-03 Supabase Auth

| Setting | Value |
| --- | --- |
| Site URL | https://www.beatinflation.com.au/ |
| Redirect allow-list | `https://www.beatinflation.com.au/**`, `https://beatinflation.com.au/**`, `https://rate-board.github.io/rate-board/**` |
| Test site redirects | Not on the allow-list: sign-in email links from the test site return to production (add `https://rate-board.github.io/rate-board-test/**` if needed) |
| Email sender | Supabase built-in (rate-limited); Resend not yet connected |
| Admin MFA | Authenticator app required for the admin portal |

## CFG-04 Edge functions

| Function | Verify JWT | Called by | Secrets used |
| --- | --- | --- | --- |
| `sync-rates` | Off | pg_cron (no token) | Service role (automatic) |
| `marketplace` | Off (checks the caller's token itself) | Site, admin portal, database | Service role; `RESEND_API_KEY`, `EMAIL_FROM` (not set yet) |
| `sync-catalog` | **On** | pg_cron with the anon key | Service role (automatic) |
| `catalog-live` | **On** | Site with the anon key | Service role (automatic) |

## CFG-05 Scheduled jobs (pg_cron, UTC)

| Job | Schedule | Does |
| --- | --- | --- |
| `nightly-rate-sync` | `0 16 * * *` | Home loan rates, RBA cash rate |
| `catalog-sync-banking` | `20 16 * * *` | Cards, accounts, savings, term deposits |
| `catalog-sync-loans` | `40 16 * * *` | Personal, car, business loans |
| `catalog-sync-energy-1` | `0 17 * * *` | Energy plans: AGL, Origin, EnergyAustralia, Red, Lumo, Alinta, Momentum, Powershop, OVO, Tango |
| `catalog-sync-energy-2` | `10 17 * * *` | Energy plans: GloBird, Dodo, Nectr, Amber, ENGIE, 1st Energy, CovaU, Energy Locals, ActewAGL |
| `catalog-sync-cpi` | `20 17 * * *` | ABS CPI |
| `agent-rate-reminders` | `0 23 * * *` | Reminder emails to agents |

Each catalogue job runs at most once every 30 minutes (BR-006).

## CFG-06 Data sources

| Source | Endpoint | Used for | Key needed |
| --- | --- | --- | --- |
| Open Banking (CDR) | Each bank's `cdr_base_uri` in `lenders` | Home loans, banking, loans | No |
| AER Energy Product Reference Data | `https://cdr.energymadeeasy.gov.au/{brand}/cds-au/v1/energy/plans` | Energy | No |
| ABS Data API | `data.api.abs.gov.au` series `CPI 1.10001.10.50.Q` | CPI | No |
| RBA | rba.gov.au cash rate page | Cash rate | No |
| WA FuelWatch | `fuelwatch.wa.gov.au/fuelwatch/fuelWatchRSS` | Fuel (WA) | No |
| NSW FuelCheck, QLD, SA, NT, TAS, VIC feeds | State government APIs | Fuel (other states) | **Yes: register for each; not connected** |
| Wise comparisons | `api.wise.com/v4/comparisons` | Money transfers | No |

## CFG-07 Business settings

| Setting | Value | Where |
| --- | --- | --- |
| Point value at launch | 1 cent, base quarter 2026-Q3 | `points_cents_per_point()` |
| Point value cap | 5% a year | `points_cents_per_point()` |
| Earning rules | join 500, asset 200, check-in 100, alert 200, review 100, referral 2,000 | `points_actions` table |
| Redemption minimum, cash rate | 2,000 points; 90% for cash and home loan | `redeem_points()` |
| Agent lead price | $0 | Marketplace settings (admin portal) |
| Energy plans priced per retailer | 10 | `catalog-live` |
| Energy cache | 3 days | `catalog-live` |

## CFG-08 Cache-busting versions

Static files are referenced with `?v=N`. Bump N in every page that includes a file when the file changes:
`common.js?v=5`, `common.css?v=5`, `app.js?v=2`, `catalog.js?v=3`, `app.css?v=4`.
