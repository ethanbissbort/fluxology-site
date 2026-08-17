# Fluxology Dashboard Architecture v3

Three independent dashboard frontends live in the main Fluxology repository and are exposed through dedicated subdomains.

| Category | Public URL | Static frontend | Live API scope |
|---|---|---|---|
| Office search | `https://office.fluxology.ca/` | `public/office-scout/` | `office` |
| Deals / shopping | `https://deals.fluxology.ca/` | `public/deals/` | `deals` |
| Jobs | `https://jobs.fluxology.ca/` | `public/jobs/` | `jobs` |

The frontends are static files served by the main Apache origin. The live listing feeds are served by the self-hosted `dashboard-api` service from persistent storage.

## Production data flow

Preferred path:

`ChatGPT category skill / trusted automation -> authenticated dashboard API -> persistent feed -> dashboard`

Each dashboard exposes a same-origin write endpoint through the VPS edge proxy:

- `POST https://office.fluxology.ca/api/upsert`
- `POST https://deals.fluxology.ca/api/upsert`
- `POST https://jobs.fluxology.ca/api/upsert`

Each category has its own bearer token. Write credentials live only in trusted automation/connector configuration and the VPS `.env`; they never appear in public frontend code.

The dashboards continue requesting `./data/listings.json`. In production, the edge proxy intercepts that exact path and serves the live persistent API feed. Therefore the browser code stays static and same-origin.

## Static JSON files

The checked-in files remain at:

- `public/office-scout/data/listings.json`
- `public/deals/data/listings.json`
- `public/jobs/data/listings.json`

They are **bootstrap snapshots**, not the authoritative production datastore after the dashboard API has initialized its persistent volume. They serve three purposes:

1. first-start seeding;
2. local frontend development without the API;
3. optional GitHub-intermediary/fallback workflows.

The authoritative live files are stored on the `dashboard_data` Docker volume as `office.json`, `deals.json`, and `jobs.json`.

## GitHub fallback

GitHub remains the automatic fallback when a scheduled skill runtime cannot call the authenticated direct-write tool.

Fallback path:

`skill -> GitHub snapshot JSON -> GitHub Actions feed bridge -> dashboard API -> dashboard`

The workflow is:

`.github/workflows/sync-dashboard-feeds.yml`

It watches only the three listing snapshot files. When one changes on `main`, the workflow extracts its `listings` array and calls that dashboard's `POST /api/upsert`. It does **not** replace the entire live feed, so API-only records are not deleted merely because they are absent from a repository snapshot.

Configure these GitHub repository secrets with the same values used by the VPS dashboard API:

- `OFFICE_INGEST_TOKEN`
- `DEALS_INGEST_TOKEN`
- `JOBS_INGEST_TOKEN`

The workflow can also be run manually with `workflow_dispatch`.

Routine production automation should prefer the direct write tool when available because it removes the intermediary hop. The GitHub bridge exists so currently supported scheduled skills can still update the live dashboard automatically.

## API merge behavior

Upserts merge by stable `id` and preserve unspecified fields.

- New records are added.
- Existing records are shallow-merged.
- Routine freshness timestamps do not automatically count as material listing changes.
- Office price history is preserved and receives a new observation when asking rent or estimated all-in monthly cost changes.
- Writes are serialized independently for office, deals, and jobs and committed with atomic file replacement.
- Successful writes append an audit entry to `/data/audit.jsonl`.

A full feed can be restored with authenticated `PUT /api/feed`, but routine skills should use upsert.

## Separation of research and personal workflow

The API feed contains curated research state. Personal workflow state remains browser-local and is not owned by scheduled tasks.

- Office: Saved / Contacted / Tour Booked / Rejected / Leased plus personal notes.
- Deals: Watch / Saved / Purchased / Rejected plus personal notes.
- Jobs: Saved / Applied / Interview / Rejected / Offer plus personal notes.

Writers must never invent or overwrite browser-local state.

## Skill ownership

Each major category has one primary ChatGPT skill that owns normalization rules for its feed. Sub-searches may share a category feed through stable IDs and explicit category/search labels.

- Office skill -> Office Scout schema and `/api/upsert` on `office.fluxology.ca`.
- Deals skill -> shopping schema and `/api/upsert` on `deals.fluxology.ca`.
- Jobs skill -> T176/trades job schema and `/api/upsert` on `jobs.fluxology.ca`.

For Deals, independent searches such as bulk LEGO and bulk minifigures must update only their own stable records and preserve other shopping categories.

## Runtime components

The Fluxology Compose project contains:

- `fluxology-apache` — static Astro site and dashboard shells, internal port 6080;
- `fluxology-contact-api` — contact form API, internal port 8081;
- `fluxology-dashboard-api` — dashboard feed/read/write service, internal port 8082;
- `fluxology-mcp` — authenticated MCP write bridge for model clients, internal port 8083.

All four join the external `fluxology-edge` Docker network and publish no host ports. The VPS-wide Caddy container is managed separately from this repository and joins the same network.

See:

- `services/dashboard-api/README.md` for API behavior and write examples;
- `docs/CADDY-INTEGRATION.md` for the external Caddy routing configuration;
- `docs/DEPLOYMENT-VPS.md` for deployment and backup procedures.
