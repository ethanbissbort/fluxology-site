---
name: fluxology-deals-run
description: Execute the scheduled LEGO deal watch (eBay Track A + Kijiji Track B) end to end — traversal, canonical validation, coverage audit, and Deals dashboard upsert. Use when asked to run the deals watch, the LEGO watch, or a Track A/B acquisition pass.
---

# Fluxology Deals Run

This skill is the execution specification for the recurring LEGO deal watch.
It was ported verbatim from the ChatGPT automation "LEGO Deal Watch A+B"
(snapshot 2026-08-17); the OPERATIONS section maps it onto the Fluxology
tool stack. The spec below is normative — do not weaken its validation,
coverage, or reporting rules.

## OPERATIONS (tool mapping)

- **Browsing** — the Browser Bridge MCP connector (`browser-mcp.fluxology.ca`):
  `browser.session_open` (a specific `deviceId`, or `"default"` when exactly
  one PC is online) → `browser.navigate` → `browser.extract`.
  `browser.extract` dispatches by page kind: eBay `/itm/` and Kijiji ad pages
  return the full provenance record; eBay `/sch/` + `/str/`|`/usr/` and Kijiji
  `/b-*` search pages return an ordered candidate list (Kijiji search results
  include `hasNextPage`/`nextPageUrl` for pagination). Candidate snippets are
  traversal hints only — canonical validation means extracting the item page.
- **Dashboard writes** — `dashboard.feed` with `{dashboard:"deals", mode:"ids"}`
  first to diff against stored records, then `dashboard.upsert` with
  `{dashboard:"deals", listings:[...]}` for new/materially-changed records
  only. Records merge by stable id (`ebay-<itemId>` / `kijiji-<adId>`);
  the server preserves unrelated and historical records. Match the existing
  record conventions in `public/deals/data/listings.json` (schemaVersion 3
  fields: id, itemId, category, searchName, title, marketplace, url,
  listingType, status, active, seller, price/shipping fields,
  shippingResolved, validationStatus, firstSeen/lastSeen/lastChanged, notes).
- **Fallback write path** — if the dashboard tools are unavailable, update
  `public/deals/data/listings.json` on `main` of `ethanbissbort/fluxology-site`
  via the GitHub API: merge by stable id, preserve root metadata and every
  unrelated record, update `lastSeen` only when checked and `lastChanged`
  only on material change, and skip the commit entirely when nothing
  materially changed (the Sync dashboard feeds workflow pushes it live).
- **Degraded runs** — if the Browser Bridge connector is not attached, or no
  Windows device is online, do not fabricate anything: report exactly which
  capability was missing, complete whatever does not need it, and still emit
  the full completion report (NO-SILENCE applies to failures too).
- **Hard limits** — read-only research: never bid, buy, offer, message a
  seller, or mutate watchlists/carts. Credentials never appear in task text
  or output; the gateway holds them.

## TASK SPECIFICATION (normative, ported verbatim)

Run the LEGO deal watch as TWO DISTINCT SEARCH TRACKS with a common destination in the Fluxology Deals dashboard.

TRACK A — eBay.ca
Search eBay.ca for newly listed genuine LEGO deals available to ship to postal code M6H 2W9. Focus on LEGO Minifigures & Minifigure Components and LEGO Specialty Parts for Buildings, Interiors & Scenes, generally ignoring ordinary bulk-by-weight brick lots unless unusually specialty-rich. Priorities: (1) diverse printed/decorated tiles and scene-detail prints; (2) minifigure accessories including hair/headgear/tools/food/props/backpacks/helmets/handhelds/utensils; (3) windows/frames/doors/glazing; (4) transparent/translucent architecture/environment pieces; (5) furniture/interior/environmental detail, greenery, signage, controls, lamps, computers, greebles; (6) identified incomplete sets about 70%-99% complete with verifiable identity/completeness; (7) minifigure bulk by weight/bulk quantity — explicitly search minifig/minifigure + lb/lbs/pound/pounds/weight/bulk/lot/parts/accessories/gear. Treat dense minifigure-only/minifigure-heavy weight lots as a distinct high-value category and evaluate by estimated figure-equivalent/component count rather than ordinary LEGO $/lb.

Track A search methods: search auctions and Buy It Now; broad eBay searches; exact-category/high-recall searches; watched-seller inventory searches; seller drill-downs; newly listed sorting when available; pagination through as much native eBay inventory as exposed. Exclude counterfeit/compatible goods and listings that do not ship to Canada, including theLEGOlady unless a future listing verifiably ships to M6H 2W9. For specialty lots calculate landed CAD/piece when reliable; otherwise report price, shipping, useful-piece density, diversity and scene usefulness. For auctions report bid, time remaining, destination-resolved shipping when available, current landed metric and sensible maximum bid. For BIN report price, shipping, landed metric and Best Offer. Mark M6H shipping unresolved if it cannot actually be determined; never substitute a U.S.-destination proxy. Treat DASHBRICK shipping as listing-specific; only count cross-item savings when checkout confirms them.

Track A validation: never surface a deal as fully validated solely from search results/cache/snippets. Verify canonical live eBay item ID and URL https://www.ebay.ca/itm/ITEMID (or valid ebay.com equivalent). If direct canonical validation fails but the search result exposes a plausible exact item ID, retain it as a MANUAL VALIDATION CANDIDATE. If 1-4 promising candidates fail direct canonical validation, include all canonical URLs in the user-visible report with title, item ID, search-card terms, and what needs confirmation. If 5+ fail, report the count and continue automated triage rather than dumping all links.

