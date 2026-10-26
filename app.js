// Shared by the super-app pages (product hub, compare, my money, calculators): the sign-in dialog,
// number formatting and Inflation Points. Loads after common.js; the account menu itself is in nav.js.

let SESSION = null;

// The project's public anon key, a JWT. Edge functions keep "Verify JWT" on, and this key (or a signed-in
// user's token) satisfies it; like the publishable key it is safe in browser code.
const FUNCTIONS_JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ3amlvZmd3b2xvbnRsZ2x3cm9nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI2MjAzNTYsImV4cCI6MjEwODE5NjM1Nn0.RBMU-fcW-Lm7nQQb6rNXFQypls8lqNAh82ukwtZiVxc";

const pct = (n, dp = 2) => n === null || n === undefined || !Number.isFinite(Number(n)) ? "—" : Number(n).toFixed(dp) + "%";
const money = (n, dp = 0) => n === null || n === undefined || !Number.isFinite(Number(n)) ? "—"
  : "$" + Number(n).toLocaleString("en-AU", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const numberOr = (v, fallback) => { const n = Number(v); return v === "" || v === null || !Number.isFinite(n) ? fallback : n; };

function say(text){
  const live = document.getElementById("srStatus");
  if (live){ live.textContent = ""; setTimeout(() => { live.textContent = text; }, 50); }
}

function showNotice(el, text, kind = ""){
  if (!el) return;
  el.className = "notice" + (kind ? " " + kind : "");
  el.textContent = text;
  el.hidden = !text;
}

// --- Account bar and sign-in ----------------------------------------------------------------------------------

function ensureSigninDialog(){
  if (document.getElementById("signinDialog")) return;
  const dlg = document.createElement("dialog");
  dlg.id = "signinDialog";
  dlg.className = "modal";
  dlg.dataset.clarityMask = "true";
  dlg.setAttribute("aria-labelledby", "signinTitle");
  dlg.innerHTML = `
    <form id="signinForm" novalidate>
      <h2 id="signinTitle">Sign in</h2>
      <p class="modal-sub">One account for every product. New here? <a href="home-loans.html#register">Create a free account</a>.</p>
      <label class="field" for="si-email">Email<input id="si-email" type="email" autocomplete="email" required></label>
      <label class="field" for="si-pw">Password<input id="si-pw" type="password" autocomplete="current-password"></label>
      <p class="form-msg" id="signinMsg" role="alert"></p>
      <div class="dialog-actions">
        <button type="button" class="btn-ghost" id="si-link">Email me a sign-in link</button>
        <button type="button" class="btn-ghost" id="si-cancel">Cancel</button>
        <button type="submit" class="btn-primary">Sign in</button>
      </div>
    </form>`;
  document.body.append(dlg);
  const msg = (t, kind = "error") => { const m = document.getElementById("signinMsg"); m.textContent = t; m.className = "form-msg " + kind; };
  document.getElementById("si-cancel").addEventListener("click", () => dlg.close());
  document.getElementById("signinForm").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = document.getElementById("si-email").value.trim();
    const password = document.getElementById("si-pw").value;
    if (!email || !password){ msg("Enter your email and password, or use a sign-in link."); return; }
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error){ msg(friendlyError(error)); return; }
    dlg.close();
  });
  document.getElementById("si-link").addEventListener("click", async () => {
    const email = document.getElementById("si-email").value.trim();
    if (!email){ msg("Enter your email first."); return; }
    const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href.split("#")[0], shouldCreateUser: false } });
    if (error){ msg(friendlyError(error)); return; }
    msg("Check your email for a sign-in link.", "ok");
  });
}

function openSignin(){
  ensureSigninDialog();
  document.getElementById("signinDialog").showModal();
  document.getElementById("si-email").focus();
}

// Pages define onSession(session) to load their data; it runs once per user change. The first auth event can
// arrive before the page's own script has run, so delivery waits for the document to finish parsing.
let lastSessionUser;
function deliverSession(){
  const uid = SESSION ? SESSION.user.id : null;
  if (uid !== lastSessionUser){
    lastSessionUser = uid;
    if (typeof window.onSession === "function") window.onSession(SESSION);
  }
}
sb.auth.onAuthStateChange((_event, session) => {
  SESSION = session;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => setTimeout(deliverSession, 0), { once: true });
  else setTimeout(deliverSession, 0);
});

// --- Inflation Points ---------------------------------------------------------------------------------------

async function awardPoints(action, ref = null){
  if (!SESSION) return 0;
  const { data, error } = await sb.rpc("award_points", { p_action: action, p_ref: ref });
  if (error) return 0;
  if (data > 0) say(`You earned ${data} Inflation Points.`);
  return data || 0;
}

// Saves a product the customer already has into My money, optionally against one of their assets.
async function saveHolding(h){
  if (!SESSION){ openSignin(); return false; }
  const { error } = await sb.from("holdings").insert(h);
  if (error){ alert(friendlyError(error)); return false; }
  say("Saved to My money.");
  return true;
}

