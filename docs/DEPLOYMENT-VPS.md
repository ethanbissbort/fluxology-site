# VPS Deployment Guide

This is the primary operator guide for the self-hosted Fluxology site and its three research dashboards.

## Architecture

The Fluxology repository runs four application containers:

```text
VPS-wide Caddy container (managed separately)
        │
        └── Docker network: fluxology-edge
              ├── fluxology-apache:6080
              ├── fluxology-contact-api:8081
              ├── fluxology-dashboard-api:8082
              └── fluxology-mcp:8083
```

The application containers publish no host ports. The existing VPS Caddy container owns public HTTP/HTTPS and reverse-proxies to them over `fluxology-edge`.

Production hostnames:

- `fluxology.ca`
- `www.fluxology.ca`
- `office.fluxology.ca`
- `deals.fluxology.ca`
- `jobs.fluxology.ca`
- `mcp.fluxology.ca` — MCP connector, see [`MCP-CONNECTOR.md`](./MCP-CONNECTOR.md)

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

**`MCP_OAUTH_ISSUER` is required — the `mcp` service refuses to start without it.** It is the only variable in the stack with no usable default: the connector is write-capable, so it fails closed rather than guessing an identity provider. Set it to the HTTPS issuer URL of the authorization server that will mint tokens for your model client:

```dotenv
MCP_OAUTH_ISSUER=https://auth.example.com
```

The issuer must serve RFC 8414 metadata at `/.well-known/oauth-authorization-server` and a JWKS the connector can reach from inside the container. See [`MCP-CONNECTOR.md`](./MCP-CONNECTOR.md) for the full variable set (audience, allowed origins, rate limits).

If you are not deploying the connector yet, leave it out and stop the service explicitly — `docker compose up -d --scale mcp=0` — rather than letting it crash-loop unnoticed behind three healthy containers.

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
docker compose logs --tail=100 mcp
```

The dashboard API should log that office, deals, and jobs writes are enabled once all three tokens are set.

Check all four containers, not three. `docker compose ps` must show every service healthy: a crash-looping `mcp` is easy to miss beside three green containers, and its most likely cause is a missing or unreachable `MCP_OAUTH_ISSUER` (the log line says so explicitly).

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

# MCP connector. /healthz is liveness and needs no credentials; /readyz also
# reports whether the authorization server is reachable.
curl -fsS https://mcp.fluxology.ca/healthz | jq .
curl -fsS https://mcp.fluxology.ca/readyz | jq .
curl -fsS https://mcp.fluxology.ca/.well-known/oauth-protected-resource | jq .
```

Each dashboard health endpoint should report `writeEnabled: true`. Those public
paths map to `/v1/{scope}/health` on the dashboard API — that route is also what
the edge's active health check probes, so do not repoint either at `/health`.

Check the edge headers too. Both of these are emitted only by the Caddy blocks
in `docs/CADDY-INTEGRATION.md`; if either is missing, that config was merged
incompletely:

```bash
# Must print the header. Apache is forbidden from setting it, so if the edge
# does not, nobody does.
for h in fluxology.ca office.fluxology.ca deals.fluxology.ca jobs.fluxology.ca; do
  printf '%-24s ' "$h"
  curl -fsSI "https://$h/" | grep -i strict-transport-security || echo 'MISSING'
done

# Must print request lines. This is the only per-request record in the stack
# for /api/* and /data/listings.json.
curl -fsS https://fluxology.ca/api/health > /dev/null
docker logs --since 1m <caddy-container> | tail -5
```

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

Both archives are written by `tar czf -C /data .`, so they contain the volume's contents at the top level (`./inquiries.jsonl`, or `./office.json ./deals.json ./jobs.json ./audit.jsonl`) — not a wrapping directory. That matters for the restore below.

## 11. Restoring from a backup

A backup you have never restored is a guess. This section is the matching half of section 10; rehearse it before you need it.

### What each restore path can and cannot do

| Artifact | Restore path |
| --- | --- |
| `office.json` / `deals.json` / `jobs.json` | `tar xzf` into the volume (below), or `PUT /v1/{scope}/feed` for a single feed |
| `audit.jsonl` | `tar xzf` **only** — no API route writes it |
| `inquiries.jsonl` | `tar xzf` **only** — contact-api serves just `/api/contact` and `/api/health`; there is no read or write route for the log |

`PUT /v1/{scope}/feed` is a **full replacement**, not a merge: the stored envelope becomes exactly the body you send. Sending `{"schemaVersion":"2.5","listings":[…]}` silently drops `hardAllInCeilingCad`, `appVersion` and `searchName` — the server answers `200 {"ok":true}` and nothing tells you the metadata is gone. If you use it to restore, send the whole envelope from the backup, not just the listings:

```bash
# Correct: replay the complete stored envelope out of a backup archive.
tar xzOf dashboard-data-2026-08-01.tar.gz ./office.json |
  curl -fsS -X PUT https://office.fluxology.ca/api/feed \
    -H "Authorization: Bearer $OFFICE_INGEST_TOKEN" \
    -H 'Content-Type: application/json' --data-binary @-
```

### Full volume restore

Files inside these volumes are mode `0600` and owned by uid/gid `1000` (the `node` user in both service images). `tar` run as root recreates that ownership from the archive, but only if the container is not holding the files open — so stop the service first.

