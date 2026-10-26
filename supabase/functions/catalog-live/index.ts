// Live lookups that can't be stored nightly: fuel prices near a suburb (WA FuelWatch), money transfer quotes
// (Wise's public comparison of banks and transfer providers) and energy bill estimates for a postcode (AER plan
// details, cached for 3 days). Public and read-only; "Verify JWT" is off.
import { createClient } from "jsr:@supabase/supabase-js@2";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
  auth: { persistSession: false },
});

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
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

// --- Fuel: WA FuelWatch (the only state feed that needs no API key) ----------------------------------------

const FUEL_PRODUCTS: Record<string, number> = { ulp: 1, premium95: 2, diesel: 4, lpg: 5, premium98: 6, e85: 10 };

function tag(item: string, name: string): string {
  const m = item.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, "").trim() : "";
}

async function fuel(params: URLSearchParams) {
  const state = (params.get("state") ?? "WA").toUpperCase();
  if (state !== "WA") {
    throw new HttpError(422, "Live prices for this state need its government fuel API key, which isn't connected yet. WA works now.");
  }
  const suburb = (params.get("suburb") ?? "").trim();
  if (!/^[A-Za-z][A-Za-z '\-]{1,40}$/.test(suburb)) throw new HttpError(400, "Enter a WA suburb");
  const product = FUEL_PRODUCTS[params.get("fuel") ?? "ulp"] ?? 1;
  const url = `https://www.fuelwatch.wa.gov.au/fuelwatch/fuelWatchRSS?Product=${product}&Suburb=${encodeURIComponent(suburb)}&Surrounding=yes`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 (BeatInflation fuel lookup)" }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new HttpError(502, `FuelWatch is unavailable (${res.status})`);
  const xml = await res.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const it = m[1];
    return {
      price: Number(tag(it, "price")),
      station: tag(it, "trading-name"),
      brand: tag(it, "brand"),
      address: tag(it, "address"),
      suburb: tag(it, "location"),
      lat: Number(tag(it, "latitude")),
      lng: Number(tag(it, "longitude")),
      date: tag(it, "date"),
    };
  }).filter(i => Number.isFinite(i.price) && i.price > 0).sort((a, b) => a.price - b.price);
  return { state, suburb, fuel: params.get("fuel") ?? "ulp", source: "WA FuelWatch", stations: items.slice(0, 60) };
}

// --- Money transfers: Wise's public comparison API ---------------------------------------------------------

async function fx(params: URLSearchParams) {
  const to = (params.get("to") ?? "").toUpperCase();
  if (!/^[A-Z]{3}$/.test(to)) throw new HttpError(400, "Choose a currency");
  const amount = Number(params.get("amount") ?? "1000");
  if (!(amount >= 50 && amount <= 1_000_000)) throw new HttpError(400, "Enter an amount between $50 and $1,000,000");
  const url = `https://api.wise.com/v4/comparisons?sourceCurrency=AUD&targetCurrency=${to}&sendAmount=${amount}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new HttpError(502, `Transfer quotes are unavailable (${res.status})`);
  const body = await res.json();
  const providers = (body.providers ?? []).map((p: any) => {
    const q = (p.quotes ?? [])[0] ?? {};
    return {
      name: p.name ?? p.alias, type: p.type ?? null, fee: q.fee ?? null, rate: q.rate ?? null,
      received: q.receivedAmount ?? null, markupPercent: q.markup ?? null,
      speed: q.deliveryEstimation?.duration?.max ?? null, collected: q.dateCollected ?? null,
      logo: p.logos?.normal?.pngUrl ?? null,
    };
  }).filter((p: any) => p.received !== null).sort((a: any, b: any) => b.received - a.received);
  return { from: "AUD", to, amount, source: "Wise comparison data", providers };
}

// --- Energy: estimated annual bill per plan for a postcode -------------------------------------------------

const PERIOD_DAYS: Record<string, number> = { P1D: 1, P1W: 7, P1M: 30.44, P3M: 91.31, P1Y: 365 };
const SKIP_PLAN = /business|commercial|\bEV\b|electric vehicle|demand|time of use|\bTOU\b|flexible|controlled load only|wholesale|embedded/i;

async function planDetail(brand: string, planId: string): Promise<any | null> {
  const key = `${brand}:${planId}`;
  const { data: cached } = await db.from("energy_plan_cache").select("detail,fetched_at").eq("plan_key", key).maybeSingle();
  if (cached && Date.now() - Date.parse(cached.fetched_at) < 3 * 86400_000) return cached.detail;
  try {
    const res = await fetch(`https://cdr.energymadeeasy.gov.au/${brand}/cds-au/v1/energy/plans/${encodeURIComponent(planId)}`, {
      headers: { "x-v": "3", "x-min-v": "1", Accept: "application/json" }, signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) return null;
    const detail = (await res.json()).data;
    await db.from("energy_plan_cache").upsert({ plan_key: key, detail, fetched_at: new Date().toISOString() });
    return detail;
  } catch {
    return null;
  }
}

