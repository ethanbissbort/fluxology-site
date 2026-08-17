# Fluxology Deals data layout

This directory holds agent working state for the Deals search workflows.
It lives at the repo root — deliberately **outside `public/`** — so none of
these files are copied into the built site or served on the web. Only the
operational snapshot and its schema stay web-served, because the dashboard
and the feed sync need them:

- `public/deals/data/listings.json` — the served bootstrap snapshot
- `public/deals/data/schema.json` — the canonical v3.2 schema

## Files (this directory)

- `../../public/deals/data/listings.json` — current operational Fluxology Deals schema-v3 bootstrap snapshot (web-served; see above). It is intentionally pretty-printed so connector reads can retrieve bounded line ranges instead of one giant line. Keep current tracked records and purchased records there; do not use it as a dumping ground for stale/calibration-only leads.
- `historical-listings.json` — readable inactive, stale, failed-validation and legacy records that are no longer part of the operational snapshot or require historical preservation.
- `unresolved-listings.json` — quarantine for valuable user-supplied live screenshots/short-link observations whose exact current canonical marketplace listing ID cannot yet be safely verified. These records are not eligible for live-deal notifications or active dashboard status until canonicalized.
- `archive/listings-2026-08-12-pre-rebuild.json` — exact blob-level backup of the pre-rebuild `listings.json`.
- `shipping-calibration.json` — destination-resolved, proxy, same-listing quantity-series, and cart-level shipping observations used to understand eBay shipping to M6H 2W9, including records that lack a canonical item ID.
- `seller-watch.json` — watched/excluded/provisional LEGO sellers and seller-level workflow rules.
- `search-profiles.json` — machine-readable local-search policy. It defines the mandatory independent Kijiji 45 km and 65 km passes around M6H 2W9, query vocabulary, audit fields, bulk qualification rules, photo-follow-up rules, and Zipcar pickup-cost semantics.
- `schema.json` — Fluxology Deals v3.2 operational schema. Schema major version remains 3; v3.2 is additive and supports local classifieds plus search-audit records.

## Kijiji record conventions

Use `listingType:"classified"`, `marketplace:"Kijiji"`, `marketplaceListingId`, and a stable id of `kijiji-<marketplaceListingId>`. Do not overload eBay `itemId` for Kijiji.

Preserve search provenance with `searchProfileIds`, `seenInRadiiKm`, and `matchedQueries`. The 45 km and 65 km searches are separate required passes; run both first and deduplicate afterward.

Local travel cost is not shipping. Use `zipcarIncrementCad`, `tollParkingCad`, `pickupCostCad`, `effectiveAcquisitionCad`, and `effectiveCadPerLb`. Fuel is zero incremental cost when included in the user's Zipcar membership. Unknown Zipcar time cost remains null rather than being guessed.

Photo triage uses:

- `sufficient`
- `promising_needs_1_2_photos`
- `impossible_to_evaluate`

A poorly merchandised exact-lot ad can receive higher investigative priority. Store observable cleanout characteristics in `cleanoutSignals` and the corresponding 0–8 `cleanoutSignalScore`; do not infer seller demographics.

Bulk LEGO remains low priority after sufficient ordinary inventory has been acquired, but it can re-enter the buying queue through either `exceptional_commodity_price` or `exceptional_compositional_diversity`. C$7/lb local item price is a close-inspection trigger, not a hard ceiling.

## Search-run history

Every completed required Kijiji pass creates a feed record with:

- `recordType:"search_run"`
- `listingType:"search_run"`
- `active:false`
- a unique stable run id
- `searchAudit.profileId`
- `searchAudit.radiusKm`
- `searchAudit.resultRecordsInspected`
- `searchAudit.listingPagesOpened`

Record duplicate, stale/removed, counterfeit/compatible, outside-practical-area, detailed-evaluation, surfaced-candidate, truncation, tool-cap, and limitation counts whenever available. Search-run records stay in the authoritative Deals feed for history, but the dashboard hides them from the shopping cards and uses the latest 45/65 km records for its coverage statistic.

## Listing history

`observationHistory` is append-only decision history for a marketplace listing. Add an observation when materially relevant facts change, including price, seller offer, item/effective C$/lb, pickup economics, photo assessment, diversity assessment, active/status state, or other facts that can change the buy/reject decision. Preserve prior observations during every merge.

A current bad price is not a hard exclusion. Use `rejectionClass:"temporary_value"` for price/value rejection and preserve the record for later re-evaluation. Use `hard_exclusion` only when the reason is actually terminal for the workflow.

## Maintenance rules

1. Never discard purchased, expired, inactive, historical, search-audit, or temporarily rejected records merely because they are no longer live or attractive. Preserve the evidence.
2. Discovery is not validation. Search-result pages, indexed/cached pages, snippets and category pages may identify a candidate but can never establish that it is currently live.
3. A live eBay notification requires a current direct canonical item fetch that proves the exact item ID and present availability. Canonical URL existence alone is insufficient. If current direct validation fails, mark `needs_revalidation`/failed or quarantine the record; do not notify.
4. A Kijiji candidate should preserve its canonical listing ID and exact-lot evidence when available. A poor photo is a reason to request useful seller photos, not automatically a reason to discard a promising cheap local lot.
5. Never treat U.S.-destination proxy shipping as M6H 2W9 shipping. Preserve proxy observations only when clearly labelled as proxies.
6. Do not trust eBay's `Save on combined shipping` language as proof of rational consolidation. Test the actual M6H 2W9 cart. If multiple listings/variations scale irrationally, prefer seller messaging for a manual invoice or custom/bundled listing.
7. Store empirical shipping observations that do not have a stable canonical eBay item ID in `shipping-calibration.json`; store unresolved deal-state observations in `unresolved-listings.json`. Never invent, guess, or borrow an item ID from an older relist.
8. Keep `listings.json` pretty-printed. Do not minify it back to a single line.
9. Whenever any seller is promoted to a permanent, provisional, negotiation, or other watch status, perform an immediate same-run deep dive of that seller's active LEGO inventory rather than asking the user to browse it.
10. For Kijiji sellers, check other active listings when one LEGO ad looks promising and evaluate whether multiple pickup purchases can be consolidated geographically or negotiated as one bundle.
11. Random diversity is positive inventory value when the underlying price is reasonable. Favor varied assortments and low duplication even when every piece is not on the explicit priority list.
12. Preserve root metadata and records belonging to other shopping searches/categories when performing future merges or updates.
13. Every search report must state actual records inspected and listing pages opened. Tool caps/truncation must be explicit; never equate returned records with theoretically available inventory.
