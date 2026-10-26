// Shared by the board (home-loans.html) and the agent portal (agent.html): the Supabase client, rate data,
// the rate-history chart and the agent-rate list.

const SUPABASE_URL = "https://fwjiofgwolontlglwrog.supabase.co";
// Publishable key: designed to ship in browser code — row-level security in the database decides what it may do.
const SUPABASE_KEY = "sb_publishable_jxUPwSfv1hkMzND0qAWhcA_Cenv2DRz";
const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const BOARD_URL = new URL(".", location.href).href;
const AGENT_URL = BOARD_URL + "agent.html";

// Interest-only runs higher than P&I on both the rate and the spread, independent of loan purpose.
// These three tables are mirrored by public.rate_adjustment() in the database; keep the two in step.
const REPAY_ADJUST = {
  variable: { rate: 0.40, spread: 0.10 },
  variable_package: { rate: 0.40, spread: 0.10 },
  fixed1:   { rate: 0.45, spread: 0.10 },
  fixed2:   { rate: 0.45, spread: 0.10 },
  fixed3:   { rate: 0.45, spread: 0.10 },
};

// Investment loans run higher than owner-occupier on both the rate and the spread, independent of repayment type.
const PURPOSE_ADJUST = {
  variable: { rate: 0.15, spread: 0.03 },
  variable_package: { rate: 0.15, spread: 0.03 },
  fixed1:   { rate: 0.18, spread: 0.03 },
  fixed2:   { rate: 0.20, spread: 0.03 },
  fixed3:   { rate: 0.20, spread: 0.03 },
};

// Lower LVR (more equity/deposit) prices better; above 80% typically attracts LMI and a bigger premium.
const LVR_ADJUST = {
  "60": { rate: -0.10, spread: -0.02 },
  "80": { rate: 0, spread: 0 },
  "90": { rate: 0.35, spread: 0.05 },
};
const ZERO = { rate: 0, spread: 0 };

const PURPOSE_LABEL = { owner: "Owner Occupied", investor: "Investment" };
const REPAY_LABEL = { pi: "P&I", io: "Interest Only" };
const LVR_LABEL = { "60": "≤60% LVR", "80": "60–80% LVR", "90": "80–90% LVR" };

let LENDERS = [];   // [{ id, name, source_url, note }]
let PRODUCTS = [];  // [{ key, label }]
let BASE = {};      // lenderId -> productKey -> [rate, comparisonRate]
let PRODUCT_NAMES = {}; // lenderId -> productKey -> lender's own product name, when known
let HISTORY = {}; // lenderId -> productKey -> [{ date, rate, comp, source, product }] oldest first; rate null = withdrawn
let RBA = []; // RBA cash rate decisions since 2020, oldest first: [{ date, change, cashRate }]
let RATES = null; // purpose -> repay -> lvr -> productKey -> lenderId -> [rate, comparisonRate] | null
let AGENT_RATES = []; // live agent rates below the lender's, lowest first (see public.board_agent_rates)

const $ = (id) => document.getElementById(id);

function fmt(n){ return n.toFixed(2) + "%"; }

