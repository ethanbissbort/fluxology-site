# External Caddy Integration

The Fluxology repository does **not** run Caddy. The VPS has one independent Caddy container that owns ports 80/443 and TLS for all hosted services.

The Fluxology application stack exposes no host ports. Caddy reaches these containers over one shared Docker bridge network:

- `fluxology-apache:6080`
- `fluxology-contact-api:8081`
- `fluxology-dashboard-api:8082`

## 1. Create the shared Docker network once

```bash
docker network create fluxology-edge
```

If it already exists, Docker will report that and no further action is required.

Attach the existing Caddy container to it once:

```bash
docker network connect fluxology-edge <your-existing-caddy-container-name>
```

The Fluxology `docker-compose.yml` declares `fluxology-edge` as an **external** network, so `docker compose down` will not remove it.

Verify connectivity:

```bash
docker network inspect fluxology-edge
```

You should see the Caddy container plus `fluxology-apache`, `fluxology-contact-api`, and `fluxology-dashboard-api` after the Fluxology stack is running.

## 2. Add these site blocks to the VPS Caddyfile

The exact location of the VPS-wide Caddyfile is outside this repository. Merge the following into that existing configuration rather than replacing unrelated site blocks.

```caddyfile
# -----------------------------------------------------------------------------
# Main Fluxology site
# -----------------------------------------------------------------------------
www.fluxology.ca {
    redir https://fluxology.ca{uri} permanent
}

fluxology.ca {
    encode zstd gzip

    # Contact form API. Keep /api/... intact because the service routes on it.
    handle /api/* {
        request_body {
            max_size 64KB
        }
        reverse_proxy fluxology-contact-api:8081
    }

    handle {
        reverse_proxy fluxology-apache:6080
    }
}

# -----------------------------------------------------------------------------
# Office dashboard
# -----------------------------------------------------------------------------
office.fluxology.ca {
    encode zstd gzip

    # Existing browser code asks for ./data/listings.json. Serve that path from
    # the live persistent dashboard API rather than the static bootstrap file.
    handle /data/listings.json {
        rewrite * /v1/office/feed
        reverse_proxy fluxology-dashboard-api:8082
    }

    # Public write surface used by a trusted skill/connector.
    # /api/upsert -> /v1/office/upsert
    # /api/feed   -> /v1/office/feed
    # /api/health -> /v1/office/health
    handle_path /api/* {
        request_body {
            max_size 1MB
        }
        rewrite * /v1/office{uri}
        reverse_proxy fluxology-dashboard-api:8082
    }

    handle {
        rewrite * /office-scout{uri}
        reverse_proxy fluxology-apache:6080
    }
}

# -----------------------------------------------------------------------------
# Deals dashboard
# -----------------------------------------------------------------------------
deals.fluxology.ca {
    encode zstd gzip

    handle /data/listings.json {
        rewrite * /v1/deals/feed
        reverse_proxy fluxology-dashboard-api:8082
    }

    handle_path /api/* {
        request_body {
            max_size 1MB
        }
        rewrite * /v1/deals{uri}
        reverse_proxy fluxology-dashboard-api:8082
    }

    handle {
        rewrite * /deals{uri}
        reverse_proxy fluxology-apache:6080
    }
}

# -----------------------------------------------------------------------------
# Jobs dashboard
# -----------------------------------------------------------------------------
jobs.fluxology.ca {
    encode zstd gzip

    handle /data/listings.json {
        rewrite * /v1/jobs/feed
        reverse_proxy fluxology-dashboard-api:8082
    }

    handle_path /api/* {
        request_body {
            max_size 1MB
        }
        rewrite * /v1/jobs{uri}
        reverse_proxy fluxology-dashboard-api:8082
    }

    handle {
        rewrite * /jobs{uri}
        reverse_proxy fluxology-apache:6080
    }
}
```

The dashboard API itself returns `Cache-Control: no-store` and does not emit CORS headers. Reads and writes are deliberately same-origin on each dashboard hostname.

## 3. Validate and reload the existing Caddy container

Use the actual container name and Caddyfile path from the VPS-wide Caddy deployment:

```bash
docker exec <caddy-container> caddy validate --config /etc/caddy/Caddyfile
docker exec <caddy-container> caddy reload --config /etc/caddy/Caddyfile
```

If that deployment mounts the file elsewhere, use its real path.

## 4. Verify routing

After the Fluxology stack is up:

```bash
curl -fsS https://fluxology.ca/api/health
curl -fsS https://office.fluxology.ca/api/health
curl -fsS https://deals.fluxology.ca/api/health
curl -fsS https://jobs.fluxology.ca/api/health

curl -fsS https://office.fluxology.ca/data/listings.json | jq '.listings | length'
curl -fsS https://deals.fluxology.ca/data/listings.json | jq '.listings | length'
curl -fsS https://jobs.fluxology.ca/data/listings.json | jq '.listings | length'
```

The three dashboard health responses include `writeEnabled`. It must be `true` after the corresponding ingest token is configured in `.env` and the dashboard API container is recreated.

## 5. Direct-write tests

```bash
curl -X POST https://deals.fluxology.ca/api/upsert \
  -H "Authorization: Bearer $DEALS_INGEST_TOKEN" \
  -H "X-Fluxology-Source: manual-test" \
  -H "Content-Type: application/json" \
  --data '{"listings":[{"id":"test-direct-push","category":"Test","title":"Direct push test","listingType":"buy_it_now","active":false}]}'
```

Then verify it appears in the live feed and remove or supersede the test record with a normal upsert. Routine writers should use stable IDs and should not use full-feed replacement unless performing a controlled restore.

## 6. Security boundary

- Only the VPS-wide Caddy container publishes 80/443.
- Fluxology containers publish **no** host ports.
- Read endpoints are public because the dashboards are public.
- Write endpoints require a category-scoped bearer token.
- Use a different token for office, deals, and jobs.
- Never expose those tokens in dashboard JavaScript, static JSON, Git history, screenshots, or browser local storage.
- The dashboard API limits request bodies and serializes writes per category before performing atomic file replacement.
