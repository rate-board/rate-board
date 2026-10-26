# Visual designs

| Document | PG |
| --- | --- |
| Version | 2.0 |
| Captured | 26 Oct 2026, from the test site |

One screenshot set per page, captured from the running site (the design is the built page). Desktop is 1280 px wide;
mobile is 375 px. Screenshots show the first screen of each page. Recapture a page whenever its layout changes and
bump this file's version.

**Design system:** colours, type and controls come from `common.css` (WCAG 2.2 AAA contrast in light and dark
themes) and `app.css`. "Boring by design" (`FEA-005`): one typeface, Inter, with tabular figures; flat panels
with no shadows; 4 px corners (`--radius`); underlined links; primary buttons with a darker bottom edge; a 3 px
yellow focus ring inside a near-black halo (`--focus`, `--focus-halo`).

| ID | Page | URL | Desktop | Mobile |
| --- | --- | --- | --- | --- |
| `PG-01` | Home loan rate board | `home-loans.html` | [view](PG-01-home-loans-desktop.jpg) | Existing card layout (see production) |
| `PG-02` | Product hub (home page) | `index.html` | [view](PG-02-product-hub-desktop.jpg) | [view](PG-02-product-hub-mobile.jpg) |
| `PG-03a` | Comparison table (savings) | `compare.html?c=savings` | [view](PG-03a-savings-desktop.jpg) | [view](PG-03a-savings-mobile.jpg) |
| `PG-03b` | Comparison table (credit cards) | `compare.html?c=credit_cards` | [view](PG-03b-credit-cards-desktop.jpg) | Same card layout as PG-03a |
| `PG-03e` | Energy plans for a postcode | `compare.html?c=energy` | [view](PG-03e-energy-desktop.jpg) | — |
| `PG-03f` | Fuel prices | `compare.html?c=fuel` | [view](PG-03f-fuel-desktop.jpg) | — |
| `PG-03m` | Money transfers | `compare.html?c=money_transfers` | [view](PG-03m-money-transfers-desktop.jpg) | — |
| `PG-03q` | Insurance quote request (health) | `compare.html?c=health_insurance` | [view](PG-03q-health-insurance-quote-desktop.jpg) | — |
| `PG-03s` | Sample-data category (internet) | `compare.html?c=internet` | [view](PG-03s-internet-sample-desktop.jpg) | — |
| `PG-04` | Calculators | `calculators.html` | [view](PG-04-calculators-desktop.jpg) | — |
| `PG-05` | My money (signed out) | `my-money.html` | [view](PG-05-my-money-signed-out-desktop.jpg) | — |
| `PG-05s` | My money (signed in) | `my-money.html` | Needs a signed-in capture by the owner | — |
| `PG-07` | Agent portal | `agent.html` | [view](PG-07-agent-portal-desktop.jpg) | — |

## Open design items

- **Signed-in My money** (`PG-05s`): capture once the owner signs in on the test site.

## History

- 2.0: "Boring by design" restyle (`FEA-005`). Recaptured PG-01, PG-02, PG-03a, PG-03b, PG-04 and PG-05; the other
  pages (PG-03e, PG-03f, PG-03m, PG-03q, PG-03s, PG-07) still show the 1.x look until recaptured.
- 1.2: The product hub is the home page; home loans moved to `home-loans.html` (screens unchanged apart from the nav).
- 1.1: PG-03a mobile recaptured with the phone card layout; PG-03b credit cards added.
- 1.0: First capture set.
