// Nightly sync: pulls each lender's home-loan products from its public Open Banking (CDR)
// Product Reference Data API and updates public.rates where the published figures changed.
import { createClient } from "jsr:@supabase/supabase-js@2";

const LOAN_AMOUNT = 600_000;
const LVR = 80;
const MIN_MINUTES_BETWEEN_RUNS = 30;
const LENDER_CONCURRENCY = 4;
const DETAIL_CONCURRENCY = 4;

// Loans most borrowers can't get; left in, they'd show up as misleading "best" rates.
const RESTRICTED = /veteran|staff|defen[cs]e|sustainable|green|upgrade|first home|single parent|land loan|construction|build|low doc|fresh start|low deposit|deposit scheme|fee assistance|bridging|reverse|equity|line of credit/i;

const FIXED_TERMS: Record<string, string> = { P1Y: "fixed1", P12M: "fixed1", P2Y: "fixed2", P24M: "fixed2", P3Y: "fixed3", P36M: "fixed3" };
export const PRODUCT_KEYS = ["variable", "variable_package", "fixed1", "fixed2", "fixed3"] as const;
type ProductKey = typeof PRODUCT_KEYS[number];

export type Pick = { rate: number; comp: number; productName: string };

type Tier = { name?: string; unitOfMeasure?: string; minimumValue?: string | number; maximumValue?: string | number };
type LendingRate = {
  lendingRateType?: string; rate?: string; comparisonRate?: string;
  loanPurpose?: string; repaymentType?: string; additionalValue?: string; tiers?: Tier[];
};
type ProductDetail = {
  productId: string; name: string;
  features?: { featureType?: string }[];
  fees?: { name?: string }[];
  lendingRates?: LendingRate[];
};

