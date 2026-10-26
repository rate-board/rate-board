// Nightly catalogue sync for every product category beyond home loans.
//   ?job=banking  credit cards, bank accounts, savings, term deposits, business accounts (Open Banking)
//   ?job=loans    personal, car and business loans (Open Banking)
//   ?job=energy1 / energy2   residential electricity plan lists from the energy regulator (AER), in two halves
//   ?job=cpi      ABS consumer price index, which sets the value of Inflation Points
import { createClient } from "jsr:@supabase/supabase-js@2";

type Db = ReturnType<typeof createClient>;
type Row = {
  category: string; provider: string; name: string; url: string | null; rate: number | null;
  attrs: Record<string, unknown>; source: "cdr" | "aer"; source_ref: string; active: boolean; updated_at: string;
};

const MIN_MINUTES_BETWEEN_RUNS = 30;
const LENDER_CONCURRENCY = 4;
const DETAIL_CONCURRENCY = 6;

async function getJson(url: string, version: number): Promise<any> {
  const res = await fetch(url, {
    headers: { "x-v": String(version), "x-min-v": "1", Accept: "application/json" },
    signal: AbortSignal.timeout(25_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

// CDR publishes rates as decimals ("0.0634"); a few publishers use percentages.
function percent(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number((n < 1 ? n * 100 : n).toFixed(3));
}

function money(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// ISO 8601 durations as used by CDR ("P90D", "P6M", "P1Y") in months, rounded to whole months.
function months(duration: unknown): number | null {
  const m = String(duration ?? "").match(/^P(?:(\d+)Y)?(?:(\d+)M)?(?:(\d+)D)?$/);
  if (!m || !(m[1] || m[2] || m[3])) return null;
  return Math.max(1, Math.round(Number(m[1] ?? 0) * 12 + Number(m[2] ?? 0) + Number(m[3] ?? 0) / 30.44));
}

function days(duration: unknown): number | null {
  const m = String(duration ?? "").match(/^P(\d+)D$/);
  return m ? Number(m[1]) : null;
}

const min = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.min(...v) : null; };
const max = (xs: (number | null)[]) => { const v = xs.filter((x): x is number => x !== null); return v.length ? Math.max(...v) : null; };

function isBusiness(p: any): boolean {
  return (p.eligibility ?? []).some((e: any) => e.eligibilityType === "BUSINESS")
    || /business|corporate|commercial|smsf|wholesale|agribusiness|farm/i.test(p.name ?? "");
}

// Older CDR versions put a fee's amount in `amount`; newer ones in `fixedAmount.amount`.
function fee(p: any, test: (f: any) => boolean): number | null {
  for (const f of p.fees ?? []) if (test(f)) { const a = money(f.amount ?? f.fixedAmount?.amount); if (a !== null) return a; }
  return null;
}

function link(p: any): string | null {
  const u = p.additionalInformation?.overviewUri || p.applicationUri || null;
  return typeof u === "string" && /^https:\/\//i.test(u) ? u : null;
}

// --- Open Banking categories -----------------------------------------------------------------------------

function cardRow(p: any): Partial<Row> | null {
  // Some banks file loans, packages and accounts under cards; keep only products that look like a card.
  const rates = p.lendingRates ?? [];
  const looksLikeCard = /card|visa|mastercard|amex/i.test(p.name ?? "")
    || rates.some((r: any) => r.lendingRateType === "PURCHASE")
    || (p.features ?? []).some((f: any) => f.featureType === "INTEREST_FREE");
  if (!looksLikeCard || /loan|mortgage|line of credit|overdraft|offset|package/i.test(p.name ?? "") && !/card/i.test(p.name ?? "")) return null;
  const purchase = min(rates.filter((r: any) => r.lendingRateType === "PURCHASE").map((r: any) => percent(r.rate)))
    ?? min(rates.filter((r: any) => ["VARIABLE", "FIXED"].includes(r.lendingRateType)).map((r: any) => percent(r.rate)));
  const bt = rates.filter((r: any) => r.lendingRateType === "BALANCE_TRANSFER")
    .map((r: any) => ({ rate: percent(r.rate), months: months(r.additionalValue) }))
    .sort((a: any, b: any) => (a.rate ?? 99) - (b.rate ?? 99))[0];
  const interestFree = (p.features ?? []).find((f: any) => f.featureType === "INTEREST_FREE");
  const rewards = (p.features ?? []).filter((f: any) => /REWARD|FREQUENT_FLYER|LOYALTY/i.test(f.featureType ?? ""))
    .map((f: any) => f.additionalValue || f.additionalInfo).filter(Boolean);
  return {
    category: "credit_cards",
    rate: purchase,
    attrs: {
      cashRate: min(rates.filter((r: any) => r.lendingRateType === "CASH_ADVANCE").map((r: any) => percent(r.rate))),
      btRate: bt?.rate ?? null,
      btMonths: bt?.months ?? null,
      annualFee: fee(p, f => (f.feeType === "PERIODIC" && f.additionalValue === "P1Y") || /annual/i.test(f.name ?? "")),
      interestFreeDays: days(interestFree?.additionalValue),
      rewards: rewards.length > 0,
      rewardsInfo: rewards.slice(0, 2).join("; ") || null,
      foreignFee: fee(p, f => /international|overseas|foreign/i.test(f.name ?? "") && f.feeType === "TRANSACTION"),
      business: isBusiness(p),
    },
  };
}

// Bonus rates are published as margins over the base rate, and introductory rates as margins over the best
// ongoing rate (UBank: 5.35% ongoing + 0.90% intro = 6.25%). If adding gives an implausible total, the bank
// published a total instead.
function savingsRates(p: any) {
  const rates = p.depositRates ?? [];
  const pick = (type: string) => max(rates.filter((r: any) => r.depositRateType === type).map((r: any) => percent(r.rate)));
  const base = pick("VARIABLE") ?? 0;
  const bonusMargin = pick("BONUS");
  const introMargin = pick("INTRODUCTORY") ?? pick("BONUS_INTRODUCTORY");
  const add = (on: number, m: number | null) => m === null ? null : (on + m <= 9 ? Number((on + m).toFixed(2)) : m);
  const bonus = add(base, bonusMargin);
  const intro = add(max([base, bonus]) ?? 0, introMargin);
  const introRate = rates.find((r: any) => r.depositRateType === "INTRODUCTORY" || r.depositRateType === "BONUS_INTRODUCTORY");
  const bonusRate = rates.find((r: any) => r.depositRateType === "BONUS");
  return {
    base: base || null, bonus, intro,
    introMonths: months(introRate?.additionalValue),
    conditions: (bonusRate?.additionalInfo ?? bonusRate?.applicabilityConditions?.[0]?.additionalInfo ?? null)?.slice(0, 300) ?? null,
    max: max([base || null, bonus, intro]),
    ongoing: max([base || null, bonus]),
  };
}

function transAndSavingsRow(p: any): Partial<Row> | null {
  const s = savingsRates(p);
  const business = isBusiness(p);
  const savings = /sav|saver|bonus|goal|reward|high interest|growth|maximi|boost|investment|notice|accelerat/i.test(p.name ?? "")
    || (s.max ?? 0) >= 1.5;
  const common = {
    monthlyFee: fee(p, f => f.feeType === "PERIODIC" && (f.additionalValue === "P1M" || /month/i.test(f.name ?? ""))) ?? 0,
    overseasFee: fee(p, f => /international|overseas|foreign/i.test(f.name ?? "")),
    business,
  };
  if (business) return { category: "business_accounts", rate: s.max, attrs: { ...common, kind: savings ? "savings" : "transaction", ...s } };
  if (savings) return { category: "savings", rate: s.max, attrs: { ...common, ...s } };
  return { category: "bank_accounts", rate: common.monthlyFee, attrs: { ...common, interest: s.max } };
}

function termDepositRow(p: any): Partial<Row> | null {
  if (/wholesale|corporate/i.test(p.name ?? "")) return null;
  const terms: Record<string, number> = {};
  let minDeposit: number | null = null;
  for (const r of p.depositRates ?? []) {
    if (r.depositRateType !== "FIXED") continue;
    const m = months(r.additionalValue);
    const rate = percent(r.rate);
    if (m === null || rate === null || rate > 15) continue;
    if (!(m in terms) || rate > terms[m]) terms[m] = rate;
    for (const t of r.tiers ?? []) if (t.unitOfMeasure === "DOLLAR") minDeposit = min([minDeposit, money(t.minimumValue)]);
  }
  if (!Object.keys(terms).length) return null;
  return {
    category: isBusiness(p) ? "business_accounts" : "term_deposits",
    rate: max(Object.values(terms)),
    attrs: { terms, minDeposit, business: isBusiness(p), kind: "term_deposit" },
  };
}

function loanRow(p: any, business: boolean): Partial<Row> | null {
  const rates = (p.lendingRates ?? []).map((r: any) => ({ rate: percent(r.rate), comp: percent(r.comparisonRate), type: r.lendingRateType }))
    .filter((r: any) => r.rate !== null && r.rate > 1 && r.rate < 40);
  if (!rates.length) return null;
  const low = rates.sort((a: any, b: any) => a.rate - b.rate)[0];
  const name = p.name ?? "";
  const car = /car|vehicle|auto|motor/i.test(name);
  return {
    category: business || isBusiness(p) ? "business_loans" : car ? "car_loans" : "personal_loans",
    rate: low.rate,
    attrs: {
      rateTo: max(rates.map((r: any) => r.rate)),
      comparisonRate: low.comp,
      rateType: rates.some((r: any) => r.type === "FIXED") ? (rates.some((r: any) => r.type === "VARIABLE") ? "Fixed or variable" : "Fixed") : "Variable",
      secured: /secured/i.test(name) && !/unsecured/i.test(name),
      establishmentFee: fee(p, f => f.feeType === "UPFRONT" || /establish|application/i.test(f.name ?? "")),
      monthlyFee: fee(p, f => f.feeType === "PERIODIC" && f.additionalValue === "P1M"),
      green: /green|electric|ev\b|solar/i.test(name),
    },
  };
}

// outputs: the catalogue categories a CDR category can produce, so a failed fetch protects all of them.
type CdrSpec = { category: string; version: number; outputs: string[]; map: (p: any) => Partial<Row> | null };
export const CDR_JOBS: Record<string, CdrSpec[]> = {
  banking: [
    { category: "CRED_AND_CHRG_CARDS", version: 7, outputs: ["credit_cards"], map: cardRow },
    { category: "TRANS_AND_SAVINGS_ACCOUNTS", version: 7, outputs: ["bank_accounts", "savings", "business_accounts"], map: transAndSavingsRow },
    { category: "TERM_DEPOSITS", version: 7, outputs: ["term_deposits", "business_accounts"], map: termDepositRow },
  ],
  loans: [
    { category: "PERS_LOANS", version: 7, outputs: ["personal_loans", "car_loans", "business_loans"], map: (p) => loanRow(p, false) },
    { category: "BUSINESS_LOANS", version: 7, outputs: ["business_loans"], map: (p) => loanRow(p, true) },
  ],
};

// Returns the product details plus how many detail requests failed; a failure means the list is incomplete.
export async function fetchCategory(baseUri: string, category: string, version: number): Promise<{ details: any[]; failed: number }> {
  const ids: string[] = [];
  let url: string | undefined = `${baseUri}/cds-au/v1/banking/products?product-category=${category}&page-size=100`;
  while (url) {
    const page = await getJson(url, 6);
    for (const p of page.data?.products ?? []) ids.push(p.productId);
    url = page.links?.next || undefined;
  }
  const details = await mapLimit(ids, DETAIL_CONCURRENCY, async (id) => {
    try {
      return (await getJson(`${baseUri}/cds-au/v1/banking/products/${encodeURIComponent(id)}`, version)).data;
    } catch {
      return null;
    }
  });
  const ok = details.filter(Boolean);
  return { details: ok, failed: details.length - ok.length };
}

// Writes one provider's rows and retires that provider's rows in the same categories that weren't seen.
async function writeRows(db: Db, provider: string, categories: string[], source: string, rows: Row[]) {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from("catalog_items").upsert(rows.slice(i, i + 500), { onConflict: "category,provider,source_ref" });
    if (error) throw error;
  }
  const seen = new Set(rows.map(r => `${r.category}|${r.source_ref}`));
  const { data: existing, error } = await db.from("catalog_items").select("id,category,source_ref")
    .eq("provider", provider).eq("source", source).eq("active", true).in("category", categories);
  if (error) throw error;
  const stale = (existing ?? []).filter(r => !seen.has(`${r.category}|${r.source_ref}`)).map(r => r.id);
  for (let i = 0; i < stale.length; i += 500) {
    const res = await db.from("catalog_items").update({ active: false }).in("id", stale.slice(i, i + 500));
    if (res.error) throw res.error;
  }
  return stale.length;
}

const OUTPUT_CATEGORIES: Record<string, string[]> = {
  banking: ["credit_cards", "bank_accounts", "savings", "term_deposits", "business_accounts"],
  loans: ["personal_loans", "car_loans", "business_loans"],
};

async function syncCdr(db: Db, job: string) {
  const { data: lenders, error } = await db.from("lenders").select("id,name,cdr_base_uri").eq("active", true).not("cdr_base_uri", "is", null);
  if (error) throw error;
  const now = new Date().toISOString();
  return mapLimit(lenders ?? [], LENDER_CONCURRENCY, async (lender) => {
    try {
      const rows: Row[] = [];
      // A product missing because a request failed must not be retired as if the bank had withdrawn it. Banks'
      // APIs also return an empty list now and then (Westpac, 26 Oct 2026), so an empty category retires nothing.
      const incomplete = new Set<string>();
      let failedDetails = 0;
      for (const spec of CDR_JOBS[job]) {
        const { details, failed } = await fetchCategory(lender.cdr_base_uri, spec.category, spec.version);
        if (failed || details.length === 0){ failedDetails += failed; spec.outputs.forEach(c => incomplete.add(c)); }
        for (const p of details) {
          const mapped = spec.map(p);
          if (!mapped) continue;
          rows.push({
            category: mapped.category!, provider: lender.name, name: p.name, url: link(p), rate: mapped.rate ?? null,
            attrs: { ...mapped.attrs, lenderId: lender.id, brand: p.brandName ?? null },
            source: "cdr", source_ref: p.productId, active: true, updated_at: now,
          });
        }
      }
      const retired = await writeRows(db, lender.name, OUTPUT_CATEGORIES[job].filter(c => !incomplete.has(c)), "cdr", rows);
      const counts: Record<string, number> = {};
      for (const r of rows) counts[r.category] = (counts[r.category] ?? 0) + 1;
      return { provider: lender.id, ok: true, counts, retired, ...(failedDetails ? { failedDetails, notRetired: [...incomplete] } : {}) };
    } catch (e) {
      return { provider: lender.id, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

// --- Energy plans (AER Product Reference Data) ------------------------------------------------------------

const ENERGY_BRANDS = [
  ["agl", "origin", "energyaustralia", "red-energy", "lumo", "alinta", "momentum", "powershop", "ovo-energy", "tango"],
  ["globird", "dodo", "nectr", "amber", "engie", "1st-energy", "covau", "energy-locals", "actewagl"],
];

async function syncEnergy(db: Db, half: number) {
  const now = new Date().toISOString();
  return mapLimit(ENERGY_BRANDS[half], 3, async (brand) => {
    try {
      const rows: Row[] = [];
      const postcodes = new Map<string, Set<string>>();
      let providerName = brand;
      for (let page = 1; page <= 20; page++) {
        const res = await getJson(
          `https://cdr.energymadeeasy.gov.au/${brand}/cds-au/v1/energy/plans?type=MARKET&fuel-type=ELECTRICITY&page-size=1000&page=${page}`, 1);
        for (const p of res.data?.plans ?? []) {
          if (p.customerType && p.customerType !== "RESIDENTIAL") continue;
          providerName = p.brandName || providerName;
          const distributors: string[] = p.geography?.distributors ?? [];
          for (const pc of p.geography?.includedPostcodes ?? []) {
            for (const d of distributors) (postcodes.get(pc) ?? postcodes.set(pc, new Set()).get(pc)!).add(d);
          }
          rows.push({
            category: "energy_plan", provider: p.brandName || brand, name: p.displayName || p.planId, url: null, rate: null,
            attrs: { brand, planId: p.planId, distributors, effectiveFrom: p.effectiveFrom ?? null },
            source: "aer", source_ref: `${brand}:${p.planId}`, active: true, updated_at: now,
          });
        }
        if ((res.meta?.totalPages ?? 1) <= page) break;
      }
      // Rows for a brand all carry its display name; retire by brand display name.
      for (const r of rows) r.provider = providerName;
      const retired = await writeRows(db, providerName, ["energy_plan"], "aer", rows);
      const pairs = [...postcodes].flatMap(([postcode, ds]) => [...ds].map(distributor => ({ postcode, distributor })));
      for (let i = 0; i < pairs.length; i += 1000) {
        const res = await db.from("energy_postcodes").upsert(pairs.slice(i, i + 1000), { ignoreDuplicates: true });
        if (res.error) throw res.error;
      }
      return { provider: brand, ok: true, counts: { energy_plan: rows.length }, retired };
    } catch (e) {
      return { provider: brand, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
}

// --- ABS CPI ---------------------------------------------------------------------------------------------------

export async function syncCpi(db: Db) {
  const url = "https://data.api.abs.gov.au/rest/data/ABS,CPI,2.0.0/1.10001.10.50.Q?startPeriod=2024-Q1&format=jsondata";
  const res = await fetch(url, { headers: { Accept: "application/vnd.sdmx.data+json" }, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`ABS ${res.status}`);
  const json = await res.json();
  const periods: { id: string }[] = json.data?.structures?.[0]?.dimensions?.observation?.[0]?.values
    ?? json.data?.structure?.dimensions?.observation?.[0]?.values ?? [];
  const series: any = Object.values(json.data?.dataSets?.[0]?.series ?? {})[0];
  const rows = Object.entries(series?.observations ?? {}).map(([i, obs]: [string, any]) => ({
    quarter: periods[Number(i)]?.id, index_value: Number(obs[0]),
  })).filter(r => /^\d{4}-Q[1-4]$/.test(r.quarter ?? "") && Number.isFinite(r.index_value));
  if (!rows.length) throw new Error("no CPI observations found — ABS response layout may have changed");
  const { error } = await db.from("cpi_quarters").upsert(rows);
  if (error) throw error;
  return [{ provider: "abs-cpi", ok: true, counts: { quarters: rows.length }, latest: rows[rows.length - 1] }];
}

// --------------------------------------------------------------------------------------------------------------

async function handler(req: Request): Promise<Response> {
  const job = new URL(req.url).searchParams.get("job") ?? "";
  if (!["banking", "loans", "energy1", "energy2", "cpi"].includes(job)) {
    return Response.json({ error: "job must be banking, loans, energy1, energy2 or cpi" }, { status: 400 });
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Anyone holding the public anon key can call this, so cap how often each job can be triggered.
  const { data: last } = await db.from("catalog_runs").select("started_at").eq("job", job)
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - Date.parse(last.started_at) < MIN_MINUTES_BETWEEN_RUNS * 60_000) {
    return Response.json({ skipped: `${job} ran in the last ${MIN_MINUTES_BETWEEN_RUNS} minutes` }, { status: 429 });
  }
  const { data: run, error: runError } = await db.from("catalog_runs").insert({ job }).select("id").single();
  if (runError) return Response.json({ error: runError.message }, { status: 500 });

  let results: any[];
  try {
    results = job === "cpi" ? await syncCpi(db)
      : job.startsWith("energy") ? await syncEnergy(db, job === "energy1" ? 0 : 1)
      : await syncCdr(db, job);
  } catch (e) {
    results = [{ provider: job, ok: false, error: e instanceof Error ? e.message : String(e) }];
  }
  const failed = results.filter(r => !r.ok).length;
  const status = failed === 0 ? "ok" : failed === results.length ? "failed" : "partial";
  await db.from("catalog_runs").update({ finished_at: new Date().toISOString(), status, summary: results }).eq("id", run.id);
  return Response.json({ job, status, results });
}

if (Deno.env.get("SYNC_LOCAL_TEST") !== "1") Deno.serve(handler);
