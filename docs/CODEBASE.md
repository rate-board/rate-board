# Codebase map

| Path | What it is |
| --- | --- |
| `index.html` | Home page: the product hub, every product by section. Forwards old board links to `home-loans.html` |
| `home-loans.html` | Home loan rate board (Find the Cheapest Home Loan), sign-in, account profile |
| `agent.html` | Mortgage agent portal |
| `compare.html` | One comparison page for every category (`?c=<category>`) |
| `my-money.html` | Household, assets, holdings, savings, reminders, Beat Inflation check, Inflation Points |
| `calculators.html` | Ten calculators |
| `privacy.html`, `terms.html`, `accessibility.html` | Policies |
| `nav.js` | Site navigation for every page: one Menu with My account, products (from `catalog.js` sections) and Tools |
| `common.js` / `common.css` | Shared by every page: Supabase client, formatting, rate history, theme tokens (WCAG AAA) |
| `app.js` / `app.css` | Shared by the super-app pages: navigation, sign-in dialog, points helpers |
| `catalog.js` | Every product category: section, data source, inputs, columns, ranking |
| `supabase/migrations/` | Database changes in order; applied migrations are never edited |
| `supabase/functions/sync-rates/` | Nightly home loan sync |
| `supabase/functions/sync-catalog/` | Nightly catalogue sync (banking, loans, energy, CPI) |
| `supabase/functions/catalog-live/` | Live fuel, money transfer and energy lookups |
| `supabase/functions/marketplace/` | Email, agent invites, account deletion |
| `supabase/tests/` | Database tests (run inside a rolled-back transaction) |
| `docs/` | This documentation |
| `../rate-board-admin/` (private repo) | Admin portal, run locally |

Branches: `main` = production. Feature work happens on a branch (currently `super-app`), is pushed to the test site,
then merged to `main` after approval ([BP-13](PROCESSES.md)).
