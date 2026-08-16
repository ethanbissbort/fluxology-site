const FEED_URL = './data/listings.json';
const INTERVAL = 3600000;
const TICK = 30000;
const STORAGE_KEY = 'fluxology.deals.workspace.v3';

let feed = { listings: [] };
let lastLoad = null;
let selectedId = null;
let workspace = loadWorkspace();
let loadSeq = 0;
let inFlight = null;
let searchTimer = null;

const $ = selector => document.querySelector(selector);
const qCache = new WeakMap();

function numOf(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function money(value, fallback = 'Unknown') {
  const number = numOf(value);
  return number == null
    ? fallback
    : new Intl.NumberFormat('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 }).format(number);
}

function num(value, fallback = '—') {
  const number = numOf(value);
  return number == null ? fallback : new Intl.NumberFormat('en-CA', { maximumFractionDigits: 2 }).format(number);
}

function weightText(value) {
  return numOf(value) == null ? '—' : `${num(value)} lb`;
}

function esc(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[character]));
}

function safe(value, fallback = 'Unknown') {
  return value == null || value === '' ? fallback : String(value);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : '';
  } catch {
    return '';
  }
}

function dt(value) {
  if (!value) return null;
  let source = value;
  if (typeof source === 'string') {
    source = source.trim();
    if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(source)) {
      source = `${source.replace(' ', 'T')}Z`;
    }
  } else if (typeof source !== 'number' && !(source instanceof Date)) {
    return null;
  }
  const date = new Date(source);
  return Number.isNaN(date.getTime()) ? null : date;
}

function ago(value) {
  const date = dt(value);
  if (!date) return 'unknown';
  const hours = Math.floor((Date.now() - date) / 3600000);
  if (hours < 1) return 'just now';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

function remaining(value) {
  const date = dt(value);
  if (!date) return '—';
  const ms = date - Date.now();
  if (ms <= 0) return 'ended';
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return hours >= 24 ? `${Math.floor(hours / 24)}d ${hours % 24}h` : `${hours}h ${minutes}m`;
}

function loadWorkspace() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return { version: '3', listings: parsed.listings && typeof parsed.listings === 'object' ? parsed.listings : {} };
  } catch {
    return { version: '3', listings: {} };
  }
}

function saveWorkspace() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
    return true;
  } catch (error) {
    console.error('deals: workspace not saved', error);
    return false;
  }
}

function localFor(id) {
  if (!workspace.listings[id]) workspace.listings[id] = { workflow: 'unreviewed', notes: '' };
  const local = workspace.listings[id];
  if (!['unreviewed', 'watch', 'saved', 'purchased', 'rejected'].includes(local.workflow)) local.workflow = 'unreviewed';
  local.notes ||= '';
  return local;
}

const wfLabel = {
  unreviewed: 'Unreviewed',
  watch: 'Watch',
  saved: 'Saved',
  purchased: 'Purchased',
  rejected: 'Rejected',
};

function hash(source) {
  let value = 5381;
  for (let i = 0; i < source.length; i += 1) value = (value * 33 ^ source.charCodeAt(i)) >>> 0;
  return value.toString(36);
}

function listingId(row) {
  const pick = value => value == null || typeof value === 'object' ? '' : String(value).trim();
  const id = pick(row.id);
  if (id) return id;
  const marketplaceId = pick(row.marketplaceListingId);
  if (marketplaceId) {
    const prefix = pick(row.marketplace).toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'marketplace';
    return `${prefix}-${marketplaceId}`;
  }
  const itemId = pick(row.itemId);
  if (itemId) return `ebay-${itemId}`;
  return `auto-${hash(`${pick(row.url)}|${pick(row.title)}|${pick(row.marketplace)}`)}`;
}

function isAudit(row) {
  return row.recordType === 'search_run' || row.listingType === 'search_run';
}

function listings() {
  return feed.listings.filter(row => !isAudit(row));
}

function audits() {
  return feed.listings.filter(isAudit);
}

function isLocal(row) {
  return row.listingType === 'classified' || row.pickupOnly === true || String(row.marketplace || '').toLowerCase() === 'kijiji';
}

