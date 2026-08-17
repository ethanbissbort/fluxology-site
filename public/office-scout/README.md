# Fluxology Office Scout v2.5

Isolated static dashboard frontend for:

`https://office.fluxology.ca/`

Files:

- `index.html` — application shell
- `styles.css` — Office Scout UI
- `app.js` — filtering, workflow state, price history and hourly refresh
- `managed-watchlist.css` — managed-office provider watchlist styling
- `managed-watchlist.js` — managed-office provider research feed loader
- `data/listings.json` — checked-in bootstrap/local-development listing snapshot
- `data/schema.json` — listing feed contract
- `data/managed-providers.json` — managed-office provider watchlist, preliminary value scores and outreach priorities
The Fluxology Office & Mail MCP servers (research/scoring/outreach +
human-approved email) live at `tools/mcp/` at the repo root — deliberately
**outside this web-served tree**, so their source, tests and internal design
docs are never copied into the built site. See `tools/mcp/README.md`.

## Production feed

The frontend requests `./data/listings.json` every hour. On `office.fluxology.ca`, the VPS edge proxy routes `/data/listings.json` to the live self-hosted dashboard API, so production reads come from the persistent `dashboard_data` volume rather than the checked-in snapshot.

Trusted automation writes directly with:

`POST https://office.fluxology.ca/api/upsert`

using the office-scoped bearer token. See `services/dashboard-api/README.md` and `docs/CADDY-INTEGRATION.md`.

The managed-office provider watchlist is a separate research feed at `./data/managed-providers.json`. It is intentionally separate from individual office listing records because a provider/company profile persists while locations, offers and quotes change underneath it. Future dashboard API work should promote this feed into persistent provider/location/offer records without collapsing historical quote data.

## Features

- responsive card grid and detail view
- hourly listing-feed refresh and manual refresh
- managed-office provider watchlist with preliminary fit/value scores and outreach priority
- free-text search
- municipality and cost-status filters
- fit/newest/cost/walk sorting
- active/verified/needs-verification/new-changed counters
- strict verified / needs verification / over-budget distinction
- complete cost, access, rights, amenities, transit and research fields
- Fit score /100
- personal workflow states: Unreviewed, Saved, Contacted, Tour booked, Rejected, Leased
- browser-local personal notes
- export/import of personal workspace JSON
- Needs Cost Verification queue
- observed price-history sparklines and price-delta sorting
- recently-changed sorting

Personal workflow state stays in browser `localStorage` and is never part of the server feed.

## Writer contract

Routine listing writers should use the upsert API and:

1. merge by stable `id`;
2. preserve old/inactive records unless there is an explicit reason to change them;
3. update `lastVerified` only when actually checked;
4. keep unknown mandatory costs unknown;
5. never classify an office as verified unless all mandatory recurring costs are known and included in the all-in amount;
6. preserve price history; the API also appends a price observation when asking rent or all-in cost changes;
7. leave browser-local workflow state alone.

Managed-office research should preserve provider identity separately from location and quote history. Do not overwrite a prior advertised or negotiated quote when terms change; retain dated observations so the dashboard can learn provider discounting and fee behaviour over time.

The checked-in listing JSON file is a bootstrap snapshot and fallback transport, not the authoritative live production feed after the API volume has initialized.
