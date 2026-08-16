# Fluxology Deals v3.2

Static dashboard frontend for:

`https://deals.fluxology.ca/`

The dashboard can contain many shopping searches and marketplaces in one feed. Use stable `id` values plus `category`, `searchName`, and `marketplace` so eBay bulk LEGO, Kijiji local classifieds, minifigures, tools, equipment, and future searches can coexist.

## Production feed

`data/listings.json` in this folder is the checked-in bootstrap/local-development snapshot.

In production, the dashboard's request for `/data/listings.json` is routed to the persistent self-hosted dashboard API. Trusted automation writes immediately to the live feed with:

`POST https://deals.fluxology.ca/api/upsert`

using the deals-scoped bearer token.

See `services/dashboard-api/README.md` for the API contract and `docs/CADDY-INTEGRATION.md` for routing.

## Deal semantics

For shipped weight-priced searches, `landedCadPerLb` means item price plus shipping, converted to CAD, divided by stated lot weight. Tax can be tracked separately with `allInCadPerLb`.

When destination shipping is not known, set `shippingResolved:false`. Proxy shipping must remain clearly labelled in `notes` / `calculation` and must not be presented as a resolved Toronto quote.

For local classifieds, use `listingType:"classified"`, `pickupOnly:true`, and an explicit stable marketplace id such as `kijiji-<marketplaceListingId>`. Local acquisition economics are separate from shipping:

- `priceCadPerLb` is the item-only price per pound when weight is known;
- `pickupCostCad` is incremental acquisition travel cost;
- `effectiveAcquisitionCad` is item price plus incremental Zipcar time cost plus tolls/parking;
- `effectiveCadPerLb` is the effective acquisition cost divided by lot weight;
- fuel is not added when it is already included in the user's Zipcar membership.

Do not invent a Zipcar rate. Leave `zipcarIncrementCad`, `pickupCostCad`, and downstream effective-cost values unresolved until the actual incremental booking cost is known or can be estimated from a real booking/rate.

Kijiji bulk can qualify through either `exceptional_commodity_price` or `exceptional_compositional_diversity`. A local item-only price around C$7/lb or less is a mandatory close-inspection trigger, not a hard purchase ceiling. Specialty-heavy lots may qualify above it.

## Kijiji geographic search contract

`data/search-profiles.json` is the machine-readable search policy. Two independent passes are mandatory around postal code `M6H 2W9`:

1. 45 km radius;
2. 65 km radius.

Run both passes independently and deduplicate only afterward. Preserve each listing's pass membership in `seenInRadiiKm` / `searchProfileIds`; do not infer that appearing in the 65 km pass proves it appeared in the 45 km pass.

Search-run audit records use `recordType:"search_run"` and `listingType:"search_run"`. They live in the same authoritative feed so routine API upserts can persist them without a separate sidecar database. The dashboard excludes them from the buying queue and uses the newest 45 km and 65 km audit records to show inspected-result coverage.

Every Kijiji run must record the exact `resultRecordsInspected` and `listingPagesOpened`. When trackable, also record duplicates, stale/removed ads, counterfeit/compatible exclusions, out-of-range pickups, detailed evaluations, surfaced candidates, tool caps, truncation, and limitations. Never claim uninspected or truncated inventory as exhaustive coverage.

## Tracking and history

Historical purchased, rejected, ended, expired, and temporarily unattractive records should be preserved when useful by changing `active` / `status` rather than silently deleting them.

A first-glance value rejection is not a blacklist. Use `rejectionClass:"temporary_value"`, preserve the listing, and set `recheckAfter` when a useful review date is known. Use `hard_exclusion` only for genuinely terminal reasons such as counterfeit/compatible-only goods, removed/stale ads, or pickup outside the practical search area.

For Kijiji records, append material observations to `observationHistory` when price, effective pickup economics, photo quality, diversity assessment, status, or other decision-relevant facts change. Do not replace prior observations. This is what makes later markdowns and seller price evolution auditable.

The browser stores personal Watch / Saved / Purchased / Rejected workflow state and personal notes in `localStorage`; server-side writers never own those fields.

## Writer contract

A category skill should:

1. use stable listing IDs (`ebay-<itemId>` or `<marketplace>-<marketplaceListingId>`);
2. upsert only records it owns;
3. preserve records from other deal categories and marketplaces;
4. update `lastSeen` when actually checked;
5. update material listing fields when they change;
6. preserve prior `observationHistory` and append new material observations rather than replacing history;
7. keep unresolved shipped-listing costs explicitly unresolved;
8. keep unresolved pickup economics explicitly unresolved;
9. write one `search_run` audit record for each required Kijiji radius pass;
10. leave browser-local workflow state untouched.

The checked-in JSON snapshot remains available as a GitHub intermediary/fallback, but routine production writes should use the direct upsert endpoint.
