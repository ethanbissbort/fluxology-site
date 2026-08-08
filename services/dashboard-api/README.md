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

On every start the service **parses** each feed instead of only checking that
the file exists. A file that is missing, empty, truncated or otherwise not a
valid feed envelope is renamed to `<name>.json.corrupt-<timestamp>` (never
deleted) and re-seeded from `/seed`, with a loud message on stderr. Stale
`*.tmp` files left by an interrupted write are swept at the same time.

## Endpoints

Internally the API exposes:

- `GET|HEAD /health`
- `GET|HEAD /v1/{office|deals|jobs}/health`
- `GET|HEAD /v1/office/feed`
- `GET|HEAD /v1/deals/feed`
- `GET|HEAD /v1/jobs/feed`
- `POST /v1/{office|deals|jobs}/upsert`
- `PUT /v1/{office|deals|jobs}/feed`

`HEAD` is answered wherever `GET` is, and `If-None-Match` is parsed as a real
etag list (`*`, `W/"…"` and comma-separated lists all match).

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

Store the real values only in the VPS `.env` file. Never put them in frontend JavaScript or commit them to Git. A token shorter than 32 characters is accepted but produces a warning on startup.

Every rejected credential is logged (scope, method, path, client IP, `X-Fluxology-Source`); the attempted token itself is never logged. Failed authentication is deliberately **not** written to `/data/audit.jsonl` — that file lives on the data volume, and letting an unauthenticated caller append to it would be a way to fill the disk.

There is no rate limiting on the write routes. With the documented 256-bit
tokens that is not the control that matters, and the edge configuration is
outside this repo; if a limiter is ever wanted it belongs at the edge, next to
the `request_body` cap that is already there.

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

### Listing rules

- `id` must be a string. It is Unicode-normalised (NFC) and must not contain control, format or zero-width characters, so `café` written two different ways is one record, not two.
- `itemId` (Deals only, when `id` is absent) must be a string or an integer. Anything else is rejected rather than `String()`-coerced — an object used to collapse every affected record onto `ebay-[object Object]`.
- A listing may not nest deeper than `MAX_LISTING_DEPTH` (default 64).
- A listing may not contain a key named `__proto__`, `prototype` or `constructor` at any depth.

## Full replacement

`PUT /api/feed` on the public dashboard hostname maps to `PUT /v1/<scope>/feed` internally and replaces the complete feed. This is intentionally more destructive than upsert and is mainly for restoration/import operations.

Prefer `POST /api/upsert` for routine skill runs.

`PUT` is bounded by `MAX_FULL_FEED_LISTINGS`, not by the per-write cap, and an upsert refuses to grow the stored feed past that same bound. The invariant is: **anything this service will store, a restore can put back.**

### Removing a record

There is no `DELETE` route. Prune by reading the feed, dropping the rows you
want gone, and replacing it:

```bash
curl -fsS https://deals.fluxology.ca/data/listings.json \
  | jq 'del(.listings[] | select(.id == "test-direct-push"))' \
  | curl -fsS -X PUT https://deals.fluxology.ca/api/feed \
      -H "Authorization: Bearer $DEALS_INGEST_TOKEN" \
      -H "X-Fluxology-Source: manual-prune" \
      -H "Content-Type: application/json" --data-binary @-
```

## Errors

Every error body is `{"error": "<code>"}` with a stable, machine-readable
code. Internal detail (filesystem paths, parser messages, errnos) goes to the
container log only, and the status code is chosen at the throw site rather
than by matching the error text.

| Code | Status | Meaning |
| --- | --- | --- |
| `not_found` | 404 | Unknown route or unknown scope |
| `method_not_allowed` | 405 | See the `Allow` header |
| `unauthorized` | 401 | Missing or wrong bearer token |
| `invalid_json` | 400 | Body is not JSON |
| `body_must_contain_listings_array` | 400 | Upsert body shape |
| `listing_must_be_object` | 400 | A row is not an object |
| `listing_id_required` / `listing_id_invalid` | 400 | Missing or unusable `id` |
| `itemId_must_be_string_or_integer` | 400 | Non-scalar `itemId` |
| `listing_too_deeply_nested` | 400 | Past `MAX_LISTING_DEPTH` |
| `listing_key_not_allowed` | 400 | `__proto__` / `prototype` / `constructor` |
| `full_feed_object_required` / `every_listing_requires_id` / `duplicate_listing_id` | 400 | `PUT` body problems |
| `payload_too_large` | 413 | Past `MAX_BODY_BYTES` |
| `too_many_listings` | 413 | Past `MAX_LISTINGS_PER_WRITE` (upsert) or `MAX_FULL_FEED_LISTINGS` (`PUT`) |
| `feed_capacity_exceeded` | 413 | The upsert would grow the feed past `MAX_FULL_FEED_LISTINGS` |
| `feed_changed_concurrently` | 409 | Another writer changed the feed mid-request; retry |
| `feed_unavailable` | 503 | The stored feed is missing or does not parse |
| `audit_write_failed` | 500 | The audit line could not be written, so nothing was committed |
| `write_failed` | 500 | The feed could not be written |
| `internal_error` | 500 | Unclassified |

