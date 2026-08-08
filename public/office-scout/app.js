const FEED_URL = "./data/listings.json";
const REFRESH_INTERVAL = 60 * 60 * 1000;
// The feed is republished by an irregular curated-search run, not a cron, so a
// threshold near REFRESH_INTERVAL would cry wolf on every normal visit. A feed
// that has not moved in a day is either a paused search or the failure this
// guards: the build-time snapshot being served because the edge rewrite of
// /data/listings.json is missing (docs/DEPLOYMENT-VPS.md).
const STALE_AFTER = 24 * 60 * 60 * 1000;
const BUDGET = 850;
const STORAGE_KEY = "fluxology.officeScout.workspace.v2.5";
const WORKFLOW_STATES = ["unreviewed","saved","contacted","tour_booked","rejected","leased"];

let feed = { listings: [] };
let lastLoad = null;
let feedOk = false;
let storageBlocked = false;
let workspace = loadWorkspace();
let selectedId = null;

const $ = (s) => document.querySelector(s);
// A cost is a number or it is nothing. A string, NaN, null and an absent field
// are all "unknown" — never 0 — so an explicit null behaves exactly like an
// absent field everywhere (badge, Fit, queue, sort, price observation).
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
// The displayed number must agree with the BUDGET comparison: whole dollars
// print whole, anything carrying cents prints its cents. Two listings that both
// read "$850" are therefore both exactly 850 and cannot get opposite verdicts.
const money = (v) => {
  const n = num(v);
  if (n == null) return "Unknown";
  const digits = Number.isInteger(n) ? 0 : 2;
  return new Intl.NumberFormat("en-CA", {
    style: "currency", currency: "CAD",
    minimumFractionDigits: digits, maximumFractionDigits: digits
  }).format(n);
};

function esc(v = "") {
  return String(v).replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}
function safe(v, fallback = "Unknown") {
  return v == null || v === "" ? fallback : String(v);
}
function yn(v) {
  return v === true ? "Yes" : v === false ? "No" : "Unknown";
}
function safeUrl(v) {
  try {
    const u = new URL(v);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch { return ""; }
}
function asDate(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
function ago(v) {
  const d = asDate(v);
  if (!d) return "unknown";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}
function dateShort(v) {
  const d = asDate(v);
  return d ? d.toLocaleDateString("en-CA", { month:"short", day:"numeric", year:"numeric" }) : "Unknown";
}
function dateTime(v) {
  const d = asDate(v);
  return d ? d.toLocaleString("en-CA", { dateStyle:"medium", timeStyle:"short" }) : "unknown";
}

function loadWorkspace() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    const listings = parsed && parsed.listings;
    // `typeof null === "object"`, so check the shape properly: a stored
    // {"listings":null} used to make every localFor() call throw.
    return {
      version: "2.5",
      listings: listings && typeof listings === "object" && !Array.isArray(listings) ? listings : {}
    };
  } catch {
    return { version:"2.5", listings:{} };
  }
}
// Returns true only when the workspace actually reached localStorage. Callers
// must not tell the user something was saved on a false.
function saveWorkspace() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    if (storageBlocked) { storageBlocked = false; showStorageWarning(false); }
    return true;
  } catch (e) {
    // Log once per transition into the failed state, not once per keystroke.
    if (!storageBlocked) console.error(e);
    storageBlocked = true;
    showStorageWarning(true, e);
    return false;
  }
}
function showStorageWarning(on, err) {
  const el = $("#storageWarning");
  if (!el) return;
  el.hidden = !on;
  if (on) {
    el.textContent = `Not saved — this browser refused to store the workspace (${(err && err.name) || "storage error"}). `
      + "Notes and workflow changes made now will be lost on reload. Copy anything important elsewhere, "
      + "then free up storage for this site.";
  }
}
function localFor(id) {
  const key = String(id);
  const existing = workspace.listings[key];
  if (!existing || typeof existing !== "object") {
    workspace.listings[key] = { workflow:"unreviewed", notes:"", priceHistory:[] };
  }
  const row = workspace.listings[key];
  // A stored workspace can hold any shape (hand-edited file, foreign export),
  // so coerce every field rather than trusting it: a non-string `notes` used to
  // throw on the first keystroke in the search box and kill search for good.
  if (!WORKFLOW_STATES.includes(row.workflow)) row.workflow = "unreviewed";
  if (typeof row.notes !== "string") row.notes = "";
  row.priceHistory = Array.isArray(row.priceHistory)
    ? row.priceHistory.filter(p => p && typeof p === "object")
    : [];
  return row;
}