function acquisitionPerLb(row) {
  if (isLocal(row)) {
    return numOf(row.effectiveCadPerLb) ?? numOf(row.priceCadPerLb) ?? numOf(row.landedCadPerLb);
  }
  return numOf(row.landedCadPerLb);
}

function counted(row) {
  return !isAudit(row) && row.active !== false && row.status !== 'expired' && row.status !== 'ended';
}

function highPriority(row) {
  if (['exceptional_commodity_price', 'exceptional_compositional_diversity', 'both'].includes(row.decisionBasis)) return true;
  const perLb = acquisitionPerLb(row);
  if (perLb == null) return false;
  return isLocal(row) ? perLb <= 7 : row.shippingResolved !== false && perLb <= 8;
}

function dealClass(row) {
  if (row.rejectionClass === 'temporary_value' || row.photoAssessment === 'promising_needs_1_2_photos') return 'warn';
  if (!isLocal(row) && row.shippingResolved === false) return 'warn';
  if (highPriority(row)) return 'killer';
  if (isLocal(row)) return 'good';
  const perLb = acquisitionPerLb(row);
  if (perLb != null && perLb <= 10) return 'good';
  return '';
}

function dealLabel(row) {
  if (row.rejectionClass === 'temporary_value') return 'RECHECK LATER';
  if (row.photoAssessment === 'promising_needs_1_2_photos') return 'NEEDS PHOTOS';
  if (row.decisionBasis === 'both') return 'PRICE + DIVERSITY';
  if (row.decisionBasis === 'exceptional_compositional_diversity') return 'DIVERSE LOT';
  if (row.decisionBasis === 'exceptional_commodity_price') return 'EXCEPTIONAL PRICE';
  if (isLocal(row)) {
    const perLb = acquisitionPerLb(row);
    if (perLb != null && perLb <= 7) return '≤ $7/LB LOCAL';
    return 'LOCAL PICKUP';
  }
  if (row.shippingResolved === false) return 'SHIPPING UNRESOLVED';
  const perLb = acquisitionPerLb(row);
  if (perLb != null && perLb <= 8) return '≤ $8/LB';
  if (perLb != null && perLb <= 10) return '≤ $10/LB';
  return 'CURATED';
}

function radiusBadge(row) {
  const radii = Array.isArray(row.seenInRadiiKm) ? row.seenInRadiiKm.map(numOf).filter(v => v != null) : [];
  if (!radii.length) return '';
  if (radii.includes(45)) return '<span class="badge pipeline">≤45 KM</span>';
  if (radii.includes(65)) {
    const distance = numOf(row.distanceKm);
    return `<span class="badge pipeline">${distance != null && distance > 45 ? '45–65 KM' : '65 KM PASS'}</span>`;
  }
  return '';
}

function listingTypeLabel(row) {
  if (row.listingType === 'auction') return 'Auction';
  if (row.listingType === 'classified') return 'Local classified';
  return 'Buy It Now';
}

function rebuildCategories() {
  const current = $('#category').value;
  const categories = [...new Set(listings().map(row => row.category || row.searchName).filter(value => typeof value === 'string' && value.trim()))].sort();
  if (current && !categories.includes(current)) categories.push(current);
  $('#category').innerHTML = '<option value="">All searches</option>' + categories.map(value => `<option value="${esc(value)}">${esc(value)}</option>`).join('');
  $('#category').value = current;
}

function latestAudit(radiusKm) {
  return audits()
    .filter(row => numOf(row.searchAudit?.radiusKm) === radiusKm)
    .sort((a, b) => (dt(b.searchAudit?.completedAt || b.lastSeen || b.firstSeen)?.getTime() || 0) - (dt(a.searchAudit?.completedAt || a.lastSeen || a.firstSeen)?.getTime() || 0))[0] || null;
}

function stats() {
  const active = listings().filter(counted);
  $('#sActive').textContent = active.length;
  $('#sKiller').textContent = active.filter(highPriority).length;
  $('#sGood').textContent = active.filter(isLocal).length;
  const inner = latestAudit(45)?.searchAudit?.resultRecordsInspected;
  const outer = latestAudit(65)?.searchAudit?.resultRecordsInspected;
  $('#sUnknown').textContent = inner == null && outer == null ? '—' : `${inner ?? '—'} / ${outer ?? '—'}`;
}

