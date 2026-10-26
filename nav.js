// Site navigation shared by every page, the home loan board included: the brand, a Products menu listing every
// product by section (from catalog.js), My money and Calculators. Loads after catalog.js.

const SITE_LINKS = [
  ["my-money.html", "My money"],
  ["calculators.html", "Calculators"],
];

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
    <button type="button" class="nav-products${current ? " is-current" : ""}" id="productsBtn" aria-expanded="false" aria-controls="productsMenu">Products <span aria-hidden="true">▾</span></button>
    ${SITE_LINKS.map(([href, label]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ""}>${label}</a>`).join("")}
    <div class="products-menu" id="productsMenu" hidden>
      ${sections}
      <p class="all"><a href="index.html"${here === "index.html" ? ' aria-current="page"' : ""}>See all products on one page</a></p>
    </div>`;

  const btn = document.getElementById("productsBtn");
  const menu = document.getElementById("productsMenu");
  const setOpen = (open, returnFocus) => {
    menu.hidden = !open;
    btn.setAttribute("aria-expanded", String(open));
    if (!open && returnFocus) btn.focus();
  };
  btn.addEventListener("click", () => {
    const open = menu.hidden;
    setOpen(open);
    if (open) menu.querySelector("a")?.focus();
  });
  menu.addEventListener("keydown", (e) => { if (e.key === "Escape") setOpen(false, true); });
  btn.addEventListener("keydown", (e) => { if (e.key === "Escape" && !menu.hidden) setOpen(false); });
  document.addEventListener("click", (e) => { if (!menu.hidden && !nav.contains(e.target)) setOpen(false); });
  nav.addEventListener("focusout", (e) => { if (!menu.hidden && e.relatedTarget && !nav.contains(e.relatedTarget)) setOpen(false); });
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", renderSiteNav);
else renderSiteNav();