function escapeHtml(s){
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function safeUrl(u){
  return typeof u === "string" && /^https:\/\//i.test(u) ? u : null;
}

function localIsoDate(d = new Date()){
  const pad = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
}

function formatMobile(m){
  return m && /^04\d{8}$/.test(m) ? m.slice(0, 4) + " " + m.slice(4, 7) + " " + m.slice(7) : m || "";
}

// Monthly repayment on a loan: principal and interest over the term, or interest only.
function monthlyRepayment(ratePct, amount, years, interestOnly){
  const r = ratePct / 100 / 12;
  if (interestOnly) return amount * r;
  const n = years * 12;
  return r === 0 ? amount / n : amount * r / (1 - Math.pow(1 + r, -n));
}

function dollars(n){ return "$" + Math.round(n).toLocaleString("en-AU"); }

function loanTypeLabel(pur, rep, band){
  return PURPOSE_LABEL[pur] + ", " + REPAY_LABEL[rep] + ", " + LVR_LABEL[band];
}

function lenderName(id){
  const l = LENDERS.find(x => x.id === id);
  return l ? l.name : id;
}

function productLabel(key){
  const p = PRODUCTS.find(x => x.key === key);
  return p ? p.label : key;
}

function initials(name){
  return String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

// Errors raised in the database arrive as their message; show it without Postgres decoration.
function friendlyError(err){
  const m = (err && err.message) || String(err || "");
  if (/JWT|session/i.test(m) && /expired|invalid/i.test(m)) return "Your session has expired. Sign in again.";
  if (/duplicate key|leads_one_request/i.test(m)) return "Already requested.";
  if (/violates check constraint/i.test(m)) return "One of the values isn't allowed. Check the form and try again.";
  return m || "Something went wrong. Please try again.";
}

// Calls the marketplace edge function and surfaces its own error message.
async function callMarketplace(body){
  const { data, error } = await sb.functions.invoke("marketplace", { body });
  if (error){
    let message = error.message;
    try { const j = await error.context.json(); if (j && j.error) message = j.error; } catch (_) {}
    throw new Error(message);
  }
  return data;
}

// Only the owner-occupier / P&I / 60–80% LVR combination is sourced; the rest apply typical market spreads to it.
function buildRates(){
  const result = {};
  for (const pur of ["owner", "investor"]){
    result[pur] = {};
    for (const rep of ["pi", "io"]){
      result[pur][rep] = {};
      for (const band of ["60", "80", "90"]){
        result[pur][rep][band] = {};
        for (const p of PRODUCTS){
          const col = result[pur][rep][band][p.key] = {};
          const ra = rep === "io" ? (REPAY_ADJUST[p.key] || ZERO) : ZERO;
          const pa = pur === "investor" ? (PURPOSE_ADJUST[p.key] || ZERO) : ZERO;
          const la = LVR_ADJUST[band];
          const shift = ra.rate + pa.rate + la.rate;
          const extraSpread = ra.spread + pa.spread + la.spread;
          for (const lender of LENDERS){
            const base = BASE[lender.id] && BASE[lender.id][p.key];
            col[lender.id] = base
              ? [Number((base[0] + shift).toFixed(3)), Number((base[1] + shift + extraSpread).toFixed(3))]
              : null;
          }
        }
      }
    }
  }
  return result;
}

// Rates, history and agent rates are readable only by signed-in users (enforced by the database).
// Returns an error, or null once the globals above are filled.
async function loadMarket(signedIn){
  const none = Promise.resolve({ data: [], error: null });
  const [lendersRes, productsRes, ratesRes, historyRes, rbaRes, agentRes] = await Promise.all([
    sb.from("lenders").select("id,name,source_url,note").eq("active", true).order("sort_order"),
    sb.from("products").select("key,label").order("sort_order"),
    signedIn ? sb.from("rates").select("lender_id,product_key,rate,comparison_rate,product_name,source") : none,
    signedIn ? sb.from("rate_history")
      .select("lender_id,product_key,rate,comparison_rate,as_of,changed_at,source,product_name")
      .order("changed_at").limit(10000) : none,
    signedIn ? sb.from("rba_cash_rate").select("effective_date,change,cash_rate")
      .gte("effective_date", "2020-01-01").order("effective_date") : none,
    signedIn ? sb.rpc("board_agent_rates") : none,
  ]);
  const err = lendersRes.error || productsRes.error || ratesRes.error || historyRes.error || rbaRes.error || agentRes.error;
  if (err) return err;
  LENDERS = lendersRes.data;
  PRODUCTS = productsRes.data;
  BASE = {};
  PRODUCT_NAMES = {};
  for (const row of ratesRes.data){
    (BASE[row.lender_id] ||= {})[row.product_key] = [Number(row.rate), Number(row.comparison_rate)];
    if (row.product_name) (PRODUCT_NAMES[row.lender_id] ||= {})[row.product_key] = row.product_name;
  }
  HISTORY = {};
  for (const h of historyRes.data){
    ((HISTORY[h.lender_id] ||= {})[h.product_key] ||= []).push({
      date: h.as_of,
      rate: h.rate === null ? null : Number(h.rate),
      comp: h.comparison_rate === null ? null : Number(h.comparison_rate),
      source: h.source,
      product: h.product_name,
    });
  }
  RBA = rbaRes.data.map(r => ({ date: r.effective_date, change: Number(r.change), cashRate: Number(r.cash_rate) }));
  AGENT_RATES = agentRes.data.map(r => ({ ...r, rate: Number(r.rate), comparison_rate: Number(r.comparison_rate) }));
  RATES = buildRates();
  return null;
}

// Agent rates for one cell, lowest first (on a tie, the one posted first).
function agentRatesFor(lenderId, key, pur, rep, band){
  return AGENT_RATES.filter(a => a.lender_id === lenderId && a.product_key === key
    && a.purpose === pur && a.repay === rep && a.lvr === band)
    .sort((a, b) => a.rate - b.rate || (a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0));
}

// --- Rate history ----------------------------------------------------------------------

const CHART = { w: 276, h: 108, padL: 38, padR: 44, padT: 22, padB: 20 };
const RBA_LOOKBACK_DAYS = 120;

function dayNumber(iso){
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

function shortDate(iso){
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

function dayMonth(iso){
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-AU", { day: "numeric", month: "short" });
}

function signed(n){ return (n > 0 ? "+" : "−") + Math.abs(n).toFixed(2); }

// The most recent RBA hike or cut on or before a date, if recent enough to be relevant.
function rbaChangeBefore(iso){
  for (let i = RBA.length - 1; i >= 0; i--){
    const r = RBA[i];
    if (r.change !== 0 && r.date <= iso) return dayNumber(iso) - dayNumber(r.date) <= RBA_LOOKBACK_DAYS ? r : null;
  }
  return null;
}

// One entry per date (a same-day correction replaces the earlier figure), oldest first.
function historySeries(lenderId, key){
  const byDate = new Map();
  for (const entry of (HISTORY[lenderId] && HISTORY[lenderId][key]) || []) byDate.set(entry.date, entry);
  return [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// Straight segments between recorded points, then flat from the latest point to today (it is still current).
function historyChartSvg(series, metric){
  const pts = series.filter(e => e[metric] !== null);
  if (pts.length < 2) return "";
  const { w, h, padL, padR, padT, padB } = CHART;
  // Start early enough to show the RBA move that preceded the first record, so the lag is visible.
  const leadIn = rbaChangeBefore(pts[0].date);
  const startDate = leadIn && leadIn.date < pts[0].date ? leadIn.date : pts[0].date;
  const x0 = dayNumber(startDate);
  const x1 = Math.max(dayNumber(localIsoDate()), dayNumber(pts[pts.length - 1].date) + 1);
  const values = pts.map(e => e[metric]);
  const step = Math.max(...values) - Math.min(...values) > 0.6 ? 0.5 : 0.25;
  const lo = Math.floor((Math.min(...values) - 0.05) / step) * step;
  const hi = Math.max(lo + step, Math.ceil((Math.max(...values) + 0.05) / step) * step);
  const X = (day) => padL + (day - x0) / (x1 - x0) * (w - padL - padR);
  const Y = (v) => padT + (hi - v) / (hi - lo) * (h - padT - padB);

  const first = pts[0], last0 = pts[pts.length - 1];
  const summary = `${metric === "rate" ? "Interest rate" : "Comparison rate"} over time: ${fmt(first[metric])} on ${shortDate(first.date)}, `
    + `${fmt(last0[metric])} since ${shortDate(last0.date)}, ${pts.length} recorded changes.`;
  let svg = `<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="${escapeHtml(summary)}">`;
  for (let t = lo; t <= hi + 1e-9; t += step){
    svg += `<line class="hc-grid" x1="${padL}" x2="${w - padR}" y1="${Y(t)}" y2="${Y(t)}"/>`;
    svg += `<text class="hc-axis" x="${padL - 6}" y="${Y(t) + 3}" text-anchor="end">${t.toFixed(2)}</text>`;
  }
  for (const r of RBA){
    if (r.change === 0) continue;
    const day = dayNumber(r.date);
    if (day < x0 || day > x1) continue;
    const x = X(day);
    const anchor = x < padL + 18 ? "start" : x > w - padR - 18 ? "end" : "middle";
    svg += `<line class="hc-rba" x1="${x}" x2="${x}" y1="${padT - 6}" y2="${h - padB}"/>`;
    svg += `<text class="hc-rba-label" x="${x}" y="${padT - 9}" text-anchor="${anchor}">${signed(r.change)}</text>`;
  }
  let path = `M${X(dayNumber(pts[0].date))},${Y(pts[0][metric])}`;
  for (let i = 1; i < pts.length; i++) path += ` L${X(dayNumber(pts[i].date))},${Y(pts[i][metric])}`;
  path += ` H${X(x1)}`;
  svg += `<path class="hc-line" d="${path}"/>`;
  for (const e of pts) svg += `<circle class="hc-dot" cx="${X(dayNumber(e.date))}" cy="${Y(e[metric])}" r="4"/>`;
  const last = pts[pts.length - 1][metric];
  svg += `<text class="hc-end" x="${X(x1) + 5}" y="${Y(last) + 4}">${fmt(last)}</text>`;
  svg += `<text class="hc-axis" x="${padL}" y="${h - 4}">${shortDate(startDate)}</text>`;
  svg += `<text class="hc-axis" x="${X(x1)}" y="${h - 4}" text-anchor="end">Today</text>`;
  return svg + "</svg>";
}

// Title, chart, legend, recent changes and RBA context for one lender and product.
function historyHtml(lenderId, key, metric, isBase){
  const productName = PRODUCT_NAMES[lenderId] && PRODUCT_NAMES[lenderId][key];
  const otherMetric = metric === "rate" ? "comp" : "rate";
  const series = historySeries(lenderId, key);

  let html = `<p class="hc-title">${escapeHtml(lenderName(lenderId))} · ${escapeHtml(productLabel(key))}</p>`;
  html += `<p class="hc-sub">${productName ? escapeHtml(productName) : "&nbsp;"}</p>`;
  const chart = historyChartSvg(series, metric);
  html += chart || `<p class="hc-empty">${series.length ? "No change since " + shortDate(series[0].date) + "." : "No history recorded yet."}</p>`;
  if (chart) {
    html += `<div class="hc-legend"><span><i class="hc-key-line"></i>${metric === "rate" ? "Interest rate" : "Comparison rate"}</span>`
      + `<span><i class="hc-key-rba"></i>RBA cash rate change</span></div>`;
  }

  const rows = series.map((e, i) => {
    const prev = series[i - 1];
    let delta = "first recorded";
    if (e[metric] === null) delta = "withdrawn";
    else if (prev && prev[metric] !== null){
      const d = e[metric] - prev[metric];
      delta = Math.abs(d) < 0.005 ? "no change" : (d > 0 ? "▲ +" : "▼ −") + Math.abs(d).toFixed(2);
    }
    const notes = [];
    if (e.source === "manual") notes.push("hand-collected");
    if (e.product && (!prev || prev.product !== e.product)) notes.push((prev ? "now " : "") + e.product);
    const rba = rbaChangeBefore(e.date);
    if (rba){
      const days = dayNumber(e.date) - dayNumber(rba.date);
      notes.push(`${days === 0 ? "same day as" : days + (days === 1 ? " day" : " days") + " after"} RBA ${signed(rba.change)} (${dayMonth(rba.date)})`);
    }
    const value = e[metric] === null ? "—" : fmt(e[metric]);
    const other = e[otherMetric] === null ? "" : `${otherMetric === "comp" ? "comp." : "rate"} ${fmt(e[otherMetric])}`;
    return `<tr><td>${shortDate(e.date)}${notes.length ? `<span class="hc-note">${escapeHtml(notes.join(" · "))}</span>` : ""}</td>`
      + `<td class="num">${value}<span class="hc-note">${other}</span></td><td class="delta">${delta}</td></tr>`;
  }).reverse();
  if (rows.length) html += `<table><tbody>${rows.slice(0, 6).join("")}</tbody></table>`;
  if (rows.length > 6) html += `<p class="hc-foot">…and ${rows.length - 6} earlier changes.</p>`;

  const latest = RBA[RBA.length - 1];
  const lastMove = [...RBA].reverse().find(r => r.change !== 0);
  if (latest && lastMove) {
    html += `<p class="hc-foot">RBA cash rate ${latest.cashRate.toFixed(2)}% — last moved ${signed(lastMove.change)} on ${shortDate(lastMove.date)}.</p>`;
  }
  if (!isBase) html += `<p class="hc-foot">History shows the published owner-occupier P&amp;I rate (60–80% LVR); the figure in the table is estimated from it.</p>`;
  return html;
}

// --- Agent rates -----------------------------------------------------------------------

function agentPhotoHtml(a){
  return safeUrl(a.photo_url)
    ? `<img class="ar-photo" src="${escapeHtml(a.photo_url)}" alt="">`
    : `<span class="ar-photo" aria-hidden="true">${escapeHtml(initials(a.agent_name))}</span>`;
}

// One agent rate: rate, gap to the lender, agent, conditions and last update. `actionsHtml` adds buttons;
// `extraHtml` adds a line under the details (the board uses it for the monthly repayment).
function agentRateItemHtml(a, lenderRate, actionsHtml = "", mine = false, extraHtml = ""){
  const below = lenderRate ? lenderRate - a.rate : null;
  const meta = [];
  if (a.conditions) meta.push(escapeHtml(a.conditions));
  meta.push("Updated " + shortDate(a.updated_at.slice(0, 10)));
  return `<li class="ar-item${mine ? " mine" : ""}" data-agent-rate="${a.id}">
      <div class="ar-top">
        ${agentPhotoHtml(a)}
        <div class="ar-main">
          <div class="ar-rates">
            <span class="ar-rate">${fmt(a.rate)}</span>
            <span class="ar-comp">comp. ${fmt(a.comparison_rate)}</span>
            ${below !== null && below > 0.004 ? `<span class="ar-below">${below.toFixed(2)}% below ${escapeHtml(lenderName(a.lender_id))}</span>` : ""}
          </div>
          <div class="ar-who">${escapeHtml(a.agent_name)}${mine ? " (you)" : ""} <span>· ${escapeHtml(a.business)}</span></div>
          <div class="ar-meta">${meta.join(" · ")}</div>
          ${extraHtml}
        </div>
      </div>
      ${actionsHtml}
    </li>`;
}

// The test copy of the site (rate-board-test) is labelled on screen and kept out of search engines.
const IS_TEST_SITE = /\/rate-board-test\//.test(location.pathname);
if (IS_TEST_SITE){
  const robots = document.createElement("meta");
  robots.name = "robots";
  robots.content = "noindex, nofollow";
  document.head.appendChild(robots);
  document.addEventListener("DOMContentLoaded", () => {
    const banner = document.createElement("p");
    banner.className = "test-banner";
    banner.textContent = "Test version: changes here are for review and may not be final. Data is live.";
    document.body.prepend(banner);
  });
}

// Microsoft Clarity (heatmaps and session replays) shows where people get stuck. Empty ID = off. The project's
// masking mode is set to Strict in the Clarity dashboard, and account areas carry data-clarity-mask as well.
const CLARITY_PROJECT_ID = "";
if (CLARITY_PROJECT_ID){
  (function(c, l, a, r, i, t, y){
    c[a] = c[a] || function(){ (c[a].q = c[a].q || []).push(arguments); };
    t = l.createElement(r); t.async = 1; t.src = "https://www.clarity.ms/tag/" + i;
    y = l.getElementsByTagName(r)[0]; y.parentNode.insertBefore(t, y);
  })(window, document, "clarity", "script", CLARITY_PROJECT_ID);
  if (IS_TEST_SITE) window.clarity("set", "site", "test");
}

const AGENT_DISCLAIMER ="Agent rates are set by independent mortgage agents. We don't arrange loans or verify agent rates. Confirm details with the agent.";
