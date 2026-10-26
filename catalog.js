// Every product category in the super app: which section it sits in, where its data comes from, what the
// visitor enters, which columns it shows and how it ranks ("true cost" for the visitor's own numbers, not the
// headline rate). compare.html renders any category from this file.

const SECTIONS = [
  { key: "loans", title: "Loans", items: ["home_loans", "personal_loans", "car_loans", "business_loans"] },
  { key: "banking", title: "Banking", items: ["credit_cards", "bank_accounts", "savings", "term_deposits", "money_transfers", "business_accounts"] },
  { key: "insurance", title: "Insurance", items: ["health_insurance", "car_insurance", "home_insurance", "contents_insurance", "landlord_insurance", "travel_insurance", "pet_insurance", "life_insurance", "income_protection", "business_insurance", "overseas_health"] },
  { key: "utilities", title: "Utilities", items: ["energy", "internet", "mobile", "business_nbn", "fuel"] },
  { key: "investing", title: "Investing", items: ["super", "share_trading", "etfs"] },
];

const OPEN_BANKING = "Open Banking product data published by each bank, checked every night";
const SAMPLE = "Sample data for the test site: illustrative figures that have not been checked. A data partner or admin-entered figures will replace them.";

const repayment = (rate, amount, years) => monthlyRepayment(rate, amount, years, false);
const termOptions = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => [String(from + i), `${from + i} year${from + i === 1 ? "" : "s"}`]);
const yesNo = (b) => b === true ? "Yes" : b === false ? "No" : "—";
const plural = (n, word) => `${n} ${word}${Number(n) === 1 ? "" : "s"}`;
const nameCell = (it, extra = "") => `<span class="prov">${escapeHtml(it.provider)}</span><span class="sub">${escapeHtml(it.name)}${extra}</span>`;

// Loans published through Open Banking: shown with the "from" rate, since actual rates depend on the borrower.
function loanCategory(title, amount, extra = {}){
  return {
    title, mode: "table", badge: "Live", source: OPEN_BANKING,
    lede: `Compare ${title.toLowerCase()} from the banks that publish them through Open Banking. Repayments use each lender's lowest "from" rate; the rate you're offered depends on your credit history.`,
    inputs: [
      { id: "amount", label: "Loan amount ($)", type: "number", value: amount, min: 1000 },
      { id: "years", label: "Term", type: "select", value: "5", options: termOptions(1, 7) },
      { id: "secured", label: "Security", type: "select", value: "any", options: [["any", "Any"], ["unsecured", "Unsecured"], ["secured", "Secured"]] },
    ],
    filter: (it, c) => c.secured === "any" || (c.secured === "secured") === !!it.attrs.secured,
    rank: (it) => it.attrs.comparisonRate ?? it.rate,
    columns: [
      { label: "Lender and loan", html: (it) => nameCell(it, it.attrs.green ? " · green" : "") },
      { label: "Rate from", num: true, html: (it) => pct(it.rate) + (it.attrs.rateTo && it.attrs.rateTo > it.rate ? `<span class="sub">to ${pct(it.attrs.rateTo)}</span>` : ""), sort: (it) => it.rate },
      { label: "Comparison rate from", num: true, html: (it) => pct(it.attrs.comparisonRate), sort: (it) => it.attrs.comparisonRate ?? 99 },
      { label: "Monthly repayment", num: true, html: (it, c) => money(repayment(it.rate, c.amount, Number(c.years))), sort: (it) => it.rate },
      { label: "Type", html: (it) => escapeHtml(it.attrs.rateType || "—") + `<span class="sub">${it.attrs.secured ? "Secured" : "Unsecured"}</span>` },
    ],
    holding: (it, c) => ({ category: extra.holdingCategory || "personal_loans", provider: it.provider, product_name: it.name, rate: it.rate, amount: c.amount }),
    ...extra,
  };
}