const workflowLabels = {
  unreviewed: "Unreviewed",
  saved: "Saved",
  contacted: "Contacted",
  tour_booked: "Tour booked",
  rejected: "Rejected",
  leased: "Leased"
};
function workflowLabel(v) { return workflowLabels[v] || "Unreviewed"; }
function workflowBadge(v) {
  return {
    saved: "saved-badge",
    contacted: "pipeline-badge",
    tour_booked: "pipeline-badge",
    rejected: "rejected-badge",
    leased: "leased-badge"
  }[v] || "muted-badge";
}

function costStatus(l) {
  const estimate = num(l.estimatedAllInMonthly);
  const asking = num(l.askingRent);
  // Verified requires BOTH that the mandatory fees are known and that we hold a
  // real all-in number. `estimatedAllInMonthly: null` (or "" or absent) is an
  // unknown cost, so the listing stays in the verification queue.
  if (l.mandatoryFeesKnown === true && estimate != null) {
    return estimate <= BUDGET ? "verified" : "over";
  }
  if (l.costStatus === "over" && ((estimate != null && estimate > BUDGET) || (asking != null && asking > BUDGET))) {
    return "over";
  }
  return "plausible";
}
function costLabel(v) {
  return ({ verified:"VERIFIED ≤ $850", plausible:"NEEDS VERIFICATION", over:"OVER BUDGET" })[v] || "UNKNOWN";
}

function fit(l) {
  let s = 0;
  const st = costStatus(l);
  if (st === "verified") s += 35;
  if (st === "plausible") s += 20;
  if (st === "over") s -= 30;
  if (l.lockableDoor) s += 12;
  if (l.access24h) s += 10;
  if (l.mailRights) s += 8;
  if (l.directoryRights) s += 5;
  if (l.shortCommitment) s += 7;
  if (l.skateboardPractical) s += 6;
  const walk = num(l.finalWalkMinutes);
  const allIn = num(l.estimatedAllInMonthly);
  if (walk != null) s += Math.max(0, 8 - walk / 3);
  if (allIn != null) s += Math.max(0, (BUDGET - allIn) / 35);
  return Math.round(Math.max(0, Math.min(100, s)));
}

