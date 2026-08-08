# Fluxology Dashboard API

Self-hosted feed service for the three dashboard subdomains:

- `office.fluxology.ca`
- `deals.fluxology.ca`
- `jobs.fluxology.ca`

The service listens on **8082 inside Docker only**. It publishes no host port. The VPS's existing edge proxy must share the `fluxology-edge` Docker network and reverse-proxy the dashboard API routes to `fluxology-dashboard-api:8082`.

## Persistent data

The named volume mounted at `/data` contains:

- `office.json`
- `deals.json`
- `jobs.json`
- `audit.jsonl`

On the first start only, the service seeds those three feeds from the checked-in static snapshots under `public/*/data/listings.json`. After that, `/data` is authoritative. Rebuilding the website image does not overwrite live dashboard data.

The checked-in JSON files remain useful as local-development fixtures, disaster-recovery bootstrap data, and an optional GitHub-intermediary path.

## Endpoints

Internally the API exposes:

- `GET /health`
- `GET /v1/office/feed`
- `GET /v1/deals/feed`
- `GET /v1/jobs/feed`
- `POST /v1/{office|deals|jobs}/upsert`
- `PUT /v1/{office|deals|jobs}/feed`

The recommended public mapping makes the API same-origin on each dashboard subdomain:

- `GET https://office.fluxology.ca/data/listings.json` -> office live feed
- `POST https://office.fluxology.ca/api/upsert` -> office upsert
- `GET https://deals.fluxology.ca/data/listings.json` -> deals live feed
- `POST https://deals.fluxology.ca/api/upsert` -> deals upsert
- `GET https://jobs.fluxology.ca/data/listings.json` -> jobs live feed
- `POST https://jobs.fluxology.ca/api/upsert` -> jobs upsert

The existing dashboard JavaScript already requests `./data/listings.json`, so no browser-side API credential is required and no cross-origin request is introduced.

## Authentication

Writes use separate bearer tokens for each category:

- `OFFICE_INGEST_TOKEN`
- `DEALS_INGEST_TOKEN`
- `JOBS_INGEST_TOKEN`

Generate each with at least 32 random bytes, for example:

```bash
openssl rand -hex 32
```

Store the real values only in the VPS `.env` file. Never put them in frontend JavaScript or commit them to Git.

Example direct upsert:

```bash
curl -X POST https://deals.fluxology.ca/api/upsert \
  -H "Authorization: Bearer $DEALS_INGEST_TOKEN" \
  -H "X-Fluxology-Source: bulk-lego-skill" \
  -H "Content-Type: application/json" \
  --data '{"listings":[{"id":"ebay-123","itemId":"123","category":"Bulk LEGO","title":"Example lot","listingType":"auction"}]}'
```

An upsert shallow-merges each incoming listing into the existing record with the same stable `id`. Unspecified fields are preserved. For Deals, if `id` is omitted but `itemId` is supplied, the API derives `ebay-ITEMID`.

Office upserts automatically preserve `priceHistory` and append a new observation when `askingRent` or `estimatedAllInMonthly` changes.

## Full replacement

`PUT /api/feed` on the public dashboard hostname maps to `PUT /v1/<scope>/feed` internally and replaces the complete feed. This is intentionally more destructive than upsert and is mainly for restoration/import operations.

Prefer `POST /api/upsert` for routine skill runs.

## Audit log

Every successful write appends one line to `/data/audit.jsonl`, recording:

- timestamp
- dashboard scope
- operation
- `X-Fluxology-Source`
- client IP reported by the trusted edge proxy
- changed IDs for upserts

The audit log does not store bearer tokens or entire request bodies.

## Backup

```bash
docker compose exec -T dashboard-api tar czf - -C /data . > dashboard-data-$(date +%F).tar.gz
```

The `dashboard_data` volume is non-reproducible production state and should be backed up with the inquiry volume.
