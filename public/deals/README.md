# Fluxology Deals v3

Static dashboard frontend for:

`https://deals.fluxology.ca/`

The dashboard can contain many shopping searches in one feed. Use stable `id` values plus `category` and `searchName` so bulk LEGO, minifigures, tools, equipment, and future searches can coexist.

## Production feed

`data/listings.json` in this folder is the checked-in bootstrap/local-development snapshot.

In production, the dashboard's request for `/data/listings.json` is routed to the persistent self-hosted dashboard API. Trusted automation writes immediately to the live feed with:

`POST https://deals.fluxology.ca/api/upsert`

using the deals-scoped bearer token.

See `services/dashboard-api/README.md` for the API contract and `docs/CADDY-INTEGRATION.md` for routing.

## Deal semantics

For weight-priced searches, `landedCadPerLb` means item price plus shipping, converted to CAD, divided by stated lot weight. Tax can be tracked separately with `allInCadPerLb`.

When destination shipping is not known, set `shippingResolved:false`. Proxy shipping must remain clearly labelled in `notes` / `calculation` and must not be presented as a resolved Toronto quote.

Historical purchased, rejected, ended, and expired records should be preserved when useful by changing `active` / `status` rather than silently deleting them.

The browser stores personal Watch / Saved / Purchased / Rejected workflow state and personal notes in `localStorage`; server-side writers never own those fields.

## Writer contract

A category skill should:

1. use stable listing IDs;
2. upsert only records it owns;
3. preserve records from other deal categories;
4. update `lastSeen` when actually checked;
5. update material listing fields when they change;
6. keep unresolved shipping explicitly unresolved;
7. leave browser-local workflow state untouched.

The checked-in JSON snapshot remains available as a GitHub intermediary/fallback, but routine production writes should use the direct upsert endpoint.