const INSURERS = {
  health_insurance: ["Bupa", "Medibank", "HCF", "nib", "ahm", "Australian Unity", "HBF", "GMHBA", "Frank Health", "Westfund", "Teachers Health", "Defence Health", "CBHS", "Peoplecare"],
  car_insurance: ["AAMI", "Allianz", "NRMA", "RACV", "RACQ", "RAC WA", "Budget Direct", "Youi", "Bingle", "Coles Insurance", "Woolworths Insurance", "QBE", "Suncorp", "GIO"],
  home_insurance: ["AAMI", "Allianz", "NRMA", "RACV", "Budget Direct", "Youi", "Suncorp", "GIO", "QBE", "CGU", "Coles Insurance", "Woolworths Insurance"],
  contents_insurance: ["AAMI", "Allianz", "NRMA", "Budget Direct", "Youi", "Suncorp", "Coles Insurance", "Woolworths Insurance", "Real Insurance"],
  landlord_insurance: ["Terri Scheer", "EBM RentCover", "Allianz", "QBE", "CGU", "Budget Direct", "NRMA"],
  travel_insurance: ["Cover-More", "Fast Cover", "Southern Cross Travel Insurance", "World Nomads", "Allianz Travel", "1Cover", "Budget Direct", "InsureandGo", "Tick", "Medibank", "Bupa"],
  pet_insurance: ["Bow Wow Meow", "Petsy", "Knose", "Woolworths Pet Insurance", "RSPCA Pet Insurance", "Medibank Pet", "Bupa Pet", "ahm Pet", "PD Insurance", "Prime Pet"],
  life_insurance: ["TAL", "AIA", "Zurich", "MLC Life", "NobleOak", "ClearView", "OnePath", "Resolution Life"],
  income_protection: ["TAL", "AIA", "Zurich", "MLC Life", "NobleOak", "ClearView", "OnePath"],
  business_insurance: ["BizCover", "QBE", "Allianz", "CGU", "AAMI Business", "Suncorp", "Chubb"],
  overseas_health: ["Bupa", "Allianz Care", "Medibank", "nib", "ahm OSHC", "CBHS International"],
};

// Insurance and other quote-based products: the visitor's details are saved as a quote request until a licensed
// partner's quote engine is connected.
function quoteCategory(title, fields, extra = {}){
  return {
    title, mode: "quote", badge: "Quotes", lede: extra.lede || `Get ${title.toLowerCase()} quotes from one form. Prices depend on your details, so there's no public price list to compare.`,
    fields, ...extra,
  };
}

const POSTCODE = { id: "postcode", label: "Postcode", type: "text", profile: "postcode", pattern: "\\d{4}" };
const RENEWAL = { id: "renewal", label: "Your renewal premium, if you have one ($)", type: "number" };
const CURRENT = { id: "current", label: "Current insurer (optional)", type: "text" };

