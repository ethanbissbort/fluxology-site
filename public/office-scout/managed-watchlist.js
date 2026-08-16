const MANAGED_PROVIDER_FEED_URL = "./data/managed-providers.json";

const managedEsc = (v = "") => String(v).replace(/[&<>"']/g, c => ({
  "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
}[c]));

function managedSafeUrl(v) {
  try {
    const u = new URL(v);
    return ["http:", "https:"].includes(u.protocol) ? u.href : "";
  } catch { return ""; }
}

function managedPriorityLabel(p) {
  if (p === 1) return "IMMEDIATE";
  if (p === 2) return "SECOND WAVE";
  if (p === 3) return "MONITOR";
  return "OUT OF MARKET";
}

function managedProviderMarkup(p) {
  const website = managedSafeUrl(p.website);
  const score = Number.isFinite(p.preliminaryScore) ? ` · provisional ${p.preliminaryScore}/100` : "";
  const network = p.network ? `<div class="managed-detail"><b>Network:</b> ${managedEsc(p.network)}</div>` : "";
  const fb = p.foodBeverage ? `<div class="managed-detail"><b>F&B:</b> ${managedEsc(p.foodBeverage)}</div>` : "";
  const link = website ? `<a class="managed-link" href="${managedEsc(website)}" target="_blank" rel="noopener">Provider site ↗</a>` : "";
  return `<article class="managed-provider ${p.status === "out-of-market" ? "managed-muted" : ""}">
    <div class="managed-provider-head">
      <div>
        <div class="managed-name">${managedEsc(p.name)}</div>
        <div class="managed-meta">${managedEsc(managedPriorityLabel(p.priority))}${score} · confidence ${managedEsc(p.scoreConfidence || "unknown")}</div>
      </div>
      ${link}
    </div>
    <div class="managed-price">${managedEsc(p.priceSignal || "Pricing requires inquiry.")}</div>
    ${fb}
    ${network}
    <div class="managed-outreach"><b>Outreach:</b> ${managedEsc(p.outreachPriority || "monitor")}</div>
  </article>`;
}

async function loadManagedProviders() {
  const section = document.querySelector("#managedProviderWatchlist");
  const items = document.querySelector("#managedProviderItems");
  const title = document.querySelector("#managedProviderTitle");
  const meta = document.querySelector("#managedProviderMeta");
  if (!section || !items || !title) return;

  try {
    const r = await fetch(`${MANAGED_PROVIDER_FEED_URL}?v=${Date.now()}`, { cache:"no-store" });
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    const data = await r.json();
    const providers = Array.isArray(data.providers) ? data.providers.filter(p => p && typeof p === "object") : [];
    providers.sort((a,b) => (a.priority ?? 99) - (b.priority ?? 99) || (b.preliminaryScore ?? -1) - (a.preliminaryScore ?? -1));

    title.textContent = `Managed-office watchlist · ${providers.filter(p => p.status === "watch").length} active`;
    if (meta) meta.textContent = `Research feed updated ${data.generatedAt ? new Date(data.generatedAt).toLocaleString("en-CA", {dateStyle:"medium", timeStyle:"short"}) : "unknown"}`;
    items.innerHTML = providers.map(managedProviderMarkup).join("");
    section.hidden = providers.length === 0;
  } catch (e) {
    console.error(e);
    title.textContent = "Managed-office watchlist unavailable";
    if (meta) meta.textContent = "Could not load provider research feed";
    items.innerHTML = "";
  }
}

loadManagedProviders();
setInterval(loadManagedProviders, 60 * 60 * 1000);
