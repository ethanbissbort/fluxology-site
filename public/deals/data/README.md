# Fluxology Deals data layout

## Files

- `listings.json` — current operational Fluxology Deals v3.1 snapshot. It is intentionally pretty-printed so connector reads can retrieve bounded line ranges instead of one giant line. Keep current tracked records and purchased records here; do not use it as a dumping ground for stale/calibration-only leads.
- `historical-listings.json` — readable inactive, stale, failed-validation and legacy records that are no longer part of the operational snapshot or require historical preservation.
- `unresolved-listings.json` — quarantine for valuable user-supplied live screenshots/short-link observations whose exact current canonical eBay item ID cannot yet be safely verified. These records are not eligible for live-deal notifications or active dashboard status until canonicalized.
- `archive/listings-2026-08-12-pre-rebuild.json` — exact blob-level backup of the pre-rebuild `listings.json`.
- `shipping-calibration.json` — destination-resolved, proxy, same-listing quantity-series, and cart-level shipping observations used to understand eBay shipping to M6H 2W9, including records that lack a canonical item ID.
- `seller-watch.json` — watched/excluded/provisional LEGO sellers and seller-level workflow rules.
- `schema.json` — Fluxology Deals v3.1 operational schema.

## Maintenance rules

1. Never discard purchased, expired, inactive or historical records merely because they are no longer live. Move them to the appropriate historical/calibration/quarantine file instead of deleting the evidence. The archive remains the lossless fallback for the pre-rebuild state.
2. Discovery is not validation. Search-result pages, indexed/cached pages, snippets and category pages may identify a candidate but can never establish that it is currently live.
3. A live eBay notification requires a current direct canonical item fetch that proves the exact item ID and present availability. Canonical URL existence alone is insufficient. If current direct validation fails, mark `needs_revalidation`/failed or quarantine the record; do not notify.
4. Never treat U.S.-destination proxy shipping as M6H 2W9 shipping. Preserve proxy observations only when clearly labelled as proxies.
5. Do not trust eBay's `Save on combined shipping` language as proof of rational consolidation. Test the actual M6H 2W9 cart. If multiple listings/variations scale irrationally, prefer seller messaging for a manual invoice or custom/bundled listing.
6. Store empirical shipping observations that do not have a stable canonical eBay item ID in `shipping-calibration.json`; store unresolved deal-state observations in `unresolved-listings.json`. Never invent, guess, or borrow an item ID from an older relist.
7. Keep `listings.json` pretty-printed. Do not minify it back to a single line.
8. Whenever any seller is promoted to a permanent, provisional, negotiation, or other watch status, perform an immediate same-run deep dive of that seller's active LEGO inventory rather than asking the user to browse it.
9. Random diversity is positive inventory value when the underlying price is reasonable. Favor varied assortments and low duplication even when every piece is not on the explicit priority list.
10. Preserve root metadata and records belonging to other shopping searches/categories when performing future merges or updates.
