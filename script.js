// =========================================================
// Kantaro Murayama — homepage scripts
// Speed strategy:
//   - sessionStorage cache for ORCID + Crossref + peer reviews
//   - Crossref batch query (1 HTTP request for all DOIs)
//   - Progressive rendering: ORCID data first, then enriched
// =========================================================

const ORCID_ID  = "0000-0003-0993-0215";
const ORCID_URL = `https://orcid.org/${ORCID_ID}`;

const ORCID_API      = `https://pub.orcid.org/v3.0/${ORCID_ID}/works`;
const ORCID_PEER_API = `https://pub.orcid.org/v3.0/${ORCID_ID}/peer-reviews`;
const CROSSREF_BATCH = "https://api.crossref.org/works";
const OPENALEX_BATCH = "https://api.openalex.org/works";

const FAMILY_NAME  = "murayama";
const CACHE_PREFIX = "km-v5-";
const CACHE_TTL    = 1000 * 60 * 60 * 24; // 24 hours

// Manual override map: DOI → { role: "corresponding" | "first" | "first-corr" }
const PAPER_OVERRIDES = {};

// Angewandte Chemie publishes each paper in two editions with the same
// title: the German edition (DOI 10.1002/ange.*) and the International
// Edition (DOI 10.1002/anie.*). When ORCID lists both, keep only this one.
const ANGEWANDTE_KEEP = "ange";   // "ange" or "anie"

// Table-of-contents (TOC) graphics.
// Put image files in the top level of the repository (next to
// index.html), named after the DOI in lowercase with "/" replaced
// by "_". PNG or JPG both work, e.g.
//   10.1021_jacs.5c09574.png
// Papers without a matching file simply show no graphic.
const TOC_DIR = "";

// ============================================================
//  MANUAL NEWS
//  Non-paper announcements (moves, awards, talks, ...).
//  Papers arrive automatically from ORCID; add anything else
//  here. Entries are merged with papers and sorted by date.
//    date: [year, month, day]  (month/day optional)
//    chip: short label shown next to the date
//    html: the sentence itself (inline HTML allowed)
// ============================================================
function manualNewsItems() {
  const sunGroup =
    '<a href="https://whsunresearch.group/" target="_blank" rel="noopener">Sun Research Group</a>';

  return [
    {
      date: [2026, 10, 1],
      chip: "New position",
      html: `Started as a Postdoctoral Research Fellow in the ${sunGroup}, Department of Materials Science and Engineering, University of Michigan.`,
    },

    // Add further announcements here, e.g.
    // { date: [2026, 12, 5], chip: "Talk", html: "Invited talk at ..." },
  ];
}

// ---------- Cache helpers ----------
function cacheGet(key) {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const o = JSON.parse(raw);
    if (o.expires && Date.now() > o.expires) return null;
    return o.data;
  } catch (_) { return null; }
}
function cacheSet(key, data) {
  try {
    sessionStorage.setItem(
      CACHE_PREFIX + key,
      JSON.stringify({ data, expires: Date.now() + CACHE_TTL })
    );
  } catch (_) {}
}

// ---------- DOM utils ----------
function escapeHtml(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (m) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;",
    '"': "&quot;", "'": "&#39;",
  }[m]));
}
function safeTitle(html) {
  return String(html || "").replace(
    /<\/?(script|style|iframe|object|embed|form|input|link|meta)[^>]*>/gi, ""
  );
}

// Footer year + nav
(function setYear() {
  const el = document.getElementById("year");
  if (el) el.textContent = new Date().getFullYear();
})();
(function setupNavToggle() {
  const t = document.querySelector(".nav-toggle");
  const n = document.querySelector(".site-nav");
  if (t && n) t.addEventListener("click", () => n.classList.toggle("open"));
})();

