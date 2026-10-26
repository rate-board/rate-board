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
- The product hub is now the home page (`index.html`); the home loan board moved to `home-loans.html` and is one
  product in the hub (`FEA-004`). Old root links with board filters, `#register`, `#join` or a password-reset
  token forward to the board. Docs: REQ 1.1, ARC 1.1, FLW 1.1, PG 1.2. At production merge, consider renaming the
  email footer "Find the Cheapest Home Loan" (it links to the site root, now the hub).
- Home loans has no menu item of its own. Every page, the board included, shares one menu (`nav.js`): a Products
  menu listing all 29 products by section, then My money and Calculators. The
  home loan page has the same "All products" breadcrumb as other products (`FEA-001`).
- Open Banking lists that come back empty are retried at older versions (Westpac returns an empty list for a
  version it does not support), restoring Westpac everyday and savings accounts (`CAP-03`).
- "Boring by design" restyle (`FEA-005`): Inter only (Fraunces and IBM Plex Mono dropped, so pages load two fewer
  font families), flat panels, 4 px corners, underlined links in the brand colour (fixes default-blue links in dark
  mode), form controls in the site font, a yellow-and-black focus ring, and the tagline on the home page and footers.
- Microsoft Clarity analytics wired in but off until a project ID is set (`FEA-006`, `CFG-09`); privacy policy
  updated. Docs: REQ 1.2, ARC 1.2, CFG 1.1.
- Account items moved into a My account menu in the nav on every page (`FEA-002`); the header sign-in buttons, the
  board's ⋮ menu and the home page's "Start with your money profile" panel are gone. Account details opens the profile
  dialog on the home loans page (`home-loans.html#profile`).
- Westpac everyday, savings and business accounts restored after the version-retry fix.
- Documentation set created: requirements, processes, architecture, flows, designs, configuration, credentials,
  codebase (docs v1.0). Design set 1.1 adds credit cards and the phone card layout.

## release-2026-10-26: production

- Custom domain www.beatinflation.com.au; emails and edge functions use it.
- Site renamed "Find the Cheapest Home Loan"; accessibility and experience improvements; lender notes moved into the
  full assumptions.