const CATEGORIES = {
  home_loans: { title: "Home loans", href: "index.html", badge: "Live" },

  personal_loans: loanCategory("Personal loans", 20000, {
    tools: [["calculators.html#debt", "Debt consolidation calculator"]],
  }),
  car_loans: loanCategory("Car loans", 35000, {
    holdingCategory: "car_loans",
    tools: [["calculators.html#repay", "Repayment calculator"], ["compare.html?c=car_insurance", "Car insurance quotes"], ["compare.html?c=fuel", "Fuel prices"]],
  }),
  business_loans: {
    ...loanCategory("Business loans", 100000, { holdingCategory: "business_loans" }),
    lede: "Bank business loans published through Open Banking. Most specialist business lenders (Prospa, Moula, ScotPac and others) price each business individually, so for those, ask a business finance broker.",
    brokerRequest: true,
  },

  credit_cards: {
    title: "Credit cards", mode: "table", badge: "Live", source: OPEN_BANKING,
    lede: "Ranked by what a card would cost you over two years at the balance you carry, not by the headline rate. Some banks don't publish annual fees in their Open Banking data; those cards show \"Not published\" and rank after the rest.",
    inputs: [
      { id: "balance", label: "Balance you usually carry ($)", type: "number", value: 0, min: 0 },
      { id: "business", label: "Show business cards", type: "check", value: false },
    ],
    filter: (it, c) => c.business || !it.attrs.business,
    rank: (it, c) => it.attrs.annualFee === null || it.attrs.annualFee === undefined ? 1e6 + (it.rate ?? 99) : twoYearCardCost(it, c),
    columns: [
      { label: "Card", html: (it) => nameCell(it, it.attrs.rewards ? " · rewards" : "") },
      { label: "Purchase rate", num: true, html: (it) => it.rate === 0 ? "No interest" : pct(it.rate), sort: (it) => it.rate ?? 99 },
      { label: "Annual fee", num: true, html: (it) => it.attrs.annualFee === null || it.attrs.annualFee === undefined ? "Not published" : money(it.attrs.annualFee), sort: (it) => it.attrs.annualFee ?? 1e6 },
      { label: "Interest-free days", num: true, html: (it) => it.attrs.interestFreeDays ?? "—", sort: (it) => -(it.attrs.interestFreeDays ?? 0) },
      { label: "Balance transfer", num: true, html: (it) => it.attrs.btRate === null || it.attrs.btRate === undefined ? "—" : `${pct(it.attrs.btRate)}${it.attrs.btMonths ? `<span class="sub">for ${plural(it.attrs.btMonths, "month")}</span>` : ""}`, sort: (it) => it.attrs.btRate ?? 99 },
      { label: "2-year cost", num: true, html: (it, c) => it.attrs.annualFee === null || it.attrs.annualFee === undefined ? "—" : money(twoYearCardCost(it, c)), sort: (it, c) => it.attrs.annualFee == null ? 1e6 : twoYearCardCost(it, c) },
    ],
    holding: (it, c) => ({ category: "credit_cards", provider: it.provider, product_name: it.name, rate: it.rate, amount: c.balance }),
    tools: [["calculators.html#bt", "Balance transfer calculator"]],
  },

  bank_accounts: {
    title: "Bank accounts", mode: "table", badge: "Live", source: OPEN_BANKING,
    lede: "Everyday transaction accounts, cheapest monthly fee first.",
    inputs: [],
    rank: (it) => it.rate ?? 0,
    columns: [
      { label: "Account", html: (it) => nameCell(it) },
      { label: "Monthly fee", num: true, html: (it) => money(it.attrs.monthlyFee ?? 0, 2), sort: (it) => it.attrs.monthlyFee ?? 0 },
      { label: "Overseas fee", num: true, html: (it) => it.attrs.overseasFee == null ? "—" : money(it.attrs.overseasFee, 2), sort: (it) => it.attrs.overseasFee ?? 99 },
      { label: "Interest", num: true, html: (it) => it.attrs.interest ? pct(it.attrs.interest) : "—", sort: (it) => -(it.attrs.interest ?? 0) },
    ],
    holding: (it) => ({ category: "bank_accounts", provider: it.provider, product_name: it.name }),
  },

  savings: {
    title: "Savings accounts", mode: "table", badge: "Live", source: OPEN_BANKING,
    lede: "Ranked by the interest you'd actually earn in the first year on your balance, including any intro rate. Bonus rates usually need a monthly deposit or no withdrawals; untick the box if you won't meet them.",
    inputs: [
      { id: "balance", label: "Balance ($)", type: "number", value: 10000, min: 0 },
      { id: "conditions", label: "I'll meet bonus conditions", type: "check", value: true },
    ],
    rank: (it, c) => -firstYearInterest(it, c),
    columns: [
      { label: "Account", html: (it) => nameCell(it) },
      { label: "Ongoing rate", num: true, html: (it, c) => pct(ongoingSavingsRate(it, c)), sort: (it, c) => -ongoingSavingsRate(it, c) },
      { label: "Intro rate", num: true, html: (it) => it.attrs.intro ? `${pct(it.attrs.intro)}${it.attrs.introMonths ? `<span class="sub">${plural(it.attrs.introMonths, "month")}</span>` : ""}` : "—", sort: (it) => -(it.attrs.intro ?? 0) },
      { label: "Interest in year 1", num: true, html: (it, c) => money(firstYearInterest(it, c)), sort: (it, c) => -firstYearInterest(it, c) },
      { label: "Bonus conditions", html: (it) => it.attrs.conditions ? `<span class="sub">${escapeHtml(it.attrs.conditions.slice(0, 140))}${it.attrs.conditions.length > 140 ? "…" : ""}</span>` : "<span class=\"sub\">None published</span>" },
    ],
    holding: (it, c) => ({ category: "savings", provider: it.provider, product_name: it.name, rate: ongoingSavingsRate(it, c), amount: c.balance }),
  },

  term_deposits: {
    title: "Term deposits", mode: "table", badge: "Live", source: OPEN_BANKING,
    lede: "Interest earned for your amount and term. Rates are each bank's published rate for that exact term.",
    inputs: [
      { id: "amount", label: "Amount ($)", type: "number", value: 10000, min: 1000 },
      { id: "months", label: "Term", type: "select", value: "12", options: [["3", "3 months"], ["6", "6 months"], ["12", "12 months"], ["24", "2 years"], ["36", "3 years"], ["60", "5 years"]] },
    ],
    filter: (it, c) => it.attrs.terms && it.attrs.terms[c.months] !== undefined,
    rank: (it, c) => -it.attrs.terms[c.months],
    columns: [
      { label: "Bank and product", html: (it) => nameCell(it) },
      { label: "Rate", num: true, html: (it, c) => pct(it.attrs.terms[c.months]), sort: (it, c) => -it.attrs.terms[c.months] },
      { label: "Interest earned", num: true, html: (it, c) => money(c.amount * it.attrs.terms[c.months] / 100 * Number(c.months) / 12), sort: (it, c) => -it.attrs.terms[c.months] },
      { label: "Best rate, any term", num: true, html: (it) => pct(it.rate), sort: (it) => -(it.rate ?? 0) },
    ],
    holding: (it, c) => ({ category: "term_deposits", provider: it.provider, product_name: it.name, rate: it.attrs.terms[c.months], amount: c.amount, renewal_date: addMonths(Number(c.months)) }),
  },

  money_transfers: {
    title: "Money transfers", mode: "fx", badge: "Live",
    lede: "How much arrives overseas after fees and the exchange-rate margin, from banks and transfer providers. Quotes come from Wise's public comparison data and refresh every time you search.",
  },

  business_accounts: {
    title: "Business bank accounts", mode: "table", badge: "Live", source: OPEN_BANKING,
    lede: "Business transaction, savings and term deposit accounts.",
    inputs: [{ id: "kind", label: "Account type", type: "select", value: "all", options: [["all", "All"], ["transaction", "Transaction"], ["savings", "Savings"], ["term_deposit", "Term deposit"]] }],
    filter: (it, c) => c.kind === "all" || it.attrs.kind === c.kind,
    rank: (it) => it.attrs.kind === "transaction" ? (it.attrs.monthlyFee ?? 0) : -(it.rate ?? 0),
    columns: [
      { label: "Account", html: (it) => nameCell(it) },
      { label: "Type", html: (it) => ({ transaction: "Transaction", savings: "Savings", term_deposit: "Term deposit" }[it.attrs.kind] || "—") },
      { label: "Best rate", num: true, html: (it) => it.rate ? pct(it.rate) : "—", sort: (it) => -(it.rate ?? 0) },
      { label: "Monthly fee", num: true, html: (it) => it.attrs.kind === "term_deposit" ? "—" : money(it.attrs.monthlyFee ?? 0, 2), sort: (it) => it.attrs.monthlyFee ?? 0 },
    ],
    holding: (it) => ({ category: "business_accounts", provider: it.provider, product_name: it.name, rate: it.rate }),
  },

  health_insurance: quoteCategory("Health insurance", [
    { id: "cover", label: "Cover", type: "select", options: [["hospital_extras", "Hospital and extras"], ["hospital", "Hospital only"], ["extras", "Extras only"]] },
    { id: "who", label: "Who's covered", type: "select", options: [["single", "Single"], ["couple", "Couple"], ["family", "Family"], ["single_parent", "Single parent"]] },
    { id: "age", label: "Age of oldest person", type: "number" }, POSTCODE, CURRENT, RENEWAL,
  ], { tools: [["calculators.html#mls", "Medicare levy surcharge calculator"], ["calculators.html#lhc", "Lifetime health cover loading"], ["https://www.privatehealth.gov.au/", "Government policy search (privatehealth.gov.au)"]] }),
  car_insurance: quoteCategory("Car insurance", [
    { id: "car", label: "Car (make, model, year) or rego", type: "text" },
    { id: "cover", label: "Cover", type: "select", options: [["comprehensive", "Comprehensive"], ["tpft", "Third party fire and theft"], ["tpp", "Third party property"]] },
    { id: "age", label: "Main driver's age", type: "number" }, POSTCODE, CURRENT, RENEWAL,
  ]),
  home_insurance: quoteCategory("Home insurance", [
    { id: "cover", label: "Cover", type: "select", options: [["home_contents", "Home and contents"], ["home", "Home (building) only"]] },
    { id: "built", label: "Year built", type: "number" },
    { id: "sumInsured", label: "Building sum insured ($)", type: "number" }, POSTCODE, CURRENT, RENEWAL,
  ], { tools: [["my-money.html", "Link this to your home in My money"]] }),
  contents_insurance: quoteCategory("Contents insurance", [
    { id: "sumInsured", label: "Contents value ($)", type: "number" },
    { id: "renter", label: "Do you rent?", type: "select", options: [["yes", "Yes, I rent"], ["no", "No, I own"]] }, POSTCODE, CURRENT, RENEWAL,
  ]),
  landlord_insurance: quoteCategory("Landlord insurance", [
    { id: "rent", label: "Weekly rent ($)", type: "number" },
    { id: "building", label: "Include building cover?", type: "select", options: [["yes", "Yes (house)"], ["no", "No (strata unit)"]] }, POSTCODE, CURRENT, RENEWAL,
  ]),
  travel_insurance: quoteCategory("Travel insurance", [
    { id: "destination", label: "Destination(s)", type: "text" },
    { id: "start", label: "Leaving", type: "date" }, { id: "end", label: "Returning", type: "date" },
    { id: "ages", label: "Travellers' ages (e.g. 42, 40, 9)", type: "text" },
    { id: "extras", label: "Cruise, ski or pre-existing conditions?", type: "text" },
  ], { tools: [["compare.html?c=money_transfers", "Money transfers"], ["compare.html?c=bank_accounts", "Accounts with no overseas fees"]] }),
  pet_insurance: quoteCategory("Pet insurance", [
    { id: "species", label: "Species", type: "select", options: [["dog", "Dog"], ["cat", "Cat"]] },
    { id: "breed", label: "Breed", type: "text" }, { id: "age", label: "Pet's age", type: "number" }, POSTCODE,
  ]),
  life_insurance: quoteCategory("Life insurance", [
    { id: "age", label: "Your age", type: "number" },
    { id: "smoker", label: "Smoker?", type: "select", options: [["no", "No"], ["yes", "Yes"]] },
    { id: "cover", label: "Cover amount ($)", type: "number" },
  ], { lede: "Life insurance needs a licensed adviser. Leave your details and an adviser partner will contact you once one is connected; we never cold-call.", adviser: true }),
  income_protection: quoteCategory("Income protection", [
    { id: "age", label: "Your age", type: "number" },
    { id: "income", label: "Annual income ($)", type: "number" },
    { id: "occupation", label: "Occupation", type: "text" },
  ], { lede: "Income protection needs a licensed adviser. Leave your details and an adviser partner will contact you once one is connected; we never cold-call.", adviser: true }),
  business_insurance: quoteCategory("Business insurance", [
    { id: "business", label: "What does your business do?", type: "text" },
    { id: "turnover", label: "Annual turnover ($)", type: "number" },
    { id: "covers", label: "Covers needed (public liability, professional indemnity, tools…)", type: "text" }, POSTCODE,
  ]),
  overseas_health: quoteCategory("Overseas visitor and student health cover", [
    { id: "type", label: "Cover", type: "select", options: [["oshc", "Overseas Student Health Cover (OSHC)"], ["ovhc", "Overseas Visitor Health Cover (OVHC)"]] },
    { id: "visa", label: "Visa subclass", type: "text" },
    { id: "who", label: "Who's covered", type: "select", options: [["single", "Single"], ["couple", "Couple"], ["family", "Family"]] },
    { id: "start", label: "Cover start", type: "date" },
  ]),

  energy: {
    title: "Energy", mode: "energy", badge: "Live",
    lede: "Every residential electricity plan the energy regulator publishes for your postcode, priced for your usage. Covers NSW, ACT, Victoria, Queensland, South Australia and Tasmania.",
  },
  internet: {
    title: "Internet (NBN, 5G home, satellite)", mode: "table", badge: "Sample", source: SAMPLE, sample: true,
    lede: "First-year cost, including any promotional price.",
    inputs: [
      { id: "speed", label: "Minimum speed", type: "select", value: "0", options: [["0", "Any"], ["50", "50 Mbps"], ["100", "100 Mbps"], ["500", "500 Mbps+"]] },
      { id: "tech", label: "Type", type: "select", value: "any", options: [["any", "Any"], ["NBN", "NBN"], ["5G home", "5G home"], ["Satellite", "Satellite"]] },
    ],
    filter: (it, c) => (c.tech === "any" || it.attrs.tech === c.tech) && (Number(c.speed) === 0 || (it.attrs.speed ?? 0) >= Number(c.speed)),
    rank: (it) => firstYearPlanCost(it),
    columns: [
      { label: "Provider and plan", html: (it) => nameCell(it) },
      { label: "Speed", num: true, html: (it) => it.attrs.speed ? `${it.attrs.speed} Mbps` : "—", sort: (it) => -(it.attrs.speed ?? 0) },
      { label: "Typical evening", num: true, html: (it) => it.attrs.eveningSpeed ? `${it.attrs.eveningSpeed} Mbps` : "—", sort: (it) => -(it.attrs.eveningSpeed ?? 0) },
      { label: "Monthly price", num: true, html: (it) => money(it.rate) + (it.attrs.promoPrice ? `<span class="sub">${money(it.attrs.promoPrice)} for ${plural(it.attrs.promoMonths, "month")}</span>` : ""), sort: (it) => it.rate },
      { label: "First-year cost", num: true, html: (it) => money(firstYearPlanCost(it)), sort: (it) => firstYearPlanCost(it) },
    ],
    holding: (it) => ({ category: "internet", provider: it.provider, product_name: it.name, amount: it.rate }),
  },
  mobile: {
    title: "Mobile plans", mode: "table", badge: "Sample", source: SAMPLE, sample: true,
    lede: "SIM-only plans, cheapest first.",
    inputs: [
      { id: "data", label: "Minimum data (GB)", type: "number", value: 20, min: 0 },
      { id: "network", label: "Network", type: "select", value: "any", options: [["any", "Any"], ["Telstra", "Telstra"], ["Optus", "Optus"], ["Vodafone", "Vodafone / TPG"]] },
    ],
    filter: (it, c) => (it.attrs.dataGb ?? 0) >= Number(c.data || 0) && (c.network === "any" || it.attrs.network === c.network || (c.network === "Vodafone" && it.attrs.network === "TPG")),
    rank: (it) => it.rate,
    columns: [
      { label: "Provider and plan", html: (it) => nameCell(it) },
      { label: "Data", num: true, html: (it) => it.attrs.dataGb >= 999 ? "Unlimited" : `${it.attrs.dataGb} GB`, sort: (it) => -(it.attrs.dataGb ?? 0) },
      { label: "Network", html: (it) => escapeHtml(it.attrs.network || "—") + (it.attrs.fiveG ? `<span class="sub">5G</span>` : "") },
      { label: "Monthly price", num: true, html: (it) => money(it.rate), sort: (it) => it.rate },
    ],
    holding: (it) => ({ category: "mobile", provider: it.provider, product_name: it.name, amount: it.rate }),
  },
  business_nbn: {
    title: "Business NBN", mode: "table", badge: "Sample", source: SAMPLE, sample: true,
    lede: "Business-grade internet with static IP and service guarantees.",
    inputs: [],
    rank: (it) => it.rate,
    columns: [
      { label: "Provider and plan", html: (it) => nameCell(it) },
      { label: "Speed", num: true, html: (it) => `${it.attrs.speed} Mbps` },
      { label: "Static IP", html: (it) => yesNo(it.attrs.staticIp) },
      { label: "4G backup", html: (it) => yesNo(it.attrs.backup4g) },
      { label: "Monthly price", num: true, html: (it) => money(it.rate), sort: (it) => it.rate },
    ],
    holding: (it) => ({ category: "business_nbn", provider: it.provider, product_name: it.name, amount: it.rate }),
  },
  fuel: {
    title: "Fuel prices", mode: "fuel", badge: "Live",
    lede: "Today's cheapest fuel near you. Western Australia is live now through FuelWatch; the other states need their government fuel API keys connected.",
  },

  super: {
    title: "Super funds", mode: "table", badge: "Sample", source: SAMPLE + " For official figures use the ATO YourSuper comparison tool.", sample: true,
    lede: "Fees in dollars on a $50,000 balance in each fund's default (MySuper) option. Comparisons are general information only; no rewards are paid for switching super.",
    inputs: [],
    rank: (it) => it.rate,
    columns: [
      { label: "Fund and option", html: (it) => nameCell(it) },
      { label: "Fees a year on $50k", num: true, html: (it) => money(it.rate), sort: (it) => it.rate },
      { label: "10-year return", num: true, html: (it) => it.attrs.return10y ? pct(it.attrs.return10y, 1) + "<span class=\"sub\">a year</span>" : "—", sort: (it) => -(it.attrs.return10y ?? 0) },
      { label: "Performance test", html: (it) => escapeHtml(it.attrs.performanceTest || "—") },
    ],
    holding: (it) => ({ category: "super", provider: it.provider, product_name: it.name, amount: it.rate }),
    tools: [["calculators.html#feedrag", "Super fee drag calculator"], ["https://www.ato.gov.au/single-page-applications/yoursuper-comparison-tool", "ATO YourSuper comparison tool"]],
  },
  share_trading: {
    title: "Share trading platforms", mode: "table", badge: "Sample", source: SAMPLE, sample: true,
    lede: "Yearly brokerage at your trading frequency, on $1,000 Australian share trades. General information only.",
    inputs: [{ id: "trades", label: "Trades a month", type: "number", value: 2, min: 0 }],
    rank: (it, c) => it.rate * Number(c.trades || 0) * 12,
    columns: [
      { label: "Platform", html: (it) => nameCell(it) },
      { label: "ASX trade ($1,000)", num: true, html: (it) => money(it.rate, 2), sort: (it) => it.rate },
      { label: "US trade", num: true, html: (it) => it.attrs.usBrokerage == null ? "—" : money(it.attrs.usBrokerage, 2) },
      { label: "FX fee", num: true, html: (it) => it.attrs.fxFee == null ? "—" : pct(it.attrs.fxFee) },
      { label: "CHESS sponsored", html: (it) => yesNo(it.attrs.chess) },
      { label: "Yearly cost", num: true, html: (it, c) => money(it.rate * Number(c.trades || 0) * 12), sort: (it, c) => it.rate * Number(c.trades || 0) },
    ],
    holding: (it) => ({ category: "share_trading", provider: it.provider, product_name: it.name }),
  },
  etfs: {
    title: "ETFs", mode: "table", badge: "Sample", source: SAMPLE, sample: true,
    lede: "Management fees on popular exchange-traded funds, and what they cost you a year. To beat inflation, an investment's return after fees has to beat CPI.",
    inputs: [
      { id: "amount", label: "Amount invested ($)", type: "number", value: 10000, min: 0 },
      { id: "theme", label: "Theme", type: "select", value: "any", options: [["any", "Any"], ["Australian shares", "Australian shares"], ["Global shares", "Global shares"], ["US shares", "US shares"], ["US technology", "US technology"], ["Diversified", "Diversified"], ["Ethical", "Ethical"], ["Bonds", "Bonds"], ["Gold", "Gold"]] },
    ],
    filter: (it, c) => c.theme === "any" || it.attrs.theme === c.theme,
    rank: (it) => it.rate,
    columns: [
      { label: "ETF", html: (it) => nameCell(it) },
      { label: "Theme", html: (it) => escapeHtml(it.attrs.theme || "—") + `<span class="sub">${escapeHtml(it.attrs.index || "")}</span>` },
      { label: "Management fee", num: true, html: (it) => pct(it.rate), sort: (it) => it.rate },
      { label: "Yearly fee", num: true, html: (it, c) => money(c.amount * it.rate / 100, 2), sort: (it) => it.rate },
    ],
    holding: (it, c) => ({ category: "etfs", provider: it.provider, product_name: it.name, amount: c.amount }),
    tools: [["compare.html?c=share_trading", "Where to buy: share trading platforms"]],
  },
};

