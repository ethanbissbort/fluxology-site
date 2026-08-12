# Fluxology Deals data layout

## Files

- `listings.json` — current operational Fluxology Deals v3 snapshot. It is intentionally pretty-printed so connector reads can retrieve bounded line ranges instead of one giant line.
- `historical-listings.json` — readable recovered legacy records that are no longer part of the operational snapshot or require revalidation.
- `archive/listings-2026-08-12-pre-rebuild.json` — exact blob-level backup of the pre-rebuild `listings.json`.
- `shipping-calibration.json` — destination-resolved and proxy shipping observations used to model eBay shipping to M6H 2W9, including records that lack a canonical item ID.
- `seller-watch.json` — watched/excluded/provisional LEGO sellers and seller-level workflow rules.

## Maintenance rules

1. Never discard purchased, expired, inactive or historical records merely because they are no longer live. The archive remains the lossless fallback for the pre-rebuild state and `historical-listings.json` provides readable access to recovered legacy records.
2. Only surface a live eBay candidate after validating its canonical item ID and canonical item page.
3. Never treat U.S.-destination proxy shipping as M6H 2W9 shipping.
4. Store empirical shipping observations that do not have a stable canonical eBay item ID in `shipping-calibration.json` rather than inventing an item ID.
5. Keep `listings.json` pretty-printed. Do not minify it back to a single line.
6. When a seller appears promising, deep-dive that seller's active LEGO inventory rather than asking the user to browse it.