async function getJson(url: string, maxVersion: number): Promise<any> {
  const res = await fetch(url, {
    headers: { "x-v": String(maxVersion), "x-min-v": "1", Accept: "application/json" },
    signal: AbortSignal.timeout(20_000),
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
function percent(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number((n < 1 ? n * 100 : n).toFixed(3));
}

function appliesToBenchmarkLoan(r: LendingRate): boolean {
  if (r.loanPurpose && r.loanPurpose !== "OWNER_OCCUPIED") return false;
  if (r.repaymentType && r.repaymentType !== "PRINCIPAL_AND_INTEREST") return false;
  for (const t of r.tiers ?? []) {
    const isLvr = /lvr|loan.?to.?value/i.test(t.name ?? "") || t.unitOfMeasure === "PERCENT";
    const isAmount = t.unitOfMeasure === "DOLLAR" || /balance|amount/i.test(t.name ?? "");
    if (isLvr) {
      const min = t.minimumValue != null ? percent(t.minimumValue) ?? 0 : 0;
      const max = t.maximumValue != null ? percent(t.maximumValue) ?? 100 : 100;
      if (!(min < LVR && max >= LVR - 0.01)) return false;
    } else if (isAmount) {
      const min = t.minimumValue != null ? Number(t.minimumValue) : 0;
      const max = t.maximumValue != null ? Number(t.maximumValue) : Infinity;
      if (!(min <= LOAN_AMOUNT && LOAN_AMOUNT <= max)) return false;
    }
  }
  return true;
}

function isPackage(p: ProductDetail, rate: number, comp: number): boolean {
  if (/package/i.test(p.name)) return true;
  if ((p.fees ?? []).some(f => /package/i.test(f.name ?? ""))) return true;
  const hasOffset = (p.features ?? []).some(f => f.featureType === "OFFSET");
  return hasOffset && comp - rate >= 0.10;
}

function better(a: Pick | undefined, b: Pick): boolean {
  return !a || b.rate < a.rate || (b.rate === a.rate && b.comp < a.comp);
}

function sane(rate: number, comp: number): boolean {
  return rate > 1 && rate < 15 && comp > 1 && comp < 20;
}

export function pickRates(products: ProductDetail[]): Partial<Record<ProductKey, Pick>> {
  const picks: Partial<Record<ProductKey, Pick>> = {};
  for (const p of products) {
    if (RESTRICTED.test(p.name)) continue;
    for (const r of p.lendingRates ?? []) {
      if (!appliesToBenchmarkLoan(r)) continue;
      const rate = percent(r.rate);
      const comp = percent(r.comparisonRate);
      if (rate === null || comp === null || !sane(rate, comp)) continue;
      let key: ProductKey | undefined;
      if (r.lendingRateType === "VARIABLE") key = isPackage(p, rate, comp) ? "variable_package" : "variable";
      else if (r.lendingRateType === "FIXED") key = FIXED_TERMS[r.additionalValue ?? ""] as ProductKey | undefined;
      if (!key) continue;
      const candidate = { rate, comp, productName: p.name };
      if (better(picks[key], candidate)) picks[key] = candidate;
    }
  }
  return picks;
}

export async function fetchLenderProducts(baseUri: string): Promise<ProductDetail[]> {
  const ids: string[] = [];
  let url: string | undefined = `${baseUri}/cds-au/v1/banking/products?product-category=RESIDENTIAL_MORTGAGES&page-size=100`;
  while (url) {
    const page = await getJson(url, 6);
    for (const p of page.data?.products ?? []) ids.push(p.productId);
    url = page.links?.next || undefined;
  }
  const details = await mapLimit(ids, DETAIL_CONCURRENCY, async (id) => {
    try {
      return (await getJson(`${baseUri}/cds-au/v1/banking/products/${encodeURIComponent(id)}`, 7)).data as ProductDetail;
    } catch {
      return null;
    }
  });
  return details.filter((d): d is ProductDetail => d !== null);
}

// --- Lenders outside Open Banking: read from their own websites -------------------------------

const SCRAPE_UA = "RateBoard/1.0 (+https://beatinflation.com.au/; nightly rate check)";

async function getText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": SCRAPE_UA, Accept: "text/html,application/json" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.text();
}

function pageText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

function offer(picks: Partial<Record<ProductKey, Pick>>, key: ProductKey, rateRaw: unknown, compRaw: unknown, productName: string) {
  const rate = percent(rateRaw as string);
  const comp = percent(compRaw as string);
  if (rate === null || comp === null || !sane(rate, comp)) return;
  const candidate = { rate, comp, productName };
  if (better(picks[key], candidate)) picks[key] = candidate;
}

const TERM_KEYS: Record<string, ProductKey> = { "1": "fixed1", "2": "fixed2", "3": "fixed3" };

// Athena embeds its rate card in the page's Next.js data, banded by LVR (fractions, e.g. 0.7–0.8).
async function scrapeAthena() {
  const html = await getText("https://www.athena.com.au/home-loans/rates-no-fees");
  const m = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("Athena page data not found");
  const rates = JSON.parse(m[1])?.props?.pageProps?.rates;
  const band = (bands: Record<string, any> | undefined) =>
    Object.values(bands ?? {}).find((b: any) => b.minLvr < LVR / 100 && b.maxLvr >= LVR / 100 - 0.0001) as any;
  const picks: Partial<Record<ProductKey, Pick>> = {};
  // Power Up adds an offset but charges no fees, so by the same rule as Open Banking lenders it counts as basic.
  for (const [product, name] of [["direct-basics", "Straight Up"], ["direct-extras", "Power Up"]]) {
    const b = band(rates?.[product]?.VARIABLE_RATE?.PRINCIPAL_AND_INTEREST?.OWNER_OCCUPIED);
    if (b) offer(picks, "variable", b.rate, b.comparisonRate, name);
  }
  for (const [term, key] of Object.entries(TERM_KEYS)) {
    const b = band(rates?.["direct-basics"]?.FIXED_RATE?.[term]?.PRINCIPAL_AND_INTEREST?.OWNER_OCCUPIED);
    if (b) offer(picks, key, b.rate, b.comparisonRate, `${term} year fixed`);
  }
  return picks;
}

// Pepper fills its pages from a key/value feed: hl-ov-* = owner-occupier variable rows by LVR band,
// hl-of-* = owner-occupier fixed rows by term; *-min is the lowest ("from") rate of its risk-based range.
async function scrapePepper() {
  const data = JSON.parse(await getText("https://www.peppermoney.com.au/graphql/execute.json/pepper/variables"));
  const vars = new Map<string, string>(
    (data?.data?.variableList?.items ?? []).map((i: any) => [i.key, String(i.value?.plaintext ?? "").trim()]),
  );
  const picks: Partial<Record<ProductKey, Pick>> = {};
  for (let r = 1; vars.has(`hl-ov-r${r}-title`); r++) {
    const m = vars.get(`hl-ov-r${r}-title`)!.match(/(\d+)\s*-\s*(\d+)\s*%/);
    if (m && Number(m[1]) < LVR && Number(m[2]) >= LVR) {
      offer(picks, "variable", vars.get(`hl-ov-r${r}-v-min`), vars.get(`hl-ov-r${r}-c-min`), "Variable home loan (from rate)");
    }
  }
  for (let r = 1; vars.has(`hl-of-r${r}-title`); r++) {
    const term = vars.get(`hl-of-r${r}-title`)!.match(/^(\d+)\s*year/)?.[1];
    const key = term ? TERM_KEYS[term] : undefined;
    if (key) offer(picks, key, vars.get(`hl-of-r${r}-f-min`), vars.get(`hl-of-r${r}-c-min`), `${term} year fixed (from rate)`);
  }
  return picks;
}

async function scrapeLoansComAu() {
  const picks: Partial<Record<ProductKey, Pick>> = {};
  const variable = pageText(await getText("https://www.loans.com.au/home-loans/variable-rate/"));
  const v = variable.match(/Variable Bare Home Loan ([\d.]+)% p\.a\.\s*\*?\s*([\d.]+)% p\.a\./);
  if (v) offer(picks, "variable", v[1], v[2], "Variable Bare Home Loan");
  // The principal & interest table comes first; the interest-only table after it repeats the same product names.
  const fixed = pageText(await getText("https://www.loans.com.au/home-loans/fixed-rate/"));
  for (const m of fixed.matchAll(/Fixed Bold (\d) years? ([\d.]+)% p\.a\.\s*\*?\s*([\d.]+)% p\.a\./g)) {
    const key = TERM_KEYS[m[1]];
    if (key && !picks[key]) offer(picks, key, m[2], m[3], `Fixed Bold ${m[1]} year${m[1] === "1" ? "" : "s"}`);
  }
  return picks;
}

// A scraper must find every rate it expects; anything less means the page changed, so nothing is written.
export const SCRAPERS: Record<string, { expected: ProductKey[]; run: () => Promise<Partial<Record<ProductKey, Pick>>> }> = {
  "athena-home-loans": { expected: ["variable", "fixed1", "fixed2", "fixed3"], run: scrapeAthena },
  "pepper-money": { expected: ["variable", "fixed2", "fixed3"], run: scrapePepper },
  "loans-com-au": { expected: ["variable", "fixed1", "fixed2", "fixed3"], run: scrapeLoansComAu },
};

// --- RBA cash rate target: marks on the rate charts ------------------------------------------

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

// The RBA's table reads "30 Sep 2026 +0.25 4.60 …" per decision: effective date, change, new target.
export async function fetchRbaDecisions() {
  const text = pageText(await getText("https://www.rba.gov.au/statistics/cash-rate/"));
  const rows: { effective_date: string; change: number; cash_rate: number }[] = [];
  const pattern = /(\d{1,2}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{4}) ([+-]?\d+\.\d{2}) (\d+\.\d{2})/g;
  for (const m of text.matchAll(pattern)) {
    rows.push({ effective_date: `${m[3]}-${MONTHS[m[2]]}-${m[1].padStart(2, "0")}`, change: Number(m[4]), cash_rate: Number(m[5]) });
  }
  return rows;
}

async function syncRba(db: ReturnType<typeof createClient>) {
  const rows = await fetchRbaDecisions();
  if (rows.length < 10) {
    return { lender: "rba", ok: false, source: "rba", error: `only ${rows.length} RBA decisions found — page layout may have changed`, changed: [] as string[] };
  }
  const { data: existing, error: readError } = await db.from("rba_cash_rate").select("effective_date");
  if (readError) throw readError;
  const known = new Set((existing ?? []).map(r => r.effective_date));
  const { error } = await db.from("rba_cash_rate").upsert(rows);
  if (error) throw error;
  const added = rows.filter(r => !known.has(r.effective_date))
    .map(r => `${r.effective_date}: ${r.change >= 0 ? "+" : ""}${r.change.toFixed(2)} → ${r.cash_rate.toFixed(2)}`);
  return { lender: "rba", ok: true, source: "rba", changed: known.size ? added : [`loaded ${rows.length} decisions`] };
}

function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
}

// Open Banking data is the lender's complete product list, so a column it no longer covers is removed;
// a scraped page only shows what it shows, so scraped columns are only ever updated.
async function writePicks(
  db: ReturnType<typeof createClient>, lenderId: string,
  picks: Partial<Record<ProductKey, Pick>>, source: "cdr" | "scrape",
): Promise<string[]> {
  const { data: existing, error } = await db.from("rates")
    .select("product_key,rate,comparison_rate").eq("lender_id", lenderId);
  if (error) throw error;
  const current = new Map((existing ?? []).map(r => [r.product_key, r]));

  const changed: string[] = [];
  const now = new Date().toISOString();
  for (const key of PRODUCT_KEYS) {
    const pick = picks[key];
    const cur = current.get(key);
    if (pick) {
      const differs = !cur || Number(cur.rate) !== pick.rate || Number(cur.comparison_rate) !== pick.comp;
      const row = {
        lender_id: lenderId, product_key: key, source, product_name: pick.productName, checked_at: now,
        ...(differs ? { rate: pick.rate, comparison_rate: pick.comp, as_of: sydneyToday() } : {}),
      };
      const res = differs
        ? await db.from("rates").upsert(row)
        : await db.from("rates").update(row).eq("lender_id", lenderId).eq("product_key", key);
      if (res.error) throw res.error;
      if (differs) {
        const before = cur ? `${Number(cur.rate)}/${Number(cur.comparison_rate)} → ` : "";
        changed.push(`${key}: ${before}${pick.rate}/${pick.comp}`);
      }
    } else if (cur && source === "cdr") {
      const res = await db.from("rates").delete().eq("lender_id", lenderId).eq("product_key", key);
      if (res.error) throw res.error;
      changed.push(`${key}: removed`);
    }
  }
  return changed;
}

async function syncLender(db: ReturnType<typeof createClient>, lender: { id: string; cdr_base_uri: string | null }) {
  if (lender.cdr_base_uri) {
    const products = await fetchLenderProducts(lender.cdr_base_uri);
    const picks = pickRates(products);
    if (Object.keys(picks).length === 0) {
      return { lender: lender.id, ok: false, source: "cdr", error: `no usable rates in ${products.length} products`, changed: [] as string[] };
    }
    return { lender: lender.id, ok: true, source: "cdr", products: products.length, changed: await writePicks(db, lender.id, picks, "cdr") };
  }
  const scraper = SCRAPERS[lender.id];
  const picks = await scraper.run();
  const missing = scraper.expected.filter(k => !picks[k]);
  if (missing.length) {
    return { lender: lender.id, ok: false, source: "scrape", error: `site layout may have changed — couldn't find ${missing.join(", ")}`, changed: [] as string[] };
  }
  return { lender: lender.id, ok: true, source: "scrape", changed: await writePicks(db, lender.id, picks, "scrape") };
}

async function handler(): Promise<Response> {
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // The endpoint is public (cron calls it without a token), so cap how often anyone can trigger a run.
  const { data: last } = await db.from("sync_runs").select("started_at")
    .order("started_at", { ascending: false }).limit(1).maybeSingle();
  if (last && Date.now() - Date.parse(last.started_at) < MIN_MINUTES_BETWEEN_RUNS * 60_000) {
    return Response.json({ skipped: "a sync ran in the last 30 minutes" }, { status: 429 });
  }

  const { data: run, error: runError } = await db.from("sync_runs").insert({}).select("id").single();
  if (runError) return Response.json({ error: runError.message }, { status: 500 });

  const { data: lenders, error } = await db.from("lenders").select("id,cdr_base_uri").eq("active", true);
  if (error) return Response.json({ error: error.message }, { status: 500 });
  const syncable = (lenders ?? []).filter(l => l.cdr_base_uri || SCRAPERS[l.id]);

  const results = await mapLimit(syncable, LENDER_CONCURRENCY, async (lender) => {
    try {
      return await syncLender(db, lender);
    } catch (e) {
      return { lender: lender.id, ok: false, error: e instanceof Error ? e.message : String(e), changed: [] as string[] };
    }
  });
  try {
    results.push(await syncRba(db));
  } catch (e) {
    results.push({ lender: "rba", ok: false, source: "rba", error: e instanceof Error ? e.message : String(e), changed: [] as string[] });
  }

  const failed = results.filter(r => !r.ok).length;
  const status = failed === 0 ? "ok" : failed === results.length ? "failed" : "partial";
  await db.from("sync_runs").update({ finished_at: new Date().toISOString(), status, summary: results }).eq("id", run.id);
  return Response.json({ status, results });
}

if (Deno.env.get("SYNC_LOCAL_TEST") !== "1") Deno.serve(handler);