// --- Ranking helpers -----------------------------------------------------------------------------------------

function twoYearCardCost(it, c){
  return 2 * (it.attrs.annualFee ?? 0) + 2 * Number(c.balance || 0) * (it.rate ?? 0) / 100;
}

function ongoingSavingsRate(it, c){
  const base = it.attrs.base ?? 0;
  return c.conditions ? Math.max(base, it.attrs.bonus ?? 0) : base;
}

function firstYearInterest(it, c){
  const ongoing = ongoingSavingsRate(it, c);
  const months = Math.min(12, it.attrs.introMonths ?? 0);
  const intro = c.conditions && it.attrs.intro ? it.attrs.intro : (it.attrs.intro && !it.attrs.bonus ? it.attrs.intro : null);
  const yearRate = intro ? (intro * months + ongoing * (12 - months)) / 12 : ongoing;
  return Number(c.balance || 0) * yearRate / 100;
}

function firstYearPlanCost(it){
  const months = Math.min(12, it.attrs.promoMonths ?? 0);
  return it.attrs.promoPrice ? it.attrs.promoPrice * months + it.rate * (12 - months) : it.rate * 12;
}

function addMonths(m){
  const d = new Date();
  d.setMonth(d.getMonth() + m);
  return localIsoDate(d);
}

// Which product categories each asset type anchors (My money uses this to offer the right "add a product").
const ASSET_KINDS = {
  home: { label: "Home (live in)", categories: ["home_loans", "home_insurance", "energy", "internet"] },
  investment_property: { label: "Investment property", categories: ["home_loans", "landlord_insurance"] },
  vehicle: { label: "Vehicle", categories: ["car_loans", "car_insurance"] },
  cash: { label: "Cash and deposits", categories: ["savings", "term_deposits", "bank_accounts"] },
  super: { label: "Super", categories: ["super", "life_insurance", "income_protection"] },
  investments: { label: "Investments", categories: ["share_trading", "etfs"] },
  debt: { label: "Debts", categories: ["credit_cards", "personal_loans"] },
  business: { label: "Business", categories: ["business_loans", "business_accounts", "business_insurance", "business_nbn"] },
};

function categoryTitle(key){ return (CATEGORIES[key] && CATEGORIES[key].title) || key; }