// ---------- ORCID works (1 request, cached) ----------
async function fetchOrcidWorks() {
  const cached = cacheGet("orcid-works");
  if (cached) return cached;

  const res = await fetch(ORCID_API, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error("ORCID fetch failed: " + res.status);
  const data = await res.json();

  const works = (data.group || [])
    .map((g) => {
      const summaries = g["work-summary"] || [];
      const w = summaries.find((s) => hasDoi(s)) || summaries[0];
      if (!w) return null;
      const ids = (w["external-ids"] && w["external-ids"]["external-id"]) || [];
      const doiObj = ids.find((x) => x["external-id-type"] === "doi");
      const doi = doiObj ? doiObj["external-id-value"] : null;
      const url = doi ? "https://doi.org/" + doi : ((w.url && w.url.value) || null);
      const yearStr = (w["publication-date"] && w["publication-date"].year && w["publication-date"].year.value) || "";
      return {
        title:   (w.title && w.title.title && w.title.title.value) || "",
        journal: (w["journal-title"] && w["journal-title"].value) || "",
        year:    yearStr ? parseInt(yearStr, 10) : null,
        type:    w.type || "OTHER",
        url, doi,
      };
    })
    .filter((w) => w && w.title)
    .sort((a, b) => (b.year || 0) - (a.year || 0));

  cacheSet("orcid-works", works);
  return works;
}
function hasDoi(s) {
  const ids = (s["external-ids"] && s["external-ids"]["external-id"]) || [];
  return ids.some((x) => x["external-id-type"] === "doi");
}

// ---------- Crossref BATCH query (1 request for all DOIs) ----------
async function fetchCrossrefBatch(dois) {
  // Determine which we still need
  const map = {};
  const needed = [];
  for (const d of dois) {
    const c = cacheGet("xref-" + d.toLowerCase());
    if (c) map[d.toLowerCase()] = c;
    else needed.push(d);
  }
  if (!needed.length) return map;

  // Single request: filter=doi:X,doi:Y,...
  const filter = needed.map((d) => "doi:" + d).join(",");
  const url = `${CROSSREF_BATCH}?filter=${encodeURIComponent(filter)}&rows=${needed.length}&select=DOI,title,author,container-title,short-container-title,published,published-print,published-online,type,URL`;

  try {
    const res = await fetch(url);
    if (!res.ok) return map;
    const json = await res.json();
    const items = (json.message && json.message.items) || [];
    items.forEach((item) => {
      const k = (item.DOI || "").toLowerCase();
      if (!k) return;
      // Slim it down before caching
      const slim = {
        DOI: item.DOI,
        title: item.title,
        author: item.author,
        containerTitle: item["container-title"],
        shortContainerTitle: item["short-container-title"],
        published: item.published || item["published-print"] || item["published-online"],
        type: item.type,
        URL: item.URL,
      };
      map[k] = slim;
      cacheSet("xref-" + k, slim);
    });
  } catch (_) {}
  return map;
}

// ---------- OpenAlex BATCH query (adds is_corresponding + day-level dates) ----------
async function fetchOpenAlexBatch(dois) {
  const map = {};
  const needed = [];
  for (const d of dois) {
    const c = cacheGet("oa-" + d.toLowerCase());
    if (c) map[d.toLowerCase()] = c;
    else needed.push(d);
  }
  if (!needed.length) return map;

  const filter = "doi:" + needed.join("|doi:");
  const url = `${OPENALEX_BATCH}?filter=${encodeURIComponent(filter)}&per-page=${needed.length}&select=doi,authorships,publication_date`;

  try {
    const res = await fetch(url);
    if (!res.ok) return map;
    const json = await res.json();
    const items = json.results || [];
    items.forEach((item) => {
      const k = (item.doi || "").replace(/^https?:\/\/doi\.org\//i, "").toLowerCase();
      if (!k) return;
      const slim = {
        authorships: item.authorships || [],
        publication_date: item.publication_date || null,
      };
      map[k] = slim;
      cacheSet("oa-" + k, slim);
    });
  } catch (_) {}
  return map;
}

// Match a Crossref author against an OpenAlex authorship entry
function matchOpenAlexAuthor(crAuthor, oaAuthorships) {
  if (!oaAuthorships || !oaAuthorships.length) return null;
  // 1) ORCID match (most reliable)
  const crOrcid = (crAuthor.ORCID || "").replace(/^https?:\/\/(orcid\.org\/)?/i, "");
  if (crOrcid) {
    const m = oaAuthorships.find((a) =>
      a.author && a.author.orcid && a.author.orcid.toLowerCase().includes(crOrcid.toLowerCase())
    );
    if (m) return m;
  }
  // 2) Family-name + first-initial match
  const family = (crAuthor.family || "").toLowerCase();
  const ginit  = (crAuthor.given || "")[0] ? crAuthor.given[0].toLowerCase() : "";
  return oaAuthorships.find((a) => {
    const oaName = ((a.author && a.author.display_name) || a.raw_author_name || "").toLowerCase();
    if (!family || !oaName.includes(family)) return false;
    return !ginit || oaName.includes(ginit);
  }) || null;
}

// ---------- Date helpers ----------
const MONTHS_SHORT = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
function ordinal(n) {
  const s = ["th", "st", "nd", "rd"], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function formatLongDate(y, m, d) {
  if (!y) return "n.d.";
  if (!m) return String(y);
  const month = MONTHS_SHORT[m - 1] || "";
  if (!d) return `${month} ${y}`;
  return `${month} ${ordinal(d)}, ${y}`;
}
function getPublishedDate(cr, oa) {
  if (oa && oa.publication_date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(oa.publication_date);
    if (m) return { year: +m[1], month: +m[2], day: +m[3] };
  }
  if (cr) {
    const dp =
      (cr["published-online"] && cr["published-online"]["date-parts"] && cr["published-online"]["date-parts"][0]) ||
      (cr.published && cr.published["date-parts"] && cr.published["date-parts"][0]) ||
      (cr["published-print"] && cr["published-print"]["date-parts"] && cr["published-print"]["date-parts"][0]);
    if (dp) return { year: dp[0] || null, month: dp[1] || null, day: dp[2] || null };
  }
  return { year: null, month: null, day: null };
}

// ---------- Authorship + categories ----------
function isUserAuthor(a) {
  if (!a) return false;
  if (a.ORCID && a.ORCID.includes(ORCID_ID)) return true;
  return (a.family || "").toLowerCase().includes(FAMILY_NAME) &&
         (a.given || "").toLowerCase().startsWith("k");
}
function isFirstAuthor(authors) {
  return Array.isArray(authors) && authors.length > 0 && isUserAuthor(authors[0]);
}
function initials(given) {
  return (given || "")
    .split(/\s+/).filter(Boolean)
    .map((part) => part.split("-").map((b) => b ? b[0].toUpperCase() + "." : "").join("-"))
    .join(" ");
}
function formatAuthors(authors) {
  if (!authors || !authors.length) return "";
  return authors.map((a) => {
    const name = (initials(a.given) + " " + (a.family || a.name || "")).trim();
    const safe = escapeHtml(name);
    const star = a.is_corresponding ? "*" : "";
    return isUserAuthor(a) ? `<strong>${safe}</strong>${star}` : `${safe}${star}`;
  }).join(", ");
}
function categorize(type) {
  if (!type) return "others";
  const t = String(type).toLowerCase();
  if (t === "posted-content" || t === "preprint") return "preprints";
  if (t === "journal-article" || t === "journal_article" ||
      t === "book-chapter" || t === "proceedings-article" ||
      t === "review-article") return "publications";
  return "others";
}
function categoryLabel(c) {
  return c === "publications" ? "Publication"
       : c === "preprints"    ? "Preprint"
       : "Other";
}
function roleLabel(r) {
  return r === "first"         ? "First author"
       : r === "corresponding" ? "Corresponding author"
       : r === "first-corr"    ? "First & corresponding"
       : "Co-author";
}
function roleClass(r) {
  return r === "first"         ? "role-first"
       : r === "corresponding" ? "role-corr"
       : r === "first-corr"    ? "role-first"
       : "role-coauthor";
}

// ---------- Build a paper view-model from ORCID + Crossref + OpenAlex ----------
function buildView(w, cr, oa) {
  const title = (cr && cr.title && cr.title[0]) || w.title || "";
  const journal =
    (cr && cr.containerTitle && cr.containerTitle[0]) ||
    (cr && cr.shortContainerTitle && cr.shortContainerTitle[0]) ||
    w.journal || "";
  const date = getPublishedDate(cr, oa);
  const year = date.year || w.year || null;
  const type = (cr && cr.type) || w.type || "";

  // Crossref authors enriched with `is_corresponding` from OpenAlex
  const crAuthors = (cr && cr.author) || [];
  const oaAuthorships = oa && oa.authorships;
  const authors = crAuthors.map((a) => {
    const m = matchOpenAlexAuthor(a, oaAuthorships);
    return Object.assign({}, a, {
      is_corresponding: m ? !!m.is_corresponding : false,
    });
  });
  const userIsCorresponding = authors.some((a) => isUserAuthor(a) && a.is_corresponding);

  const ovr = w.doi && PAPER_OVERRIDES[w.doi];
  let role;
  if (ovr && ovr.role) role = ovr.role;
  else if (cr && isFirstAuthor(authors)) role = userIsCorresponding ? "first-corr" : "first";
  else if (cr && userIsCorresponding) role = "corresponding";
  else if (cr) role = "coauthor";
  else role = null;

  return {
    title: safeTitle(title),
    journal,
    year,
    date,
    url: w.url || (cr && cr.URL) || null,
    doi: w.doi,
    authorString: formatAuthors(authors),
    category: categorize(type),
    role,
    enriched: !!cr,
  };
}

// ---------- Angewandte duplicates (German vs. International Edition) ----------
function normTitle(t) {
  return String(t || "").replace(/<[^>]+>/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}
function dedupeAngewandte(works) {
  const keep = ANGEWANDTE_KEEP === "anie" ? "anie" : "ange";
  const drop = keep === "ange" ? "anie" : "ange";
  const keepRe = new RegExp("/" + keep + "\\.", "i");
  const dropRe = new RegExp("/" + drop + "\\.", "i");

  const byTitle = {};
  works.forEach((w) => {
    const k = normTitle(w.title);
    (byTitle[k] = byTitle[k] || []).push(w);
  });
  const removed = new Set();
  Object.values(byTitle).forEach((group) => {
    if (group.length < 2) return;
    if (!group.some((w) => keepRe.test(w.doi || ""))) return;
    group.forEach((w) => { if (dropRe.test(w.doi || "")) removed.add(w); });
  });
  return works.filter((w) => !removed.has(w));
}

// ---------- TOC graphics ----------
function tocSlug(doi) {
  return String(doi).toLowerCase().replace(/\//g, "_");
}
// Called by <img onerror>: try .jpg after .png, then remove the slot.
function tocFallback(img) {
  if (!img.dataset.triedJpg) {
    img.dataset.triedJpg = "1";
    img.src = img.src.replace(/\.png$/i, ".jpg");
  } else {
    const box = img.closest(".pub-toc");
    if (box) box.remove();
  }
}

// ---------- Render: pub card ----------
function renderPubCard(v, withToc) {
  const role = v.role
    ? `<span class="pub-role ${roleClass(v.role)}">${roleLabel(v.role)}</span>`
    : "";
  const link = v.url
    ? `<a class="pub-link" href="${v.url}" target="_blank" rel="noopener">DOI ↗</a>`
    : "";
  const journal = v.journal ? `<em class="pub-journal">${escapeHtml(v.journal)}</em>` : "";
  const yr = v.year ? `<span class="pub-year">${v.year}</span>` : "";
  const sep = (journal && yr) ? ", " : "";
  const toc = (withToc && v.doi)
    ? `<a class="pub-toc" href="${v.url || "#"}" target="_blank" rel="noopener">
         <img src="${TOC_DIR}${tocSlug(v.doi)}.png" alt="Table of contents graphic" loading="lazy" onerror="tocFallback(this)">
       </a>`
    : "";
  return `
    <article class="pub" data-type="${v.category}">
      <div class="pub-body">
        <div class="pub-head">
          <span class="pub-badge ${v.category}">${categoryLabel(v.category)}</span>
          ${role}
        </div>
        <h3 class="pub-title">${v.title}</h3>
        ${v.authorString ? `<p class="pub-authors">${v.authorString}</p>` : ""}
        <p class="pub-venue">
          ${journal}${sep}${yr}${link ? " " + link : ""}
        </p>
      </div>
      ${toc}
    </article>
  `;
}

// ---------- Renderers ----------
function renderPubsInto(views, container, withToc) {
  if (!container) return;
  const byYear = {};
  views.forEach((v) => {
    const y = v.year || "Other";
    (byYear[y] = byYear[y] || []).push(v);
  });
  const years = Object.keys(byYear).sort((a, b) => {
    if (a === "Other") return 1;
    if (b === "Other") return -1;
    return Number(b) - Number(a);
  });
  container.innerHTML = years
    .map((year) => {
      const items = byYear[year].map((v) => renderPubCard(v, withToc)).join("");
      return `<h3 class="year-heading">${escapeHtml(year)}</h3>${items}`;
    })
    .join("");
}

function renderFeaturedInto(views, featured, withToc) {
  if (!featured) return;
  // Selected: top 3 first-author papers (need Crossref first; if no roles yet,
  // fall back to first 3 most recent).
  const haveRoles = views.some((v) => v.role !== null);
  const list = haveRoles
    ? views.filter((v) => v.role === "first" || v.role === "first-corr").slice(0, 3)
    : views.slice(0, 3);
  featured.innerHTML = list.length
    ? list.map((v) => renderPubCard(v, withToc)).join("")
    : `<p class="muted">No highlighted papers yet.</p>`;
}

function sortKeyOf(y, m, d) {
  return (y || 0) * 10000 + (m || 0) * 100 + (d || 0);
}

// Convert an enriched paper into a news entry
function paperToNewsItem(v) {
  const d = v.date || {};
  const year  = d.year  || v.year || null;
  const month = d.month || null;
  const day   = d.day   || null;
  const titleHTML = v.url
    ? `<a href="${v.url}" target="_blank" rel="noopener">${v.title}</a>`
    : v.title;
  const venue = v.journal ? ` in <em>${escapeHtml(v.journal)}</em>` : "";
  return {
    sortKey: sortKeyOf(year, month, day),
    dateStr: year ? formatLongDate(year, month, day) : "n.d.",
    chipHtml: v.role
      ? `<span class="news-role ${roleClass(v.role)}">${roleLabel(v.role)}</span>`
      : "",
    bodyHtml: `New paper${venue}: ${titleHTML}.`,
  };
}

// Convert a MANUAL_NEWS entry into a news entry
function manualToNewsItem(n) {
  const [y, m, d] = n.date || [];
  return {
    sortKey: sortKeyOf(y, m, d),
    dateStr: y ? formatLongDate(y, m, d) : "n.d.",
    chipHtml: n.chip
      ? `<span class="news-role role-note">${escapeHtml(n.chip)}</span>`
      : "",
    bodyHtml: n.html || "",
  };
}

function renderNewsInto(views, list) {
  if (!list) return;

  const items = views.map(paperToNewsItem)
    .concat(manualNewsItems().map(manualToNewsItem))
    .sort((a, b) => b.sortKey - a.sortKey);

  if (!items.length) {
    list.innerHTML = `<li class="muted">No recent updates.</li>`;
    return;
  }

  list.innerHTML = items.map((it) => `<li>
      <div class="news-meta">
        <span class="news-date">${it.dateStr}</span>
        ${it.chipHtml}
      </div>
      <div class="news-text">${it.bodyHtml}</div>
    </li>`).join("");
}

// ---------- Master flow: progressive render ----------
async function loadAndRender() {
  const featured = document.getElementById("featured-pubs");
  const pubs     = document.getElementById("pubs");
  const news     = document.getElementById("news-list");

  let orcid;
  try {
    orcid = await fetchOrcidWorks();
  } catch (e) {
    console.error(e);
    if (pubs)     pubs.innerHTML     = errMsg();
    if (featured) featured.innerHTML = errMsg();
    // Manual announcements still render even if ORCID is unreachable
    if (news)     renderNewsInto([], news);
    return;
  }

  // Drop the duplicate Angewandte edition (same title, ange vs. anie)
  orcid = dedupeAngewandte(orcid);

  // Pass 1: ORCID-only views (renders almost instantly, no TOC yet)
  const initialViews = orcid.map((w) => buildView(w, null, null));
  renderPubsInto(initialViews, pubs, false);
  renderFeaturedInto(initialViews, featured, false);
  renderNewsInto(initialViews, news);
  setupPublicationFilter();

  // Pass 2: enrich via Crossref + OpenAlex batches (in parallel)
  const dois = orcid.filter((w) => w.doi).map((w) => w.doi);
  if (!dois.length) return;

  const [crossrefMap, openalexMap] = await Promise.all([
    fetchCrossrefBatch(dois),
    fetchOpenAlexBatch(dois),
  ]);

  const enrichedViews = orcid.map((w) => {
    const k = w.doi ? w.doi.toLowerCase() : null;
    return buildView(w, k ? crossrefMap[k] : null, k ? openalexMap[k] : null);
  });
  renderPubsInto(enrichedViews, pubs, true);
  renderFeaturedInto(enrichedViews, featured, true);
  renderNewsInto(enrichedViews, news);
  setupPublicationFilter();
}

function errMsg() {
  return `<p class="muted">Could not load publications. View on
    <a href="${ORCID_URL}" target="_blank" rel="noopener">ORCID ↗</a>.</p>`;
}
function errMsgPlain() {
  return `Could not load. View on <a href="${ORCID_URL}" target="_blank" rel="noopener">ORCID ↗</a>.`;
}

// ---------- Filter chips ----------
function setupPublicationFilter() {
  const chips = document.querySelectorAll(".chip[data-filter]");
  const items = document.querySelectorAll("#pubs .pub[data-type]");
  if (!chips.length || !items.length) return;
  chips.forEach((chip) => {
    chip.onclick = () => {
      chips.forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      const f = chip.getAttribute("data-filter");
      items.forEach((p) => {
        const t = p.getAttribute("data-type");
        p.style.display = f === "all" || t === f ? "" : "none";
      });
      document.querySelectorAll("#pubs .year-heading").forEach((h) => {
        let sib = h.nextElementSibling;
        let any = false;
        while (sib && !sib.classList.contains("year-heading")) {
          if (sib.classList.contains("pub") && sib.style.display !== "none") {
            any = true;
            break;
          }
          sib = sib.nextElementSibling;
        }
        h.style.display = any ? "" : "none";
      });
    };
  });
}

// ---------- Service: peer review (cached) ----------
async function renderService() {
  const list = document.getElementById("service-list");
  if (!list) return;

  // Try cache first for instant paint
  const cached = cacheGet("orcid-peer-enriched");
  if (cached) renderServiceList(cached, list);

  try {
    const res = await fetch(ORCID_PEER_API, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error("Peer fetch failed: " + res.status);
    const data = await res.json();
    let venues = parsePeerReviews(data);
    venues = await enrichVenuesWithJournals(venues);
    cacheSet("orcid-peer-enriched", venues);
    renderServiceList(venues, list);
  } catch (err) {
    console.error(err);
    if (!cached) {
      list.innerHTML = `<li class="muted">
        Could not load peer-review data. View on
        <a href="${ORCID_URL}" target="_blank" rel="noopener">ORCID ↗</a>.
      </li>`;
    }
  }
}

function extractIssn(s) {
  if (!s) return null;
  // Match issn:0020-1669 / ISSN:1520-510X / 0020-1669, etc.
  let m = /issn:\s*([\dxX]{4}-?[\dxX]{3}[\dxX])/i.exec(String(s));
  if (m) return m[1].toUpperCase().replace(/^(\w{4})(\w{4})$/, "$1-$2");
  m = /\b([\d]{4}-[\dxX]{3}[\dxX])\b/i.exec(String(s));
  return m ? m[1].toUpperCase() : null;
}

function parsePeerReviews(data) {
  const venues = [];
  (data.group || []).forEach((g) => {
    // ISSN typically lives in the top-level group external-ids
    // as "issn:XXXX-XXXX/<reviewer>" or just "issn:XXXX-XXXX"
    let groupIssn = null;
    const topIds = (g["external-ids"] && g["external-ids"]["external-id"]) || [];
    topIds.forEach((id) => {
      const issn = extractIssn(id["external-id-value"]);
      if (issn) groupIssn = issn;
    });

    const subgroups = g["peer-review-group"] || [];
    subgroups.forEach((sg) => {
      const summaries = sg["peer-review-summary"] || [];
      if (!summaries.length) return;
      const first = summaries[0];

      // Also try review-group-id at the summary level as a fallback
      const summaryIssn = extractIssn(first["review-group-id"]);
      const issn = summaryIssn || groupIssn;

      const journalFromOrcid =
        (first["subject-container-name"] && first["subject-container-name"].value) || null;
      const publisher =
        (first["convening-organization"] && first["convening-organization"].name) || null;
      const years = summaries
        .map((s) => parseInt((s["completion-date"] && s["completion-date"].year && s["completion-date"].year.value) || "0", 10))
        .filter((y) => y > 0);

      venues.push({
        issn,
        journal: journalFromOrcid || null,
        publisher,
        count: summaries.length,
        latestYear: years.length ? Math.max(...years) : null,
      });
    });
  });
  venues.sort((a, b) => (b.latestYear || 0) - (a.latestYear || 0) || b.count - a.count);
  return venues;
}

// Look up journal title from ISSN via Crossref
async function fetchJournalByIssn(issn) {
  if (!issn) return null;
  const key = "journal-" + issn;
  const cached = cacheGet(key);
  if (cached !== null) return cached || null;
  try {
    const res = await fetch(`https://api.crossref.org/journals/${encodeURIComponent(issn)}`);
    if (!res.ok) {
      cacheSet(key, "");
      return null;
    }
    const json = await res.json();
    const title = (json.message && json.message.title) || null;
    cacheSet(key, title || "");
    return title;
  } catch (_) {
    return null;
  }
}

async function enrichVenuesWithJournals(venues) {
  const needed = new Set();
  venues.forEach((v) => {
    if (v.issn && !v.journal) needed.add(v.issn);
  });
  const issns = Array.from(needed);
  if (!issns.length) return venues;

  const lookups = {};
  await Promise.all(issns.map(async (issn) => {
    lookups[issn] = await fetchJournalByIssn(issn);
  }));

  venues.forEach((v) => {
    if (v.issn && !v.journal && lookups[v.issn]) {
      v.journal = lookups[v.issn];
    }
  });
  return venues;
}

function renderServiceList(venues, list) {
  if (!venues || !venues.length) {
    list.innerHTML = `<li class="muted">No peer-review record on ORCID yet.</li>`;
    return;
  }
  list.innerHTML = venues.map((v) => {
    const hasJournal = !!v.journal;
    const main = hasJournal
      ? `<em>${escapeHtml(v.journal)}</em>` +
        (v.publisher && v.publisher.toLowerCase() !== v.journal.toLowerCase()
          ? ` (${escapeHtml(v.publisher)})` : "")
      : `<em>${escapeHtml(v.publisher || "Unknown venue")}</em>`;
    const countLabel = v.count > 1 ? `, ${v.count} reviews` : "";
    const yearLabel  = v.latestYear ? `, most recent ${v.latestYear}` : "";
    return `<li><strong>Reviewer</strong> for ${main}${countLabel}${yearLabel}.</li>`;
  }).join("");
}

// ---------- Boot ----------
document.addEventListener("DOMContentLoaded", () => {
  loadAndRender();
  renderService();
});