// Single-rate plans only (the most common); prices in the feed exclude GST.
function annualCost(detail: any, kwh: number, exportKwh: number) {
  const c = detail?.electricityContract;
  if (!c || !/^SINGLE_RATE/.test(c.pricingModel ?? "")) return null;
  let usage = 0, supply = 0, totalDays = 0;
  for (const t of c.tariffPeriod ?? []) {
    if (t.rateBlockUType !== "singleRate" || !t.singleRate) return null;
    const share = 1 / (c.tariffPeriod.length || 1);
    const periodDays = PERIOD_DAYS[t.singleRate.period ?? "P1Y"] ?? 365;
    let remaining = kwh * share * periodDays / 365;
    let periodCost = 0;
    for (const r of t.singleRate.rates ?? []) {
      const price = Number(r.unitPrice);
      if (!Number.isFinite(price)) return null;
      const block = r.volume ? Math.min(remaining, Number(r.volume)) : remaining;
      periodCost += block * price;
      remaining -= block;
      if (remaining <= 0) break;
    }
    usage += periodCost * 365 / periodDays;
    supply += Number(t.dailySupplyCharge ?? 0) * 365 * share;
    totalDays += 365 * share;
  }
  if (!totalDays) return null;
  let total = (usage + supply) * 1.1;
  const guaranteed = (c.discounts ?? []).filter((d: any) => d.type === "GUARANTEED");
  for (const d of guaranteed) {
    if (d.methodUType === "percentOfBill") total *= 1 - Number(d.percentOfBill?.rate ?? 0);
    else if (d.methodUType === "percentOfUse") total -= usage * 1.1 * Number(d.percentOfUse?.rate ?? 0);
  }
  const fitRate = Math.max(0, ...((c.solarFeedInTariff ?? []).flatMap((s: any) =>
    (s.singleTariff?.rates ?? []).map((r: any) => Number(r.unitPrice) || 0))));
  const credit = exportKwh * fitRate;
  const conditional = (c.discounts ?? []).filter((d: any) => d.type !== "GUARANTEED").map((d: any) => d.displayName || d.type);
  return {
    annual: Math.round(total - credit),
    supplyPerDay: Number(((supply / 365) * 1.1).toFixed(2)),
    usageCentsPerKwh: Number(((usage / kwh) * 110).toFixed(2)),
    fitCents: Number((fitRate * 100).toFixed(1)),
    conditionalDiscounts: conditional,
  };
}

async function energy(params: URLSearchParams) {
  const postcode = params.get("postcode") ?? "";
  if (!/^\d{4}$/.test(postcode)) throw new HttpError(400, "Enter a 4-digit postcode");
  const kwh = Math.min(Math.max(Number(params.get("kwh") ?? 4000) || 4000, 500), 30000);
  const exportKwh = Math.min(Math.max(Number(params.get("export") ?? 0) || 0, 0), 30000);
  const { data: nets, error } = await db.from("energy_postcodes").select("distributor").eq("postcode", postcode);
  if (error) throw error;
  if (!nets?.length) throw new HttpError(404, "No plans found for that postcode. WA and NT aren't covered by the national data.");
  const distributors = nets.map(n => n.distributor);
  const plans: any[] = [];
  for (const d of distributors) {
    const { data, error: planError } = await db.from("catalog_items").select("provider,name,attrs")
      .eq("category", "energy_plan").eq("active", true).contains("attrs", { distributors: [d] }).limit(2000);
    if (planError) throw planError;
    plans.push(...(data ?? []));
  }
  // Up to 10 plans per retailer, skipping business, EV and time-of-use plans this estimate can't price.
  const perProvider = new Map<string, any[]>();
  for (const p of plans) {
    if (SKIP_PLAN.test(p.name)) continue;
    const list = perProvider.get(p.provider) ?? perProvider.set(p.provider, []).get(p.provider)!;
    if (list.length < 10) list.push(p);
  }
  const candidates = [...perProvider.values()].flat();
  const priced = await mapLimit(candidates, 12, async (p) => {
    const detail = await planDetail(p.attrs.brand, p.attrs.planId);
    const cost = detail ? annualCost(detail, kwh, exportKwh) : null;
    if (!cost) return null;
    return {
      provider: p.provider, name: p.name, planId: p.attrs.planId, ...cost,
      url: String(p.attrs.planId).includes("@") ? null
        : `https://www.energymadeeasy.gov.au/plan?id=${encodeURIComponent(p.attrs.planId)}&postcode=${postcode}`,
    };
  });
  const results = priced.filter(Boolean).sort((a: any, b: any) => a.annual - b.annual);
  return { postcode, distributors, kwh, exportKwh, checked: candidates.length, plans: results.slice(0, 50) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const url = new URL(req.url);
    const params = url.searchParams;
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      for (const [k, v] of Object.entries(body ?? {})) params.set(k, String(v));
    }
    const type = params.get("type");
    if (type === "fuel") return json(await fuel(params));
    if (type === "fx") return json(await fx(params));
    if (type === "energy") return json(await energy(params));
    throw new HttpError(400, "type must be fuel, fx or energy");
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    return json({ error: e instanceof Error ? e.message : String(e) }, status);
  }
});