function normalizeHistoryEntry(p) {
  if (!p || typeof p !== "object") return null;
  const allIn = num(p.estimatedAllInMonthly ?? p.allIn);
  const asking = num(p.askingRent ?? p.asking);
  const when = p.date || p.at || p.observedAt || null;
  if (!when || typeof when !== "string" || (allIn == null && asking == null)) return null;
  return { date: when, estimatedAllInMonthly: allIn, askingRent: asking };
}
const byDate = (a,b) => (asDate(a.date)?.getTime() || 0) - (asDate(b.date)?.getTime() || 0);
function feedHistoryFor(l) {
  return (Array.isArray(l.priceHistory) ? l.priceHistory : [])
    .map(normalizeHistoryEntry).filter(Boolean).sort(byDate);
}
function localHistoryFor(l) {
  return localFor(l.id).priceHistory.map(normalizeHistoryEntry).filter(Boolean);
}
function historyFor(l) {
  const combined = [...feedHistoryFor(l), ...localHistoryFor(l)];
  const seen = new Set();
  return combined
    .filter(p => {
      const key = `${p.date}|${p.estimatedAllInMonthly}|${p.askingRent}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(byDate);
}
function observePrices() {
  let dirty = false;
  for (const l of feed.listings) {
    const local = localFor(l.id);
    const allIn = num(l.estimatedAllInMonthly);
    const asking = num(l.askingRent);
    if (allIn == null && asking == null) continue;

    // Record an observation only when this price is not already at the tail of
    // what we know — the last row WE appended, or the newest row the feed
    // carries. Comparing against the date-sorted tail of the merged series used
    // to make every single load look like a change and append a duplicate row
    // forever whenever the feed's history ran past our own newest stamp.
    const holds = (p) => !!p && p.estimatedAllInMonthly === allIn && p.askingRent === asking;
    if (!holds(localHistoryFor(l).at(-1)) && !holds(feedHistoryFor(l).at(-1))) {
      local.priceHistory.push({
        // Stamp the OBSERVATION time. Stamping l.lastChanged inserted today's
        // price into the middle of the series and rendered a drop as a rise.
        date: new Date().toISOString(),
        estimatedAllInMonthly: allIn,
        askingRent: asking
      });
      local.priceHistory = local.priceHistory.slice(-50);
      dirty = true;
    }
  }
  if (dirty) saveWorkspace();
}
function priceSeries(l) {
  const hist = historyFor(l);
  return hist.map(p => p.estimatedAllInMonthly ?? p.askingRent).filter(Number.isFinite);
}
function priceDelta(l) {
  const values = priceSeries(l);
  if (values.length < 2) return null;
  const last = values.at(-1);
  for (let i = values.length - 2; i >= 0; i--) {
    if (values[i] !== last) return last - values[i];
  }
  return 0;
}
function deltaHtml(l) {
  const d = priceDelta(l);
  if (d == null || d === 0) return "";
  const cls = d < 0 ? "down" : "up";
  const arrow = d < 0 ? "↓" : "↑";
  return ` · <span class="delta ${cls}">${arrow} ${esc(money(Math.abs(d)))}</span>`;
}

function sparkMarkup(l, large = false) {
  const values = priceSeries(l);
  if (!values.length) return `<div class="spark-wrap ${large ? "big-spark" : ""}"><span class="spark-label">no history</span></div>`;
  const w = 180, h = large ? 92 : 42, pad = 4;
  const min = Math.min(...values), max = Math.max(...values);
  const range = Math.max(1, max - min);
  const pts = values.map((v,i) => {
    const x = values.length === 1 ? w / 2 : pad + i * ((w - pad * 2) / (values.length - 1));
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return [x,y];
  });
  if (values.length === 1) pts.push([w - pad, pts[0][1]]);
  const poly = pts.map(p => p.join(",")).join(" ");
  const area = `${pad},${h-pad} ${poly} ${w-pad},${h-pad}`;
  const dots = pts.slice(0, values.length).map(([x,y]) => `<circle class="spark-dot" cx="${x}" cy="${y}" r="${large ? 2.8 : 2}"></circle>`).join("");
  return `<div class="spark-wrap ${large ? "big-spark" : ""}">
    <span class="spark-label">${values.length} obs.</span>
    <svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="Observed price history">
      <line class="spark-baseline" x1="${pad}" y1="${h-pad}" x2="${w-pad}" y2="${h-pad}"></line>
      <polygon class="spark-area" points="${area}"></polygon>
      <polyline class="spark-line" points="${poly}"></polyline>
      ${dots}
    </svg>
  </div>`;
}

function uncertaintyFields(l) {
  // A listing can need verification for either reason: the mandatory fees are
  // not known, or the all-in amount itself is missing (null / "" / absent).
  const out = [];
  if (num(l.estimatedAllInMonthly) == null) out.push("all-in monthly amount");
  if (l.mandatoryFeesKnown === true) return out;
  const checks = [
    ["TMI", l.tmiStatus],
    ["utilities", l.utilitiesStatus],
    ["internet", l.internetStatus],
    ["cleaning", l.cleaningStatus],
    ["mandatory fees", l.mandatoryFeeNotes]
  ];
  const uncertain = (v) => {
    const s = String(v || "").toLowerCase();
    return !s || ["unknown","verify","not explicitly","not clearly","appears","can vary","not separately disclosed","must be confirmed","needs final"].some(x => s.includes(x));
  };
  out.push(...checks.filter(([,v]) => uncertain(v)).map(([k]) => k));
  return out.length ? out : ["mandatory recurring costs"];
}

function card(l) {
  const st = costStatus(l);
  const wf = localFor(l.id).workflow;
  const wfBadge = wf !== "unreviewed" ? `<span class="badge ${workflowBadge(wf)}">${esc(workflowLabel(wf).toUpperCase())}</span>` : "";
  const chips = [
    l.lockableDoor ? '<span class="badge info">Lockable</span>' : "",
    l.access24h ? '<span class="badge muted-badge">24/7</span>' : "",
    l.mailRights ? '<span class="badge muted-badge">Mail</span>' : "",
    l.shortCommitment ? '<span class="badge muted-badge">Flexible term</span>' : ""
  ].join("");
  return `<article class="card workflow-${esc(wf)} ${l.active === false ? "inactive" : ""}" data-id="${esc(l.id)}" tabindex="0">
    <div class="ct">
      <div class="row">
        <div>
          <div class="operator">${esc(safe(l.operator))}</div>
          <h4 class="address">${esc(safe(l.address))}</h4>
          <div class="city">${esc(safe(l.municipality))}, Ontario${l.active === false ? " · inactive" : ""}</div>
        </div>
        <div class="badges"><span class="badge ${st}">${esc(costLabel(st))}</span>${wfBadge}</div>
      </div>
      <div class="price">${esc(money(l.estimatedAllInMonthly))} <span>estimated all-in / month</span></div>
      <div class="asking">${num(l.askingRent) == null ? "Asking rent unknown" : `Asking ${esc(money(l.askingRent))}/mo`}${l.hstStatus ? ` · HST tracked` : ""}${deltaHtml(l)}</div>
      <div class="facts">
        <div class="fact"><small>Space</small><div>${esc(safe(l.size))}</div></div>
        <div class="fact"><small>Transit</small><div>${esc(safe(l.transitConnection))}</div></div>
        <div class="fact"><small>Final walk</small><div>${num(l.finalWalkMinutes) == null ? "Unknown" : `${esc(num(l.finalWalkMinutes))} min`}</div></div>
      </div>
    </div>
    <div class="cb">
      <div class="chips">${chips}</div>
      <p class="note">${esc(safe(l.summary))}</p>
      <div class="card-bottom">
        <div class="date">
          <div>Verified ${esc(ago(l.lastVerified))}</div>
          <div>Changed ${esc(ago(l.lastChanged))} · <span class="score">Fit ${fit(l)}/100</span></div>
        </div>
        ${sparkMarkup(l)}
      </div>
    </div>
  </article>`;
}

function rebuildCities() {
  const current = $("#city").value;
  const cities = [...new Set(feed.listings.map(x => x.municipality).filter(Boolean))].sort();
  $("#city").innerHTML = '<option value="">All municipalities</option>' + cities.map(x => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
  if (cities.includes(current)) $("#city").value = current;
}

function filteredListings() {
  const q = $("#q").value.trim().toLowerCase();
  const city = $("#city").value;
  const st = $("#status").value;
  const wf = $("#workflow").value;
  const activeOnly = $("#activeOnly").checked;

  return feed.listings.filter(l => {
    if (activeOnly && l.active === false) return false;
    if (q && !JSON.stringify(l).toLowerCase().includes(q) && !localFor(l.id).notes.toLowerCase().includes(q)) return false;
    if (city && l.municipality !== city) return false;
    if (st && costStatus(l) !== st) return false;
    if (wf && localFor(l.id).workflow !== wf) return false;
    return true;
  });
}
function sortedListings(items) {
  const mode = $("#sort").value;
  const copy = [...items];
  if (mode === "fit") copy.sort((a,b) => fit(b) - fit(a));
  if (mode === "newest") copy.sort((a,b) => (asDate(b.lastVerified)?.getTime() || 0) - (asDate(a.lastVerified)?.getTime() || 0));
  if (mode === "changed") copy.sort((a,b) => (asDate(b.lastChanged)?.getTime() || 0) - (asDate(a.lastChanged)?.getTime() || 0));
  if (mode === "cost") copy.sort((a,b) => (num(a.estimatedAllInMonthly) ?? 99999) - (num(b.estimatedAllInMonthly) ?? 99999));
  if (mode === "walk") copy.sort((a,b) => (num(a.finalWalkMinutes) ?? 999) - (num(b.finalWalkMinutes) ?? 999));
  if (mode === "delta") copy.sort((a,b) => (priceDelta(a) ?? 99999) - (priceDelta(b) ?? 99999));
  return copy;
}
function render() {
  const items = sortedListings(filteredListings());
  $("#grid").innerHTML = items.map(card).join("");
  $("#empty").hidden = items.length !== 0;
  $("#resultCount").textContent = `${items.length} of ${feed.listings.length} shown`;

  document.querySelectorAll(".card").forEach(el => {
    const open = () => openDetail(feed.listings.find(x => x.id === el.dataset.id));
    el.addEventListener("click", open);
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}

function renderStats() {
  const active = feed.listings.filter(x => x.active !== false);
  $("#sActive").textContent = active.length;
  $("#sVerified").textContent = active.filter(x => costStatus(x) === "verified").length;
  $("#sUnknown").textContent = active.filter(x => costStatus(x) === "plausible").length;
  $("#sPipeline").textContent = active.filter(x => ["saved","contacted","tour_booked"].includes(localFor(x.id).workflow)).length;
  $("#sChanged").textContent = active.filter(x => {
    const d = asDate(x.lastChanged || x.lastVerified);
    return d && Date.now() - d.getTime() <= 604800000;
  }).length;
}

function renderVerificationQueue() {
  const items = feed.listings
    .filter(x => x.active !== false && costStatus(x) === "plausible")
    .sort((a,b) => fit(b) - fit(a));
  $("#verificationQueue").hidden = items.length === 0;
  $("#verificationTitle").textContent = `Needs cost verification · ${items.length}`;
  $("#verificationItems").innerHTML = items.slice(0,6).map(l => `
    <article class="queue-item" data-id="${esc(l.id)}" tabindex="0">
      <div class="queue-title">${esc(safe(l.operator))} · ${esc(safe(l.address))}</div>
      <div class="queue-meta">${num(l.estimatedAllInMonthly) == null ? "all-in unknown" : `${esc(money(l.estimatedAllInMonthly))}/mo provisional`} · Fit ${fit(l)}/100</div>
      <div class="queue-missing">Resolve: ${esc(uncertaintyFields(l).join(" · "))}</div>
    </article>`).join("");
  document.querySelectorAll(".queue-item").forEach(el => {
    const open = () => openDetail(feed.listings.find(x => x.id === el.dataset.id));
    el.addEventListener("click", open);
    el.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); }
    });
  });
}

const detailLine = (a,b) => `<div class="line"><span>${esc(a)}</span><span>${esc(safe(b))}</span></div>`;

function openDetail(l) {
  if (!l) return;
  selectedId = l.id;
  const st = costStatus(l);
  const local = localFor(l.id);
  const source = safeUrl(l.sourceUrl);
  const hist = historyFor(l);
  const historySummary = hist.length
    ? `${dateShort(hist[0].date)} → ${dateShort(hist.at(-1).date)}${priceDelta(l) == null ? "" : ` · net ${priceDelta(l) < 0 ? "drop" : "rise"} ${money(Math.abs(priceDelta(l)))}`}`
    : "No observed price history yet.";

  $("#detail").innerHTML = `
    <div class="dh">
      <div class="eyebrow">${esc(safe(l.operator))} · ${esc(safe(l.leaseType))}</div>
      <h2>${esc(safe(l.address))}</h2>
      <p>${esc(safe(l.municipality))}, Ontario</p>
      <div class="dp">${num(l.estimatedAllInMonthly) == null ? "All-in cost unknown" : `${esc(money(l.estimatedAllInMonthly))}/mo`}</div>
      <div class="dh-badges">
        <span class="badge ${st}">${esc(costLabel(st))}</span>
        <span class="badge ${workflowBadge(local.workflow)}">${esc(workflowLabel(local.workflow).toUpperCase())}</span>
        <span class="badge muted-badge">FIT ${fit(l)}/100</span>
      </div>
    </div>
    <div class="db">
      <section class="workspace">
        <label>Workflow state
          <select id="detailWorkflow">
            ${Object.entries(workflowLabels).map(([value,label]) => `<option value="${value}" ${local.workflow === value ? "selected" : ""}>${esc(label)}</option>`).join("")}
          </select>
          <div class="save-state">Saved locally in this browser.</div>
        </label>
        <label>Personal notes
          <textarea id="personalNotes" placeholder="Call outcome, tour impressions, questions, negotiation notes…">${esc(local.notes)}</textarea>
          <div class="save-state" id="noteState">Autosaves as you type.</div>
        </label>
      </section>

      <div class="dg">
        <section class="sec">
          <h4>Cost</h4>
          ${detailLine("Asking rent", num(l.askingRent) == null ? "Unknown" : `${money(l.askingRent)}/mo`)}
          ${detailLine("Estimated all-in", num(l.estimatedAllInMonthly) == null ? "Unknown" : `${money(l.estimatedAllInMonthly)}/mo`)}
          ${detailLine("HST", l.hstStatus)}
          ${detailLine("TMI", l.tmiStatus)}
          ${detailLine("Utilities", l.utilitiesStatus)}
          ${detailLine("Internet", l.internetStatus)}
          ${detailLine("Cleaning", l.cleaningStatus)}
          ${detailLine("Mandatory fees", l.mandatoryFeeNotes)}
        </section>
        <section class="sec">
          <h4>Space & access</h4>
          ${detailLine("Size", l.size)}
          ${detailLine("Lockable door", yn(l.lockableDoor))}
          ${detailLine("24-hour access", yn(l.access24h))}
          ${detailLine("Furnished", yn(l.furnished))}
          ${detailLine("Parking", l.parking)}
          ${detailLine("Amenities", (l.amenities || []).join(", ") || "Unknown")}
        </section>
        <section class="sec">
          <h4>Transit</h4>
          ${detailLine("Connection", l.transitConnection)}
          ${detailLine("Final walk", num(l.finalWalkMinutes) == null ? "Unknown" : `${num(l.finalWalkMinutes)} minutes`)}
          ${detailLine("Skateboard practical", yn(l.skateboardPractical))}
          ${detailLine("Route note", l.skateboardNote)}
        </section>
        <section class="sec">
          <h4>Rights & term</h4>
          ${detailLine("Term", l.term)}
          ${detailLine("Short commitment", yn(l.shortCommitment))}
          ${detailLine("Mail rights", yn(l.mailRights))}
          ${detailLine("Directory rights", yn(l.directoryRights))}
          ${detailLine("Signage rights", l.signageRights)}
          ${detailLine("Last verified", l.lastVerified)}
          ${detailLine("Last changed", l.lastChanged)}
          ${detailLine("Feed status", l.active === false ? "Inactive" : "Active")}
        </section>
        <section class="sec">
          <div class="history-head">
            <h4>Observed price history</h4>
            <span class="history-summary">${esc(historySummary)}</span>
          </div>
          ${sparkMarkup(l, true)}
          <div class="history-list">${hist.slice(-5).map(p => `<span>${esc(dateShort(p.date))}: ${esc(money(p.estimatedAllInMonthly ?? p.askingRent))}</span>`).join("") || "<span>No history.</span>"}</div>
        </section>
        <section class="sec">
          <h4>Verification queue</h4>
          ${costStatus(l) === "plausible"
            ? `<p class="note">Before this listing can become verified, resolve: <strong>${esc(uncertaintyFields(l).join(", "))}</strong>.</p>`
            : `<p class="note">${st === "verified" ? "Mandatory recurring costs are represented as known in the feed." : "The currently observed mandatory cost is over the hard ceiling."}</p>`}
        </section>
      </div>

      <div class="notes"><strong>Research note:</strong> ${esc(safe(l.notes))}</div>
      ${source ? `<a class="source" href="${esc(source)}" target="_blank" rel="noopener noreferrer">Open source listing ↗</a>` : ""}
    </div>`;

  $("#detailWorkflow").addEventListener("change", e => {
    localFor(l.id).workflow = e.target.value;
    const saved = saveWorkspace();
    renderStats(); render(); renderVerificationQueue();
    toast(saved
      ? `Workflow: ${workflowLabel(e.target.value)}`
      : "NOT SAVED — this browser refused to store it");
  });
  $("#personalNotes").addEventListener("input", e => {
    localFor(l.id).notes = e.target.value;
    const saved = saveWorkspace();
    const state = $("#noteState");
    state.classList.toggle("save-error", !saved);
    if (!saved) {
      // Never claim an autosave that did not happen.
      state.textContent = "NOT SAVED — this browser refused to store it. Copy this note somewhere else.";
      return;
    }
    state.textContent = "Saved.";
    setTimeout(() => {
      if ($("#noteState") && !$("#noteState").classList.contains("save-error")) {
        $("#noteState").textContent = "Autosaves as you type.";
      }
    }, 900);
  });

  $("#dialog").showModal();
}

function feedAgeMs() {
  const d = asDate(feed.generatedAt);
  return d ? Date.now() - d.getTime() : null;
}
function ageLabel(ms) {
  const mins = Math.max(0, Math.round(ms / 60000));
  if (mins < 60) return `${mins} min old`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours} h old`;
  return `${Math.round(hours / 24)} days old`;
}
// "Live" is an affirmative claim. If the edge is not routing /data/listings.json
// to the live API, the browser silently reads the build-time snapshot; say so
// instead of badging a frozen feed green.
function setFeedState() {
  const el = $("#live");
  const age = feedAgeMs();
  const stale = age == null || age > STALE_AFTER;
  const count = `${feed.listings.length} listing${feed.listings.length === 1 ? "" : "s"}`;
  el.textContent = age == null
    ? `Feed date unknown · ${count}`
    : stale ? `Stale · ${ageLabel(age)} · ${count}` : `Live · ${count}`;
  el.parentElement.classList.toggle("stale", stale);
  $("#updated").classList.toggle("warn-text", stale);
}

function times() {
  $("#updated").textContent = `Feed updated ${feed.generatedAt ? dateTime(feed.generatedAt) : "unknown"}`;
  if (lastLoad) $("#next").textContent = `Next refresh ~${dateTime(new Date(lastLoad.getTime() + REFRESH_INTERVAL))}`;
  if (feedOk) setFeedState();
}

async function load(manual = false) {
  try {
    $("#live").textContent = manual ? "Refreshing…" : "Loading feed…";
    const r = await fetch(`${FEED_URL}?v=${Date.now()}`, { cache:"no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const parsed = await r.json();
    if (!parsed || !Array.isArray(parsed.listings)) throw new Error("Invalid listings feed");
    // Entries that are not objects cannot be rendered at all; drop them rather
    // than counting them as listings.
    feed = { ...parsed, listings: parsed.listings.filter(l => l && typeof l === "object") };
    lastLoad = new Date();
    feedOk = true;
    observePrices();
    rebuildCities();
    renderStats();
    renderVerificationQueue();
    render();
    times();
    setFeedState();
    if (selectedId && $("#dialog").open) openDetail(feed.listings.find(x => x.id === selectedId));
    if (manual) toast("Feed refreshed");
  } catch (e) {
    console.error(e);
    feedOk = false;
    $("#live").textContent = "Feed unavailable";
    $("#live").parentElement.classList.add("stale");
    $("#grid").innerHTML = '<div class="empty panel"><h3>Could not load listings feed</h3><p>Try Refresh now.</p></div>';
  }
}

let toastTimer;
function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

function clearFilters() {
  $("#q").value = "";
  $("#city").value = "";
  $("#status").value = "";
  $("#workflow").value = "";
  $("#sort").value = "fit";
  $("#activeOnly").checked = true;
  render();
}

function exportWorkspace() {
  const payload = {
    product: "Fluxology Office Scout",
    version: "2.5",
    exportedAt: new Date().toISOString(),
    workspace
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type:"application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `fluxology-office-scout-workspace-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
  toast("Workspace exported");
}
function sanitizeIncomingRow(row) {
  if (!row || typeof row !== "object") return null;
  return {
    workflow: WORKFLOW_STATES.includes(row.workflow) ? row.workflow : "unreviewed",
    notes: typeof row.notes === "string" ? row.notes : "",
    priceHistory: (Array.isArray(row.priceHistory) ? row.priceHistory : []).filter(p => p && typeof p === "object")
  };
}
function unionHistory(mine, theirs) {
  const seen = new Set();
  const out = [];
  for (const p of [...mine, ...theirs]) {
    const n = normalizeHistoryEntry(p);
    if (!n) continue;
    const key = `${n.date}|${n.estimatedAllInMonthly}|${n.askingRent}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out.sort(byDate).slice(-50);
}
// Merge one incoming record into one existing record. A field the incoming
// record does not carry (absent, or an empty note, or "unreviewed") never
// clears what is already here, and two different notes are combined rather than
// replaced — hand-entered research is the only data in this app that cannot be
// regenerated from the feed.
function mergeRow(mine, theirs, stamp) {
  const merged = { workflow: mine.workflow, notes: mine.notes, priceHistory: mine.priceHistory };
  const changes = [];
  if (theirs.workflow !== "unreviewed" && theirs.workflow !== mine.workflow) {
    merged.workflow = theirs.workflow;
    changes.push(`workflow ${workflowLabel(mine.workflow)} → ${workflowLabel(theirs.workflow)}`);
  }
  if (theirs.notes && theirs.notes !== mine.notes && !mine.notes.includes(theirs.notes)) {
    merged.notes = mine.notes ? `${mine.notes}\n\n--- imported ${stamp} ---\n${theirs.notes}` : theirs.notes;
    changes.push(mine.notes ? "notes combined (existing note kept)" : "notes added");
  }
  const beforeCount = mine.priceHistory.length;
  merged.priceHistory = unionHistory(mine.priceHistory, theirs.priceHistory);
  const gained = merged.priceHistory.length - beforeCount;
  if (gained > 0) changes.push(`${gained} price observation${gained === 1 ? "" : "s"} added`);
  return { merged, changes };
}

async function importWorkspace(file) {
  try {
    const parsed = JSON.parse(await file.text());
    const incoming = parsed.workspace || parsed;
    if (!incoming || typeof incoming.listings !== "object" || Array.isArray(incoming.listings)) {
      throw new Error("No workspace listings found");
    }
    const stamp = new Date().toISOString().slice(0,10);
    const pending = new Map();
    const plan = [];
    let addedCount = 0;

    for (const [rawId, rawRow] of Object.entries(incoming.listings)) {
      const id = String(rawId);
      const theirs = sanitizeIncomingRow(rawRow);
      if (!theirs) continue;
      if (!Object.prototype.hasOwnProperty.call(workspace.listings, id)) {
        pending.set(id, theirs);
        addedCount++;
        continue;
      }
      const { merged, changes } = mergeRow(localFor(id), theirs, stamp);
      if (!changes.length) continue;
      pending.set(id, merged);
      plan.push(`${id}: ${changes.join("; ")}`);
    }

    if (!pending.size) { toast("Import: nothing to change"); return; }

    if (plan.length) {
      const shown = plan.slice(0,8).join("\n");
      const more = plan.length > 8 ? `\n…and ${plan.length - 8} more` : "";
      const ok = confirm(
        `Import will change ${plan.length} existing record${plan.length === 1 ? "" : "s"}`
        + `${addedCount ? ` and add ${addedCount} new one${addedCount === 1 ? "" : "s"}` : ""}:\n\n`
        + `${shown}${more}\n\n`
        + "Nothing you have written is deleted — notes are combined, not replaced.\n\nApply this import?"
      );
      if (!ok) { toast("Import cancelled — nothing changed"); return; }
    }

    for (const [id, row] of pending) workspace.listings[id] = row;
    const saved = saveWorkspace();
    observePrices();
    renderStats(); renderVerificationQueue(); render();
    if (selectedId && $("#dialog").open) openDetail(feed.listings.find(x => x.id === selectedId));
    const summary = [
      addedCount ? `${addedCount} added` : "",
      plan.length ? `${plan.length} merged` : ""
    ].filter(Boolean).join(" · ");
    toast(saved ? `Imported · ${summary}` : `Imported · ${summary} — NOT SAVED to this browser`);
  } catch (e) {
    console.error(e);
    toast("Import failed — nothing changed");
  } finally {
    $("#importWorkspace").value = "";
  }
}

$("#q").addEventListener("input", render);
["#city","#status","#workflow","#sort","#activeOnly"].forEach(x => $(x).addEventListener("change", render));
$("#refresh").addEventListener("click", () => load(true));
$("#clearFilters").addEventListener("click", clearFilters);
$("#showVerificationOnly").addEventListener("click", () => {
  $("#status").value = "plausible";
  $("#activeOnly").checked = true;
  render();
  document.querySelector(".feedhead").scrollIntoView({ behavior:"smooth", block:"start" });
});
$("#exportWorkspace").addEventListener("click", exportWorkspace);
$("#importWorkspace").addEventListener("change", e => {
  const file = e.target.files?.[0];
  if (file) importWorkspace(file);
});
$("#close").addEventListener("click", () => $("#dialog").close());
$("#dialog").addEventListener("click", e => {
  if (e.target === $("#dialog")) $("#dialog").close();
});
$("#dialog").addEventListener("close", () => { selectedId = null; });

load();
setInterval(load, REFRESH_INTERVAL);
setInterval(times, 30000);