function primaryPriceText(row) {
  const perLb = acquisitionPerLb(row);
  if (perLb != null) return `${money(perLb)}/lb`;
  if (isLocal(row) && numOf(row.priceCad) != null) return money(row.priceCad);
  return 'Unresolved';
}

function priceCaption(row) {
  if (!isLocal(row)) return 'landed before tax';
  if (numOf(row.effectiveCadPerLb) != null) return 'effective incl. pickup';
  if (numOf(row.priceCadPerLb) != null) return 'item price before pickup';
  return 'local item price';
}

function card(row) {
  const workflow = localFor(row.id).workflow;
  const deal = dealClass(row);
  const image = row.imageUrl ? `<img src="${esc(row.imageUrl)}" alt="" loading="lazy">` : '';
  const archived = !counted(row);
  const itemPrice = row.listingType === 'auction' ? money(row.currentBidCad, '—') : money(row.priceCad, '—');
  const badges = `<span class="badge ${deal}">${esc(dealLabel(row))}</span>${radiusBadge(row)}${archived ? `<span class="badge">${esc(safe(row.status, 'inactive').toUpperCase())}</span>` : ''}${workflow !== 'unreviewed' ? `<span class="badge ${workflow === 'purchased' ? 'purchased' : workflow === 'rejected' ? 'rejected' : 'pipeline'}">${esc(wfLabel[workflow].toUpperCase())}</span>` : ''}`;
  const media = image ? `<div class="image">${image}<div class="badges">${badges}</div></div>` : `<div class="badges nomedia">${badges}</div>`;
  const thirdLabel = isLocal(row) ? 'Distance' : row.listingType === 'auction' ? 'Ends' : 'Shipping';
  const thirdValue = isLocal(row)
    ? (numOf(row.distanceKm) == null ? 'Unknown' : `${num(row.distanceKm)} km`)
    : row.listingType === 'auction'
      ? `<span data-ends="${esc(safe(row.endTime, ''))}">${esc(remaining(row.endTime))}</span>`
      : esc(money(row.shippingCad, 'Unresolved'));

  return `<article class="card${archived ? ' inactive' : ''}" data-id="${esc(row.id)}" tabindex="0" role="button" aria-label="${esc(safe(row.title))} · ${esc(primaryPriceText(row))} · ${esc(dealLabel(row))}">
    ${media}
    <div class="ct">
      <div class="kicker">${esc(safe(row.category || row.searchName, 'Shopping'))} · ${esc(listingTypeLabel(row))}</div>
      <h4 class="title">${esc(safe(row.title))}</h4>
      <div class="price">${esc(primaryPriceText(row))} <span>${esc(priceCaption(row))}</span></div>
      <div class="facts">
        <div class="fact"><small>Weight</small><div>${esc(weightText(row.weightLb))}</div></div>
        <div class="fact"><small>${row.listingType === 'auction' ? 'Bid' : 'Price'}</small><div>${esc(itemPrice)}</div></div>
        <div class="fact"><small>${thirdLabel}</small><div>${thirdValue}</div></div>
      </div>
    </div>
    <div class="cb">
      <p class="note">${esc(safe(row.summary || row.notes, ''))}</p>
      <div class="date"><span>Seen ${esc(ago(row.firstSeen))}</span><span>${esc(safe(row.seller, 'seller unknown'))}</span></div>
    </div>
  </article>`;
}

function haystack(row) {
  let value = qCache.get(row);
  if (value === undefined) {
    value = JSON.stringify(row).toLowerCase();
    qCache.set(row, value);
  }
  return value;
}

function filtered() {
  const query = $('#q').value.trim().toLowerCase();
  const category = $('#category').value;
  const type = $('#type').value;
  const deal = $('#deal').value;
  const workflow = $('#workflow').value;
  const activeOnly = $('#activeOnly').checked;

  return listings().filter(row => {
    if (activeOnly && !counted(row)) return false;
    if (query && !haystack(row).includes(query) && !localFor(row.id).notes.toLowerCase().includes(query)) return false;
    if (category && (row.category || row.searchName) !== category) return false;
    if (type && row.listingType !== type) return false;
    if (workflow && localFor(row.id).workflow !== workflow) return false;

    const perLb = acquisitionPerLb(row);
    if (deal === 'high' && !highPriority(row)) return false;
    if (deal === '7' && !(isLocal(row) && perLb != null && perLb <= 7)) return false;
    if (deal === 'photos' && row.photoAssessment !== 'promising_needs_1_2_photos') return false;
    if (deal === 'temporary' && row.rejectionClass !== 'temporary_value') return false;
    if (deal === 'unresolved' && (isLocal(row) || row.shippingResolved !== false)) return false;
    return true;
  });
}

