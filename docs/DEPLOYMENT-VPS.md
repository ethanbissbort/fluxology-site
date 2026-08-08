# VPS Deployment Guide

This is the primary operator guide for the self-hosted Fluxology site and its three research dashboards.

## Architecture

The Fluxology repository runs three application containers:

```text
VPS-wide Caddy container (managed separately)
        │
        └── Docker network: fluxology-edge
              ├── fluxology-apache:6080
              ├── fluxology-contact-api:8081
              └── fluxology-dashboard-api:8082
```

The application containers publish no host ports. The existing VPS Caddy container owns public HTTP/HTTPS and reverse-proxies to them over `fluxology-edge`.

Production hostnames:

- `fluxology.ca`
- `www.fluxology.ca`
- `office.fluxology.ca`
- `deals.fluxology.ca`
- `jobs.fluxology.ca`

DNS is managed independently from this repository.

## 1. Prerequisites

- Docker Engine and Compose v2
- the VPS-wide Caddy container already running
- ports 80/tcp and 443/tcp available to that existing edge container
- the repository checked out on the VPS
- DNS records for the required hostnames pointing at the VPS

## 2. Create the shared Docker network

Run once:

```bash
docker network create fluxology-edge
```

Attach the existing Caddy container once:

```bash
docker network connect fluxology-edge <caddy-container-name>
```

If it is already connected, do not repeat the command.

The Fluxology Compose project declares this network as external and will not remove it.

## 3. Configure environment secrets

```bash
cp .env.example .env
chmod 600 .env
```

Generate three independent dashboard write tokens:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
```

Put them into:

```dotenv
OFFICE_INGEST_TOKEN=...
DEALS_INGEST_TOKEN=...
JOBS_INGEST_TOKEN=...
```

These are server-side credentials. Never put them in public JavaScript, dashboard JSON, Git history, or browser storage.

Contact-form SMTP variables remain optional. With `SMTP_HOST` unset, valid inquiries are still written to the persistent inquiry log.

## 4. Build and start the application stack

```bash
git pull --ff-only
docker compose up -d --build
```

Check:

```bash
docker compose ps
docker compose logs --tail=100 apache
docker compose logs --tail=100 contact-api
docker compose logs --tail=100 dashboard-api
```

The dashboard API should log that office, deals, and jobs writes are enabled once all three tokens are set.

## 5. Configure the existing Caddy container

This repository does not own the VPS Caddyfile.

Merge the site blocks from:

[`docs/CADDY-INTEGRATION.md`](./CADDY-INTEGRATION.md)

into the VPS-wide Caddy configuration, then validate and reload that existing container.

The important routing behavior is:

- `fluxology.ca` -> Apache, except `/api/*` -> contact API;
- `office.fluxology.ca` -> `/office-scout/` static app;
- `deals.fluxology.ca` -> `/deals/` static app;
- `jobs.fluxology.ca` -> `/jobs/` static app;
- each dashboard's `/data/listings.json` -> its persistent live feed in dashboard-api;
- each dashboard's `/api/*` -> its category-scoped dashboard API routes.

## 6. Verify the live services

```bash
curl -fsSI https://fluxology.ca/ | head
curl -fsS https://fluxology.ca/api/health | jq .

curl -fsS https://office.fluxology.ca/api/health | jq .
curl -fsS https://deals.fluxology.ca/api/health | jq .
curl -fsS https://jobs.fluxology.ca/api/health | jq .

curl -fsS https://office.fluxology.ca/data/listings.json | jq '.listings | length'
curl -fsS https://deals.fluxology.ca/data/listings.json | jq '.listings | length'
curl -fsS https://jobs.fluxology.ca/data/listings.json | jq '.listings | length'
```

Each dashboard health endpoint should report `writeEnabled: true`.

## 7. Direct dashboard ingestion

Routine automation should use `POST /api/upsert` on the relevant subdomain.

Example:

```bash
curl -X POST https://deals.fluxology.ca/api/upsert \
  -H "Authorization: Bearer $DEALS_INGEST_TOKEN" \
  -H "X-Fluxology-Source: bulk-lego-skill" \
  -H "Content-Type: application/json" \
  --data @payload.json
```

Payload shape:

```json
{
  "listings": [
    {
      "id": "ebay-123456789",
      "itemId": "123456789",
      "category": "Bulk LEGO",
      "title": "Example lot",
      "listingType": "auction"
    }
  ]
}
```

The API merges by stable ID and writes the authoritative live feed immediately. No site rebuild is required for a feed update.

Full-feed replacement is available as authenticated `PUT /api/feed`, primarily for controlled restore/import operations.

## 8. Dashboard persistence

The `dashboard_data` named volume contains:

```text
/data/office.json
/data/deals.json
/data/jobs.json
/data/audit.jsonl
```

On first creation, those feeds are seeded from the checked-in JSON snapshots in `public/*/data/listings.json`. After initialization, the volume is authoritative.

The checked-in files remain useful for local development and as a fallback/intermediary, but rebuilding the site does not overwrite the live volume.

## 9. Reading contact inquiries

```bash
docker compose exec -T contact-api cat /data/inquiries.jsonl | jq .
```

Recent inquiries:

```bash
docker compose exec -T contact-api tail -n 10 /data/inquiries.jsonl | jq .
```

Until SMTP is enabled, this persistent log is the authoritative copy of contact-form submissions.

## 10. Backups

Back up both non-reproducible volumes.

### Contact inquiries

```bash
docker run --rm \
  -v fluxology_inquiry_data:/data:ro \
  -v "$PWD":/backup alpine \
  tar czf "/backup/inquiries-$(date +%F).tar.gz" -C /data .
```

### Dashboard feeds and audit log

```bash
docker run --rm \
  -v fluxology_dashboard_data:/data:ro \
  -v "$PWD":/backup alpine \
  tar czf "/backup/dashboard-data-$(date +%F).tar.gz" -C /data .
```

Do not use `docker compose down -v` unless you explicitly intend to destroy persistent inquiry and dashboard data.

## 11. Updating the website or APIs

```bash
git pull --ff-only
docker compose up -d --build
```

The Apache image contains the compiled Astro output, so code/content updates require rebuilding it. API code changes require rebuilding the corresponding service image.

Routine dashboard listing updates do **not** require `git pull`, a rebuild, or a restart when they arrive through the direct ingestion API.

## 12. Troubleshooting

### Caddy cannot reach an application container

Verify all containers share `fluxology-edge`:

```bash
docker network inspect fluxology-edge
```

The inspection output must include the external Caddy container and the three Fluxology application containers.

### Dashboard reads work but writes return 401

Check that the correct category token is set in `.env`, then recreate the API container:

```bash
docker compose up -d --force-recreate dashboard-api
```

Do not print production tokens into shared logs or chat transcripts.

### Dashboard returns the checked-in snapshot instead of live data

The edge configuration is not intercepting `/data/listings.json`. Re-check the dashboard blocks in `docs/CADDY-INTEGRATION.md` and reload the VPS-wide Caddy container.

### Inspect live data directly inside the API container

```bash
docker compose exec dashboard-api cat /data/office.json | jq .
docker compose exec dashboard-api cat /data/deals.json | jq .
docker compose exec dashboard-api cat /data/jobs.json | jq .
docker compose exec dashboard-api tail -n 20 /data/audit.jsonl | jq .
```
