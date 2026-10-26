// Site navigation shared by every page, the home loan board included: the brand and one Menu button. The menu
// holds every product by section (from catalog.js), the calculators, and My account (My money, Inflation Points,
// account details, sign in and out). Loads after common.js and catalog.js.

let navSession = null;
let navIsAgent = false;

function navHere(){ return location.pathname.split("/").pop() || "index.html"; }

function renderSiteNav(){
  const nav = document.getElementById("siteNav");
  if (!nav || nav.dataset.ready) return;
  nav.dataset.ready = "1";
  const here = navHere();
  const current = here === "home-loans.html" ? "home_loans"
    : here === "compare.html" ? new URLSearchParams(location.search).get("c") : null;
  const mark = (on) => on ? ' aria-current="page"' : "";

  const products = SECTIONS.map(s => `
    <section aria-labelledby="nav-${s.key}">
      <h2 id="nav-${s.key}">${escapeHtml(s.title)}</h2>
      <ul>${s.items.map(k => {
        const href = CATEGORIES[k].href || `compare.html?c=${k}`;
        return `<li><a href="${href}"${mark(k === current)}>${escapeHtml(CATEGORIES[k].title)}</a></li>`;
      }).join("")}</ul>
    </section>`).join("");

  nav.innerHTML = `<a class="brand" href="index.html">BeatInflation</a>
    <button type="button" class="nav-menu-btn" id="siteMenuBtn" aria-expanded="false" aria-controls="siteMenu">Menu <span aria-hidden="true">▾</span></button>
    <div class="products-menu" id="siteMenu" hidden>
      <section class="nav-account" id="navAccount" aria-labelledby="nav-account" data-clarity-mask="true"></section>
      ${products}
      <section aria-labelledby="nav-tools">
        <h2 id="nav-tools">Tools</h2>
        <ul><li><a href="calculators.html"${mark(here === "calculators.html")}>Calculators</a></li></ul>
      </section>
      <p class="all"><a href="index.html"${mark(here === "index.html")}>See all products on one page</a></p>
    </div>`;

  const btn = document.getElementById("siteMenuBtn");
  const menu = document.getElementById("siteMenu");
  const setOpen = (open, returnFocus) => {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (!open && returnFocus) btn.focus();
  };
  btn.addEventListener("click", () => {
    const open = menu.hidden;
    setOpen(open);
    if (open) menu.querySelector("a, button")?.focus();
  });
  menu.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false, true); });
  btn.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) setOpen(false); });
  document.addEventListener("click", (e) => { if (!menu.hidden && !nav.contains(e.target)) setOpen(false); });
  nav.addEventListener("focusout", (e) => { if (!menu.hidden && e.relatedTarget && !nav.contains(e.relatedTarget)) setOpen(false); });

  // Account actions use the page's own dialogs: the board has openAuth and openProfile, other pages openSignin.
  menu.addEventListener("click", async (e) => {
    const act = e.target.closest("button[data-act]")?.dataset.act;
    if (!act) return;
    setOpen(false);
    if (act === "signin"){
      if (typeof openAuth === "function") openAuth("signin");
      else if (typeof openSignin === "function") openSignin();
      else location.href = "home-loans.html#signin";
    } else if (act === "register"){
      if (typeof openAuth === "function") openAuth("register");
      else location.href = "home-loans.html#register";
    } else if (act === "profile"){
      if (typeof openProfile === "function") openProfile();
      else location.href = "home-loans.html#profile";
    } else if (act === "signout"){
      await sb.auth.signOut();
    }
  });
  renderAccountSection();
}

function renderAccountSection(){
  const box = document.getElementById("navAccount");
  if (!box) return;
  const here = navHere();
  const link = (href, label) => `<li><a href="${href}"${href === here ? ' aria-current="page"' : ""}>${label}</a></li>`;
  const act = (name, label) => `<li><button type="button" data-act="${name}">${label}</button></li>`;
  box.innerHTML = `<h2 id="nav-account">My account</h2>` + (navSession
    ? `<p class="nav-who">${escapeHtml(navSession.user.email)}</p>
       <ul>${link("my-money.html", "My money")}${link("my-money.html#ptsHeading", "Inflation Points")}${act("profile", "Account details")}${navIsAgent ? link("agent.html", "Agent portal") : ""}${act("signout", "Sign out")}</ul>`
    : `<ul>${act("signin", "Sign in")}${act("register", "Create account")}${link("my-money.html", "My money")}</ul>`);
}

let navUserId;
sb.auth.onAuthStateChange((_event, session) => {
  navSession = session;
  const uid = session ? session.user.id : null;
  // Supabase advises against awaiting client calls inside this callback, hence setTimeout.
  setTimeout(async () => {
    if (uid !== navUserId){
      navUserId = uid;
      navIsAgent = false;
      if (uid){
        const { data } = await sb.from("agents").select("id").eq("id", uid).maybeSingle();
        navIsAgent = !!data;
      }
    }
    renderAccountSection();
  }, 0);
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderSiteNav);
else renderSiteNav();