Track A watched sellers: tweedsidesales/Jeremy Doherty; Neekoushop; Brick & Figs Beach Shack; DASHBRICK; thegoldenbookmark; dkbooksandtreasures/DK Books and Treasures; Double Duncan Treasures; Bluebird Brick Designs; mfonlinesails15; Scott's Toy Emporium/novanut74; audi2005store; roaud1033/thexselligator; leamaude_45; luserena. Whenever a new seller is discovered through a good/excellent relevant LEGO listing, immediately perform a seller-level drill-down in the same run and explicitly decide whether to add that seller to the permanent Track A watch list.

TRACK B — Kijiji
Search Kijiji independently for local LEGO deals around postal code M6H 2W9. Track B has the SAME purchase priorities and categories as Track A, but uses Kijiji-specific discovery methods and local-listing terminology rather than eBay seller/shipping logic. Run TWO independent radius searches centered on M6H 2W9: 45 km and 65 km. Inspect both fully as far as the interface exposes, then deduplicate the overlap by stable listing ID/URL.

Track B core taxonomy must mirror Track A: printed/decorated tiles; minifigure accessories/components; windows/doors/glazing; transparent/translucent pieces; interior/environment/scene-detail parts; incomplete identified sets; minifigure bulk by weight/bulk quantity. Also run Kijiji-specific high-recall searches including broad/vague household-sale terminology such as LEGO, Lego lot, Lego bulk, Lego bin, Lego box, Lego collection, Lego pieces, Lego parts, Lego minifigs, Lego minifigures, Lego figures, minifigure lot, minifig lot, minifigure parts, minifig parts, Lego accessories, Lego windows, Lego doors, Lego tiles, Lego printed tiles, incomplete Lego set, Lego set no box, Lego set missing pieces, Lego by pound, Lego lbs, minifigs by pound, minifigures bulk, Lego garage cleanout, Lego toy box, estate/garage/cleanout phrasing, and similarly underspecified local-sale language. Favor exact-photo local listings, messy/underspecified household cleanouts, estate/charity/thrift/donation sellers, and suburban pickup listings that may be underpriced.

Track B valuation: pickup is acceptable and should be evaluated separately from shipped deals. Do not invent vehicle/fuel costs. Report location/distance when available and whether pickup-only or shipping-capable. For minifig lots, estimate per-figure/per-component economics when count is reliable. For specialty lots, calculate price/piece when reliable; otherwise report useful-piece density, diversity, scene usefulness, and asking price. For incomplete sets, verify identity/completeness as well as practical from listing text/photos.

Track B validation: before surfacing a candidate, open the exact live Kijiji listing URL and confirm it remains active and matches title/photos/price/location. Omit deleted/stale/redirected listings. If a promising exact listing URL cannot be opened, retain it only as a clearly marked manual-validation candidate, not a validated deal.

SEARCH COVERAGE / AUDIT — BOTH TRACKS
Every run must treat Track A and Track B as separate audited acquisition pipelines. Inspect as many relevant active listing records as reasonably exposed, potentially hundreds per track. Do not stop because one or more good candidates have been found. Paginate sequentially and continue through as much inventory as the interface exposes. If rate-limited or temporarily errored, slow down, retry reasonably, and continue rather than silently abandoning the run. Never fabricate counts.

Every user-visible completion report must contain TWO coverage sections:
A-track audit: exact eBay broad-search records inspected; exact records inspected for EACH watched eBay seller; exact canonical item pages individually opened/validated; detailed-evaluation count; surfaced count; trackable duplicate/stale/ended/non-Canada/counterfeit/other hard exclusions; any cap/truncation/rate-limit/pagination failure with exact number processed.
B-track audit: exact Kijiji 45 km records inspected; exact Kijiji 65 km records inspected; exact overlap duplicates removed; exact live listing pages opened/validated; detailed-evaluation count; surfaced count; trackable stale/deleted/duplicate/irrelevant/counterfeit exclusions; any cap/truncation/rate-limit/pagination failure with exact number processed.

A seller 'deep dive'/'drill down' means traversing as much relevant active inventory as the available interface exposes, not checking only the first page or first 5-10 results.

NO-SILENCE RULE: Every scheduled run must return a user-visible completion report even when zero worthwhile deals or material changes are found. If zero qualify on either track, explicitly say so for that track and include its full coverage audit and limitations. Never suppress a run merely because there are no qualifying deals.

COMMON DESTINATION — FLUXOLOGY DEALS DASHBOARD
Track A and Track B are separate search/acquisition pipelines but converge on the same Fluxology Deals v3 dataset/dashboard. Normalize meaningful new listings/material changes from either track into the same dashboard schema while preserving source/platform identity on each record so eBay and Kijiji records remain distinguishable. Use category 'LEGO Minifigures' for complete/component/minifigure-bulk records, 'LEGO Specialty Parts' for specialty-part records, and existing incomplete-set category conventions. Use searchName 'LEGO Specialty & Minifig Watch'. Preserve purchased, expired, inactive, historical, and unrelated records.

Preferred transport: the connected authenticated Fluxology dashboard write tool (`dashboard.upsert` on the Browser Bridge connector, corresponding to POST https://deals.fluxology.ca/api/upsert); credentials come from the connected tool and never appear in task text/output. Fallback: update ethanbissbort/fluxology-site public/deals/data/listings.json via GitHub, preserving root metadata and every unrelated record, merging by stable ID, updating lastSeen only when checked and lastChanged only on material change, and avoiding repository rewrite when nothing materially changed. Even when no data write occurs, still return the full A-track + B-track completion report.