function sorted(items) {
  const mode = $('#sort').value;
  const result = [...items];
  if (mode === 'newest') result.sort((a, b) => (dt(b.firstSeen)?.getTime() || 0) - (dt(a.firstSeen)?.getTime() || 0));
  if (mode === 'price') result.sort((a, b) => (acquisitionPerLb(a) ?? 99999) - (acquisitionPerLb(b) ?? 99999));
  if (mode === 'distance') result.sort((a, b) => (numOf(a.distanceKm) ?? 99999) - (numOf(b.distanceKm) ?? 99999));
  if (mode === 'ending') result.sort((a, b) => (dt(a.endTime)?.getTime() || Infinity) - (dt(b.endTime)?.getTime() || Infinity));
  if (mode === 'weight') result.sort((a, b) => (numOf(b.weightLb) || 0) - (numOf(a.weightLb) || 0));
  return result;
}

function render() {
  const items = sorted(filtered());
  $('#grid').innerHTML = items.map(card).join('');
  $('#empty').hidden = items.length !== 0;
  $('#resultCount').textContent = `${items.length} of ${listings().length} shown`;
  document.querySelectorAll('.card').forEach(element => {
    const open = () => openDetail(listings().find(row => row.id === element.dataset.id));
    element.onclick = open;
    element.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        open();
      }
    };
  });
}

const line = (label, value) => `<div class="line"><span>${esc(label)}</span><span>${esc(safe(value))}</span></div>`;

function historyHtml(row) {
  const history = Array.isArray(row.observationHistory) ? row.observationHistory.slice(-6).reverse() : [];
  if (!history.length) return '';
  return `<section class="sec"><h4>Observation history</h4>${history.map(point => {
    const price = numOf(point.effectiveCadPerLb) ?? numOf(point.priceCadPerLb) ?? numOf(point.priceCad);
    const detail = [price == null ? null : money(price), point.photoAssessment, point.diversityGrade, point.status].filter(Boolean).join(' · ');
    return line(point.observedAt || 'Observed', detail || point.note || 'Observation');
  }).join('')}</section>`;
}

