# Docker Application Stack Reference

This repository builds the Fluxology **application** containers. The VPS edge proxy is managed independently and is not part of this Compose project.

For first deployment and operations, use [`docs/DEPLOYMENT-VPS.md`](./docs/DEPLOYMENT-VPS.md). For the edge routing blocks, use [`docs/CADDY-INTEGRATION.md`](./docs/CADDY-INTEGRATION.md).

## Runtime architecture

`docker-compose.yml` defines three containers:

| Service | Container | Internal port | Host port |
|---|---|---:|---|
| `apache` | `fluxology-apache` | 6080 | none |
| `contact-api` | `fluxology-contact-api` | 8081 | none |
| `dashboard-api` | `fluxology-dashboard-api` | 8082 | none |

All three join the external Docker network `fluxology-edge`. The VPS-wide Caddy container also joins that network and is the only component that publishes ports 80/443.

## Apache image

The root `Dockerfile` is a multi-stage build:

1. Node 22 builds the Astro/Svelte site with `npm run build`.
2. The generated `dist/` is copied into an Apache `httpd:2.4-alpine` image.
3. Apache listens internally on port 6080.

The site output is baked into the image; content changes require a rebuild:

```bash
docker compose up -d --build apache
```

The three static dashboard frontends are included in the normal Astro `public/` copy:

- `/office-scout/`
- `/deals/`
- `/jobs/`

The public subdomain mapping is performed by the external edge proxy.

## Contact API

`services/contact-api` is a Node 22 service on internal port 8081.

It handles:

- `POST /api/contact`
- `GET /api/health`

Valid inquiries are persisted to the `inquiry_data` named volume before success is returned. SMTP delivery is optional.

See `services/contact-api/README.md` for the complete contract.

## Dashboard API

`services/dashboard-api` is a dependency-free Node 22 service on internal port 8082.

It provides persistent live feeds for:

- office search;
- deals/shopping;
- jobs.

The `dashboard_data` volume contains the authoritative live JSON plus an audit log. On first creation it is seeded from the checked-in dashboard JSON snapshots.

Public dashboard pages still request `/data/listings.json`; the edge proxy maps that path to the appropriate live API feed. Trusted skills/automation write through category-scoped `/api/upsert` endpoints.

See `services/dashboard-api/README.md`.

## Docker network

The application stack expects this pre-existing network:

```bash
docker network create fluxology-edge
```

The external Caddy container must be attached to it:

```bash
docker network connect fluxology-edge <caddy-container-name>
```

Compose declares the network as external, so it is not deleted with the application stack.

## Volumes

| Volume | Data | Backup priority |
|---|---|---|
| `fluxology_inquiry_data` | contact-form `inquiries.jsonl` | critical |
| `fluxology_dashboard_data` | office/deals/jobs live feeds + `audit.jsonl` | critical |

Both contain non-reproducible production state.

## Logs

```bash
docker compose logs -f apache
docker compose logs -f contact-api
docker compose logs -f dashboard-api
```

Each service uses Docker JSON log rotation at 10 MB × 3 files. That covers
**container stdout/stderr only**. The two append-only data files inside the
volumes — `/data/audit.jsonl` (dashboard writes) and `/data/inquiries.jsonl`
(contact submissions) — are not logs in that sense and are not rotated,
capped or pruned by anything. They are data: back them up (see
`docs/DEPLOYMENT-VPS.md` section 10) rather than expecting them to be
recycled. At current write rates they grow by roughly 150 bytes per feed
write, so size is a bookkeeping matter, not an operational risk.

## Health checks

From inside the shared network, the services answer:

```text
http://fluxology-apache:6080/
http://fluxology-contact-api:8081/api/health
http://fluxology-dashboard-api:8082/health
http://fluxology-dashboard-api:8082/v1/{office|deals|jobs}/health
http://fluxology-mcp:8083/readyz
```

The per-scope dashboard route is what each dashboard's public `/api/health`
maps to, and what the edge's active health checks probe.

Public health requests are routed by the VPS edge config documented in `docs/CADDY-INTEGRATION.md`.

## Security boundary

- Application containers publish no host ports.
- The edge proxy is the only public network entrypoint.
- Dashboard reads are public; dashboard writes require separate office/deals/jobs bearer tokens.
- Tokens live in `.env` and trusted automation only.
- Frontend JavaScript contains no write credential.
- `dashboard-api` uses atomic writes and per-category write serialization.