## Health

Both health endpoints report `writeEnabled` as a **boolean** meaning "a write
to this endpoint's scope(s) could succeed right now" — the ingest token is
configured *and* the data volume is genuinely writable (proved by an actual
write probe, cached for 5 seconds).

`GET /health`:

```json
{
  "status": "ok",
  "service": "fluxology-dashboard-api",
  "uptimeSeconds": 42,
  "writeEnabled": true,
  "dataWritable": true,
  "scopes": {
    "office": { "writeEnabled": true, "tokenConfigured": true, "feedOk": true },
    "deals":  { "writeEnabled": true, "tokenConfigured": true, "feedOk": true },
    "jobs":   { "writeEnabled": true, "tokenConfigured": true, "feedOk": true }
  }
}
```

`GET /v1/{scope}/health`:

```json
{ "status": "ok", "scope": "deals", "writeEnabled": true, "tokenConfigured": true, "feedOk": true, "dataWritable": true }
```

Both return **503** with `"status": "degraded"` when the volume is not
writable or a feed does not parse, so the container healthcheck stops
reporting green while the store is broken.

## Durability

- Feed writes go to a temp file, are `fdatasync`ed, renamed into place, and the directory is fsynced. A failure at any step removes the temp file, so a failed write cannot leave a full-size orphan on the volume.
- The audit line is `fdatasync`ed too, and is written **before** the rename: an audit log that cannot be appended fails the request without committing the change, instead of committing it and answering 500.
- If the feed write then fails anyway, a compensating `*_failed` audit entry records the ids that did not land.
- An upsert refuses to overwrite a feed that changed between its read and its write (`409 feed_changed_concurrently`), so a second process on the same volume cannot silently discard an acknowledged write. Still: **run exactly one dashboard-api against `dashboard_data`.**
- `SIGTERM` drains in-flight writes before exiting, including requests whose client already hung up.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8082` | Listen port |
| `DATA_DIR` | `/data` | Authoritative feed storage |
| `SEED_DIR` | `/seed` | First-boot / repair snapshots |
| `MAX_BODY_BYTES` | `1048576` | Request body cap |
| `MAX_LISTINGS_PER_WRITE` | `500` | Rows per `POST /upsert` |
| `MAX_FULL_FEED_LISTINGS` | `50000` | Rows per `PUT /feed`, and the ceiling on stored feed size |
| `MAX_LISTING_DEPTH` | `64` | Maximum nesting inside one listing (hard ceiling 512) |
| `AUDIT_MAX_BYTES` | `5242880` | Rotate `audit.jsonl` past this size |
| `AUDIT_KEEP_FILES` | `3` | Rotated generations to keep |
| `TRUST_PROXY` | `true` | Honour `X-Forwarded-For` |

Every numeric variable is validated at startup. A value that is not a
positive integer (`MAX_BODY_BYTES=1MB`) is **ignored with a warning** and the
documented default is used — it never silently disables the limit, which is
what `Number('1MB') === NaN` combined with `size > NaN` used to do.

## Audit log

Every successful write appends one line to `/data/audit.jsonl`, recording:

- timestamp
- dashboard scope
- operation (`upsert`, `replace`, or `*_failed` for a write that did not land)
- `X-Fluxology-Source`
- client IP reported by the trusted edge proxy
- changed IDs for upserts, stored IDs for replaces (first 500, with `listingIdsTruncated`)

The audit log does not store bearer tokens or entire request bodies. It is
rotated at `AUDIT_MAX_BYTES` into `audit.jsonl.1` … `.N` so it cannot fill the
volume.

## Tests

```bash
cd services/dashboard-api
npm test
```

`node --test` spawns the real server over real HTTP for every case — startup
seeding and repair, the scope allowlist, conditional requests, id and depth
validation, config validation, restore bounds, corrupt and unwritable
volumes, audit ordering and rotation, fsync (via `strace`, skipped where it is
unavailable), shutdown draining and concurrent-writer safety. Ports 8300-8314
must be free.

## Backup

```bash
docker compose exec -T dashboard-api tar czf - -C /data . > dashboard-data-$(date +%F).tar.gz
```

The `dashboard_data` volume is non-reproducible production state and should be backed up with the inquiry volume.

Restore a single feed through the API with `PUT /v1/<scope>/feed` (see *Full
replacement*); `audit.jsonl` can only be restored by unpacking the tarball
into the volume.
