# Changelog

Newest first. Each entry names the release or branch, what changed, and the requirement IDs affected.

## Unreleased: `super-app` branch, on the test site (26 Oct 2026)

- Added the product hub, one comparison page for 23 categories, My money, Inflation Points and calculators
  (`PRD-002`–`PRD-005`, `PRD-102`–`PRD-503`).
- Added nightly catalogue sync from Open Banking, the energy regulator and the ABS (`CAP-03`, `CAP-04`, `CAP-11`),
  and live fuel, money transfer and energy lookups (`CAP-05`).
- Added database tables for the catalogue, household, assets, holdings, quote requests and points
  (migrations `20261029000000`–`20261029020000`).
- Sample data for internet, mobile, business NBN, share trading, ETFs and super (`BR-004`).
- Fixed card fees (newer Open Banking versions), dropped non-card products filed as cards (`BR-009`), and stopped a
  failed or empty fetch from retiring products (`BR-005`).
- Comparison rows become labelled cards on phones.
- Documentation set created: requirements, processes, architecture, flows, designs, configuration, credentials,
  codebase (docs v1.0). Design set 1.1 adds credit cards and the phone card layout.

## release-2026-10-26: production

- Custom domain www.beatinflation.com.au; emails and edge functions use it.
- Site renamed "Find the Cheapest Home Loan"; accessibility and experience improvements; lender notes moved into the
  full assumptions.