```bash
# 1. Stop the service that owns the volume (leave the rest of the stack up).
docker compose stop dashboard-api          # or: contact-api

# 2. Extract into the volume. --same-owner is the default for root and is what
#    puts the files back as uid 1000; without it they land as root and the
#    service (which runs as `node`) cannot write them.
docker run --rm \
  -v fluxology_dashboard_data:/data \
  -v "$PWD":/backup alpine \
  tar xzf /backup/dashboard-data-2026-08-01.tar.gz -C /data

# 3. Confirm ownership and mode BEFORE restarting.
docker run --rm -v fluxology_dashboard_data:/data alpine ls -ln /data
#    Expect: -rw------- 1 1000 1000 ... office.json (etc.)
#    If they came back as 0:0, fix them:
#      docker run --rm -v fluxology_dashboard_data:/data alpine \
#        sh -c 'chown -R 1000:1000 /data && chmod 600 /data/*'

# 4. Restart and verify.
docker compose start dashboard-api
```

The same three steps restore `fluxology_inquiry_data` for `contact-api`; the file there is `inquiries.jsonl`.

### Verify the restore

Do not treat a restore as finished until these agree with the backup you restored:

```bash
# Listing counts per feed, live through the edge.
for h in office deals jobs; do
  printf '%s: ' "$h"
  curl -fsS "https://$h.fluxology.ca/data/listings.json" | jq '.listings | length'
done

# The same counts straight out of the archive, for comparison.
for s in office deals jobs; do
  printf '%s: ' "$s"
  tar xzOf dashboard-data-2026-08-01.tar.gz "./$s.json" | jq '.listings | length'
done

# Envelope metadata survived (this is what a careless PUT restore loses).
curl -fsS https://office.fluxology.ca/data/listings.json |
  jq '{schemaVersion, appVersion, searchName, generatedAt, hardAllInCeilingCad}'

# Inquiry count.
docker compose exec -T contact-api wc -l /data/inquiries.jsonl
```

### Restore drill

Run the whole procedure against a scratch volume roughly twice a year, and after any change to a service's data layout:

```bash
docker volume create restore-drill
docker run --rm -v restore-drill:/data -v "$PWD":/backup alpine \
  tar xzf /backup/dashboard-data-2026-08-01.tar.gz -C /data
docker run --rm -v restore-drill:/data alpine sh -c 'ls -ln /data && wc -l /data/audit.jsonl'
docker volume rm restore-drill
```

If that fails, the archive is not a backup. Find out on a drill, not during an outage.

### Deleting a single inquiry

There is no API for this; the log is append-only by design. To honour a deletion request, or to remove a test submission, filter the file in place with the service stopped:

```bash
docker compose stop contact-api
docker run --rm -v fluxology_inquiry_data:/data alpine sh -c '
  cp /data/inquiries.jsonl /data/inquiries.jsonl.bak &&
  grep -v "someone@example.com" /data/inquiries.jsonl.bak > /data/inquiries.jsonl &&
  chown 1000:1000 /data/inquiries.jsonl && chmod 600 /data/inquiries.jsonl &&
  wc -l /data/inquiries.jsonl.bak /data/inquiries.jsonl'
docker compose start contact-api
```

Check the two line counts differ by exactly the number of records you intended to remove, then delete `inquiries.jsonl.bak` — it still contains the data you were asked to erase.

## 12. Updating the website or APIs

```bash
git pull --ff-only
docker compose up -d --build
```

The Apache image contains the compiled Astro output, so code/content updates require rebuilding it. API code changes require rebuilding the corresponding service image.

Routine dashboard listing updates do **not** require `git pull`, a rebuild, or a restart when they arrive through the direct ingestion API.

## 13. Troubleshooting

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

Apache serves that fallback with `Cache-Control: no-cache`, so once the edge rule is restored the next load gets live data — the stale snapshot is revalidated, not reused. (It used to inherit a one-month `Expires`, which pinned the stale copy in every browser and intermediary for 30 days *after* the routing was fixed.) Confirm with:

```bash
curl -fsSI https://office.fluxology.ca/data/listings.json | grep -i cache-control
# live path  -> no-store   (answered by dashboard-api)
# fallback   -> no-cache   (answered by Apache; routing is still broken)
```

### A dashboard fix does not appear for a returning visitor

The three dashboards ship `app.js` and `styles.css` at unhashed paths, so their cache policy is set by filename, not by content hash. Apache serves them `Cache-Control: no-cache` — stored, but revalidated on every load — which is what makes an updated file take effect on the next page view. If a stale copy persists, check that policy first:

```bash
curl -fsSI https://office.fluxology.ca/app.js | grep -i cache-control   # expect: no-cache
curl -fsSI https://fluxology.ca/_assets/<hashed>.js | grep -i cache-control  # expect: immutable
```

If the first one reports `immutable`, the server-scope `<FilesMatch "\.(css|js)$">` rule in `docker/apache/httpd.conf` has been widened back to a year — that pins every dashboard asset for a year, on a manual reload too, and the symptom is invisible from a fresh browser profile.

### Inspect live data directly inside the API container

```bash
docker compose exec dashboard-api cat /data/office.json | jq .
docker compose exec dashboard-api cat /data/deals.json | jq .
docker compose exec dashboard-api cat /data/jobs.json | jq .
docker compose exec dashboard-api tail -n 20 /data/audit.jsonl | jq .
```
