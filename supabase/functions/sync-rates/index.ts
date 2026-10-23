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

function sydneyToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Australia/Sydney" }).format(new Date());
}

async function syncLender(db: ReturnType<typeof createClient>, lender: { id: string; cdr_base_uri: string }) {
  const products = await fetchLenderProducts(lender.cdr_base_uri);
  const picks = pickRates(products);
  if (Object.keys(picks).length === 0) {
    return { lender: lender.id, ok: false, error: `no usable rates in ${products.length} products`, changed: [] as string[] };
  }

  const { data: existing, error } = await db.from("rates")
    .select("product_key,rate,comparison_rate").eq("lender_id", lender.id);
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
        lender_id: lender.id, product_key: key, source: "cdr", product_name: pick.productName, checked_at: now,
        ...(differs ? { rate: pick.rate, comparison_rate: pick.comp, as_of: sydneyToday() } : {}),
      };
      const res = differs
        ? await db.from("rates").upsert(row)
        : await db.from("rates").update(row).eq("lender_id", lender.id).eq("product_key", key);
      if (res.error) throw res.error;
      if (differs) changed.push(`${key}: ${cur ? `${Number(cur.rate)} → ` : ""}${pick.rate}`);
    } else if (cur) {
      const res = await db.from("rates").delete().eq("lender_id", lender.id).eq("product_key", key);
      if (res.error) throw res.error;
      changed.push(`${key}: removed`);
    }
  }
  return { lender: lender.id, ok: true, products: products.length, changed };
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

  const { data: lenders, error } = await db.from("lenders")
    .select("id,cdr_base_uri").eq("active", true).not("cdr_base_uri", "is", null);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const results = await mapLimit(lenders ?? [], LENDER_CONCURRENCY, async (lender) => {
    try {
      return await syncLender(db, lender);
    } catch (e) {
      return { lender: lender.id, ok: false, error: e instanceof Error ? e.message : String(e), changed: [] as string[] };
    }
  });

  const failed = results.filter(r => !r.ok).length;
  const status = failed === 0 ? "ok" : failed === results.length ? "failed" : "partial";
  await db.from("sync_runs").update({ finished_at: new Date().toISOString(), status, summary: results }).eq("id", run.id);
  return Response.json({ status, results });
}

if (Deno.env.get("SYNC_LOCAL_TEST") !== "1") Deno.serve(handler);
