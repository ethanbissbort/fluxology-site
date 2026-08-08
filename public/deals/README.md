# Fluxology Deals v3

Static dashboard intended for `https://deals.fluxology.ca/`.

## Canonical feed

`public/deals/data/listings.json`

Each shopping skill or scheduled search should merge its results into this one feed using a stable `id`. Use `category` and `searchName` so different searches can coexist, for example:

- Bulk LEGO
- Bulk LEGO minifigures
- office equipment
- tools
- future shopping searches

Do not delete historical purchased or expired records merely because they are no longer active. Prefer `active:false` or an appropriate `status`.

For weight-priced searches, `landedCadPerLb` means item price plus shipping, converted to CAD, divided by stated lot weight. Tax may be tracked separately with `allInCadPerLb`. When destination shipping is not known, set `shippingResolved:false` and preserve the best available proxy only if clearly labelled in `notes` / `calculation`.

The browser stores personal Watch / Saved / Purchased / Rejected workflow state and personal notes in `localStorage`; scheduled jobs must never invent or overwrite those fields in the GitHub feed.

## Automation contract

A scheduled skill should:

1. read the existing feed;
2. research its own search category;
3. merge by stable listing ID;
4. preserve listings owned by other search categories;
5. update `lastSeen` when actually checked;
6. update `lastChanged` only for material changes;
7. avoid rewriting the file when nothing materially changed;
8. write the complete valid JSON document back to GitHub.

Routine automation should modify only `data/listings.json`.
