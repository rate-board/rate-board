# Experience flows

| Document | FLW |
| --- | --- |
| Version | 1.0 |
| Last updated | 26 Oct 2026 |

How customers, agents and the admin move through the product. Screens are referenced by their page ID in
[design/](design/README.md).

## FLW-01 First visit to sign-up

```mermaid
flowchart TD
  a[Lands on product hub PG-02<br/>or home loan board PG-01] --> b{Signed in?}
  b -- No --> c[Browses any comparison PG-03<br/>no sign-in needed]
  c --> d[Clicks 'I have this', saves a quote<br/>or opens My money]
  d --> e[Sign-in dialog<br/>password or email link]
  e -- New --> f[Create account on PG-01]
  f --> g[My money PG-05<br/>+500 Inflation Points for joining]
  e -- Existing --> g
  b -- Yes --> g
```

## FLW-02 Compare and save a product

```mermaid
flowchart TD
  a[Product hub PG-02] --> b[Choose a product]
  b --> c{Mode}
  c -- Table --> d[Enter amount, term, balance...<br/>ranked by true cost]
  c -- Live --> e[Enter postcode, suburb or currency<br/>energy, fuel, money transfers]
  c -- Quotes --> f[Quote form prefilled from profile]
  d --> g{Action}
  e --> g
  g -- Go to site --> h[Provider site, new tab]
  g -- I have this / I'm on this plan --> i[Saved to My money as a holding]
  f --> j[Saved quote request<br/>shown in My money]
```

## FLW-03 Build the money profile

```mermaid
flowchart TD
  a[My money PG-05] --> b[Save household: postcode, people, pets]
  a --> c[Add an asset: home, investment property, vehicle,<br/>cash, super, investments, debt, business]
  c --> d[+200 points first time per asset type]
  c --> e[Add a product held under the asset<br/>rate, amount, renewal date]
  e --> f[Where you could save<br/>yearly saving vs best rate]
  e --> g[Coming up: renewals in 90 days]
  e --> h[Beat Inflation check vs CPI]
  f --> i[Compare link to the product]
```

## FLW-04 Earn and use Inflation Points

```mermaid
flowchart LR
  a[Join +500] --> p((Balance))
  b[Asset added +200] --> p
  c[Quarterly check-in +100] --> p
  d[Switch confirmed by partner<br/>pending, then confirmed] --> p
  p --> e{Use points<br/>min 2,000}
  e -- Gift card / charity --> f[Full value]
  e -- Cash / home loan --> g[90% value]
  f & g --> h[Redemption requested<br/>paid by admin BP-09]
```

## FLW-05 Energy plan comparison

```mermaid
flowchart TD
  a[Energy PG-03e] --> b[Postcode prefilled from profile]
  b --> c[People at home sets kWh; solar export optional]
  c --> d[Compare plans]
  d --> e[Edge function finds networks for the postcode,<br/>prices up to 10 plans per retailer]
  e --> f[Table: yearly bill, supply, usage, feed-in,<br/>conditional discounts]
  f --> g[Plan details on Energy Made Easy] & h[I'm on this plan → My money]
```

## FLW-06 Mortgage agent (existing)

```mermaid
flowchart TD
  a[Agent portal PG-07] --> b[Register with licence number]
  b --> c[Admin approves BP-04]
  c --> d[Post rates below a lender's rate]
  d --> e[Customers see agent rates on PG-01]
  e --> f[Customer reveals number, emails or requests a call]
  f --> g[Lead recorded; agent contacts within 1 business day]
```

## FLW-07 Admin operations

Agent approval is in the admin portal today. The other four steps run in the Supabase SQL editor until admin portal
screens are added (`CAP-17`).

```mermaid
flowchart LR
  a[Admin portal, 2FA] --> b[Approve or suspend agents]
  a --> c[Check sync runs BP-01]
  a --> d[Pay redemptions BP-09]
  a --> e[Award or claw back points BP-08]
  a --> f[Review quote requests BP-07]
```