function openDetail(row) {
  if (!row) return;
  selectedId = row.id;
  const workflow = localFor(row.id);
  const url = safeUrl(row.url);
  const auction = row.listingType === 'auction';
  const local = isLocal(row);
  const perLb = acquisitionPerLb(row);
  const marketplaceId = row.marketplaceListingId || row.itemId;

  const priceSection = local
    ? `<section class="sec"><h4>Price / pickup</h4>
        ${line('Item price', money(row.priceCad, 'Unknown'))}
        ${line('Item C$/lb', money(row.priceCadPerLb, 'Unknown'))}
        ${line('Pickup cost', money(row.pickupCostCad, 'Unresolved'))}
        ${line('Effective acquisition', money(row.effectiveAcquisitionCad, 'Unresolved'))}
        ${line('Effective C$/lb', money(row.effectiveCadPerLb, 'Unresolved'))}
      </section>`
    : `<section class="sec"><h4>Price</h4>
        ${line(auction ? 'Current bid' : 'Item price', auction ? money(row.currentBidCad) : money(row.priceCad))}
        ${line('Shipping', money(row.shippingCad, 'Unresolved'))}
        ${line('Landed C$/lb', perLb == null ? 'Unresolved' : money(perLb))}
        ${line('All-in C$/lb', money(row.allInCadPerLb))}
        ${line('Best Offer', row.bestOffer === true ? 'Yes' : row.bestOffer === false ? 'No' : 'Unknown')}
      </section>`;

  const localSection = local
    ? `<section class="sec"><h4>Local search / pickup</h4>
        ${line('Pickup area', row.pickupArea)}
        ${line('Distance', numOf(row.distanceKm) == null ? 'Unknown' : `${num(row.distanceKm)} km`)}
        ${line('Seen in radii', Array.isArray(row.seenInRadiiKm) ? row.seenInRadiiKm.map(value => `${value} km`).join(', ') : 'Unknown')}
        ${line('Zipcar increment', money(row.zipcarIncrementCad, 'Unresolved'))}
        ${line('Tolls / parking', money(row.tollParkingCad, 'Unresolved'))}
        ${line('Pickup cluster', row.pickupCluster)}
        ${line('Batch candidate', row.batchPickupCandidate === true ? 'Yes' : row.batchPickupCandidate === false ? 'No' : 'Unknown')}
      </section>`
    : `<section class="sec"><h4>Auction / limits</h4>
        <div class="line"><span>Time remaining</span><span${auction ? ` data-ends="${esc(safe(row.endTime, ''))}"` : ''}>${esc(auction ? remaining(row.endTime) : 'N/A')}</span></div>
        ${line('Max bid @ $10/lb', money(row.maxBidCad))}
        ${line('Max shipping @ $10/lb', money(row.maxShippingCad))}
        ${line('Bid count', row.bidCount)}
      </section>`;

  $('#detail').innerHTML = `<div class="dh">
      <div class="eyebrow">${esc(safe(row.category || row.searchName, 'Shopping'))} · ${esc(listingTypeLabel(row))}</div>
      <h2 id="dTitle">${esc(safe(row.title))}</h2>
      <p>${esc(safe(row.seller, 'Seller unknown'))}</p>
      <div class="dp">${esc(primaryPriceText(row))}</div>
      <span class="badge ${dealClass(row)}">${esc(dealLabel(row))}</span>
    </div>
    <div class="db">
      <div class="dg">
        ${priceSection}
        <section class="sec"><h4>Lot</h4>
          ${line('Weight', numOf(row.weightLb) == null ? 'Unknown' : `${num(row.weightLb)} lb`)}
          ${line('Marketplace', row.marketplace || 'eBay')}
          ${line('Marketplace ID', marketplaceId)}
          ${line('Quality', row.qualityGrade || row.genuineConfidence)}
          ${line('Diversity', row.diversityGrade)}
          ${line('Photo assessment', row.photoAssessment)}
          ${line('Exact-lot photos', row.exactLotPhotos === true ? 'Yes' : row.exactLotPhotos === false ? 'No' : 'Unknown')}
          ${line('Cleanout signals', row.cleanoutSignalScore == null ? 'Unknown' : `${row.cleanoutSignalScore}/8`)}
          ${line('Estimated genuine', row.estimatedGenuinePct == null ? 'Unknown' : `${num(row.estimatedGenuinePct)}%`)}
        </section>
        ${localSection}
        <section class="sec"><h4>Tracking</h4>
          ${line('First seen', row.firstSeen)}
          ${line('Last seen', row.lastSeen)}
          ${line('Last changed', row.lastChanged)}
          ${line('Status', row.status || 'active')}
          ${line('Decision basis', row.decisionBasis)}
          ${line('Rejection class', row.rejectionClass)}
          ${line('Recheck after', row.recheckAfter)}
          ${line('Seller contact', row.sellerContactStatus)}
          ${line('Next action', row.nextAction)}
        </section>
        ${historyHtml(row)}
      </div>
      <div class="notes"><strong>Curator note:</strong> ${esc(safe(row.notes || row.summary, ''))}${row.calculation ? `<br><br><strong>Calculation:</strong> ${esc(row.calculation)}` : ''}</div>
      <div class="workspace"><strong>My workflow</strong>
        <select id="wfEdit" aria-label="Workflow state">${Object.entries(wfLabel).map(([key, value]) => `<option value="${key}" ${workflow.workflow === key ? 'selected' : ''}>${esc(value)}</option>`).join('')}</select>
        <textarea id="noteEdit" aria-label="Personal notes" placeholder="Personal notes…">${esc(workflow.notes)}</textarea>
        <p class="savemsg" id="saveMsg" role="alert"></p>
        <div class="workspace-actions"><button class="smallbtn" id="saveLocal">Save local state</button></div>
      </div>
      ${url ? `<a class="source" href="${esc(url)}" target="_blank" rel="noopener noreferrer">Open source listing ↗</a>` : ''}
    </div>`;

  $('#saveLocal').onclick = () => {
    const localState = localFor(row.id);
    const previousWorkflow = localState.workflow;
    const previousNotes = localState.notes;
    localState.workflow = $('#wfEdit').value;
    localState.notes = $('#noteEdit').value;
    if (!saveWorkspace()) {
      localState.workflow = previousWorkflow;
      localState.notes = previousNotes;
      $('#saveMsg').textContent = 'Not saved — browser storage is full or unavailable. Your change was discarded.';
      return;
    }
    render();
    $('#dialog').close();
  };

  $('#dialog').setAttribute('aria-labelledby', 'dTitle');
  $('#dialog').showModal();
}

