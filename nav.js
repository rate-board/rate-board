// Site navigation shared by every page, the home loan board included: the brand, a Products menu listing every
// product by section (from catalog.js), Calculators, and a My account menu (My money, Inflation Points, account
// details, sign in and out). Loads after common.js and catalog.js.

const SITE_LINKS = [
  ["calculators.html", "Calculators"],
];

let navSession = null;
let navIsAgent = false;

function renderSiteNav(){
  const nav = document.getElementById("siteNav");
  if (!nav || nav.dataset.ready) return;
  nav.dataset.ready = "1";
  const here = location.pathname.split("/").pop() || "index.html";
  const current = here === "home-loans.html" ? "home_loans"
    : here === "compare.html" ? new URLSearchParams(location.search).get("c") : null;

  const sections = SECTIONS.map(s => `
    <section aria-labelledby="nav-${s.key}">
      <h2 id="nav-${s.key}">${escapeHtml(s.title)}</h2>
      <ul>${s.items.map(k => {
        const href = CATEGORIES[k].href || `compare.html?c=${k}`;
        return `<li><a href="${href}"${k === current ? ' aria-current="page"' : ""}>${escapeHtml(CATEGORIES[k].title)}</a></li>`;
      }).join("")}</ul>
    </section>`).join("");

  nav.innerHTML = `<a class="brand" href="index.html">BeatInflation</a>
    <button type="button" class="nav-menu-btn${current ? " is-current" : ""}" id="productsBtn" aria-expanded="false" aria-controls="productsMenu">Products <span aria-hidden="true">▾</span></button>
    ${SITE_LINKS.map(([href, label]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
    <button type="button" class="nav-menu-btn${here === "my-money.html" ? " is-current" : ""}" id="accountBtn" aria-expanded="false" aria-controls="accountPanel">My account <span aria-hidden="true">▾</span></button>
    <div class="products-menu" id="productsMenu" hidden>
      ${sections}
      <p class="all"><a href="index.html"${here === "index.html" ? ' aria-current="page"' : ""}>See all products on one page</a></p>
    </div>
    <div class="nav-account" id="accountPanel" data-clarity-mask="true" hidden></div>`;

  // Two disclosure menus; opening one closes the other.
  const menus = [["productsBtn", "productsMenu"], ["accountBtn", "accountPanel"]]
    .map(([b, p]) => ({ btn: document.getElementById(b), panel: document.getElementById(p) }));
  const setOpen = (m, open, returnFocus) => {
    m.panel.hidden = !open;
    m.btn.setAttribute("aria-expanded", String(open));
    if (!open && returnFocus) m.btn.focus();
  };
  for (const m of menus){
    m.btn.addEventListener("click", () => {
      const open = m.panel.hidden;
      for (const other of menus) if (other !== m) setOpen(other, false);
      setOpen(m, open);
      if (open) m.panel.querySelector("a, button")?.focus();
    });
    m.panel.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(m, false, true); });
    m.btn.addEventListener("keydown", (e) => { if (e.key === "Escape" && !m.panel.hidden) setOpen(m, false); });
  }
  const closeAll = () => { for (const m of menus) setOpen(m, false); };
  document.addEventListener("click", (e) => { if (!nav.contains(e.target)) closeAll(); });
  nav.addEventListener("focusout", (e) => { if (e.relatedTarget && !nav.contains(e.relatedTarget)) closeAll(); });

  // Account actions use the page's own dialogs: the board has openAuth and openProfile, other pages openSignin.
  document.getElementById("accountPanel").addEventListener("click", async (e) => {
    const act = e.target.closest("button[data-act]")?.dataset.act;
    if (!act) return;
    closeAll();
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
  renderAccountPanel();
}

function renderAccountPanel(){
  const panel = document.getElementById("accountPanel");
  if (!panel) return;
  const here = location.pathname.split("/").pop() || "index.html";
  const link = (href, label) => `<a href="${href}"${href === here ? ' aria-current="page"' : ""}>${label}</a>`;
  const act = (name, label) => `<button type="button" data-act="${name}">${label}</button>`;
  panel.innerHTML = navSession
    ? `<p class="nav-who">Signed in as <strong>${escapeHtml(navSession.user.email)}</strong></p>
       ${link("my-money.html", "My money")}
       ${link("my-money.html#ptsHeading", "Inflation Points")}
       ${act("profile", "Account details")}
       ${navIsAgent ? link("agent.html", "Agent portal") : ""}
       ${act("signout", "Sign out")}`
    : `${act("signin", "Sign in")}
       ${act("register", "Create account")}
       ${link("my-money.html", "My money")}`;
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
    renderAccountPanel();
  }, 0);
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderSiteNav);
else renderSiteNav();