function times() {
  const format = date => date.toLocaleString('en-CA', { dateStyle: 'medium', timeStyle: 'short' });
  const generated = dt(feed.generatedAt);
  $('#updated').textContent = `Feed updated ${generated ? format(generated) : 'unknown'}`;
  if (lastLoad) $('#next').textContent = `Next refresh ~${format(new Date(lastLoad.getTime() + INTERVAL))}`;
}

function tick() {
  times();
  document.querySelectorAll('[data-ends]').forEach(element => {
    const text = remaining(element.dataset.ends);
    if (element.textContent !== text) element.textContent = text;
  });
}

async function load(manual = false) {
  const sequence = ++loadSeq;
  if (inFlight) inFlight.abort();
  const controller = new AbortController();
  inFlight = controller;
  $('#refresh').disabled = true;

  try {
    $('#live').textContent = manual ? 'Refreshing…' : 'Loading feed…';
    const response = await fetch(`${FEED_URL}?v=${Date.now()}`, { cache: 'no-store', signal: controller.signal });
    if (!response.ok) throw Error(`HTTP ${response.status}`);
    const parsed = await response.json();
    if (sequence !== loadSeq) return;
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.listings)) throw Error('Invalid feed');

    const seen = new Map();
    let duplicates = 0;
    let junk = 0;
    parsed.listings.forEach(row => {
      if (!row || typeof row !== 'object' || Array.isArray(row)) {
        junk += 1;
        return;
      }
      row.id = listingId(row);
      if (seen.has(row.id)) duplicates += 1;
      seen.set(row.id, row);
    });
    parsed.listings = [...seen.values()];
    if (duplicates) console.warn(`deals: ${duplicates} record(s) share an id with a later record and were superseded`);
    if (junk) console.warn(`deals: ${junk} unusable record(s) ignored`);

    feed = parsed;
    qCache.clear?.();
    lastLoad = new Date();
    rebuildCategories();
    stats();
    render();
    tick();
    $('#live').textContent = `Live · ${listings().length} listings · ${audits().length} search audits`;
    if (selectedId && $('#dialog').open) openDetail(listings().find(row => row.id === selectedId));
  } catch (error) {
    if (sequence !== loadSeq || error?.name === 'AbortError') return;
    console.error(error);
    $('#live').textContent = 'Feed unavailable';
    $('#grid').innerHTML = '<div class="empty"><h3>Could not load listings feed</h3><p>Try Refresh now.</p></div>';
    $('#empty').hidden = true;
  } finally {
    if (sequence === loadSeq) {
      inFlight = null;
      $('#refresh').disabled = false;
    }
  }
}

$('#q').oninput = () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(render, 120);
};
['#category', '#type', '#deal', '#workflow', '#sort', '#activeOnly'].forEach(selector => { $(selector).onchange = render; });
$('#refresh').onclick = () => load(true);
$('#close').onclick = () => $('#dialog').close();
$('#dialog').onclick = event => { if (event.target === $('#dialog')) $('#dialog').close(); };
$('#dialog'].onclose = () => {
  const id = selectedId;
  selectedId = null;
  if (!id) return;
  const element = [...document.querySelectorAll('.card')].find(cardElement => cardElement.dataset.id === id);
  (element || $('#grid')).focus();
};

load();
setInterval(load, INTERVAL);
setInterval(tick, TICK);
