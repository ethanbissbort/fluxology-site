# Fluxology Inc. Website

Self-hosted corporate website and research-dashboard stack for Fluxology Inc.

The public corporate site is a static Astro + Svelte build. A small contact API handles inquiries, and a separate dashboard API provides persistent live data for office-search, shopping/deal, and job-search dashboards.

## Public applications

- `https://fluxology.ca/` — corporate site
- `https://office.fluxology.ca/` — Office Scout
- `https://deals.fluxology.ca/` — Deals / shopping searches
- `https://jobs.fluxology.ca/` — T176 / trades job search
- `https://mcp.fluxology.ca/mcp` — MCP connector (authenticated; not a browser endpoint)

## Corporate site

The main site is built with:

- Astro 7 static output
- Svelte 5 interactive islands
- TypeScript
- `astro:fonts` with self-hosted build-time font assets
- `astro:assets` image optimization
- `@astrojs/sitemap`

The four planned operating lines remain:

1. Fluxology Fabrication & Welding
2. Fluxology 3D Lab
3. Fluxology Greenhouse
4. Fluxology Orchard & Food Forest

## Production architecture

The VPS has one independently managed Caddy container that owns ports 80/443 and TLS for all hosted services. It is **not** part of this repository's Compose project.

This repository runs three internal-only containers:

```text
existing VPS Caddy
      │
      └── Docker network: fluxology-edge
            ├── fluxology-apache:6080
            │     static Astro site + dashboard frontend files
            │
            ├── fluxology-contact-api:8081
            │     contact form -> persistent inquiry log + optional SMTP
            │
            ├── fluxology-dashboard-api:8082
            │     office/deals/jobs live feeds + authenticated direct writes
            │
            └── fluxology-mcp:8083
                  authenticated MCP write bridge for approved model clients
```

No Fluxology application container publishes a host port.

See [`docs/CADDY-INTEGRATION.md`](./docs/CADDY-INTEGRATION.md) for the site blocks that must be merged into the VPS-wide Caddy configuration, and [`docs/MCP-CONNECTOR.md`](./docs/MCP-CONNECTOR.md) for the MCP connector's authorization model and deployment steps.

## Dashboard architecture

Three independent static dashboard frontends live under `public/`:

```text
public/
├── office-scout/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── data/
├── deals/
│   ├── index.html
│   ├── app.js
│   ├── styles.css
│   └── data/
└── jobs/
    ├── index.html
    ├── app.js
    ├── styles.css
    └── data/
```

The checked-in `data/listings.json` files are bootstrap/local-development snapshots. In production, each dashboard's request for `/data/listings.json` is intercepted by the VPS edge proxy and served from `fluxology-dashboard-api` persistent storage.

Preferred production write flow:

```text
category skill / trusted automation
        ↓ authenticated upsert
self-hosted dashboard API
        ↓ atomic persistent JSON
open dashboard tab
        ↓ hourly refresh
new/changed cards appear
```

Direct write endpoints:

- `POST https://office.fluxology.ca/api/upsert`
- `POST https://deals.fluxology.ca/api/upsert`
- `POST https://jobs.fluxology.ca/api/upsert`

Each category uses a separate bearer token. Tokens are server-side secrets and never appear in public frontend code.

GitHub JSON remains available as a fallback/intermediary when a particular automation runtime cannot call the direct-write tool.

See [`docs/DASHBOARDS-V3.md`](./docs/DASHBOARDS-V3.md) and [`services/dashboard-api/README.md`](./services/dashboard-api/README.md).

## Personal dashboard state

Curated research data lives in the server feed. Personal workflow data intentionally stays in browser `localStorage`:

- Office: Saved / Contacted / Tour Booked / Rejected / Leased
- Deals: Watch / Saved / Purchased / Rejected
- Jobs: Saved / Applied / Interview / Rejected / Offer

This prevents scheduled research updates from overwriting personal notes or acquisition/application state.

## Application services

### Apache

The root `Dockerfile` compiles Astro in a Node 22 build stage and copies the generated static output into `httpd:2.4-alpine`. Apache listens internally on 6080.

### Contact API

`services/contact-api` is a small Node 22 service on internal port 8081.

- `POST /api/contact`
- `GET /api/health`
- persistent JSONL inquiry log
- optional SMTP notification

See [`services/contact-api/README.md`](./services/contact-api/README.md).

### Dashboard API

`services/dashboard-api` is a dependency-free Node 22 service on internal port 8082.

It maintains:

```text
/data/office.json
/data/deals.json
/data/jobs.json
/data/audit.jsonl
```

The `dashboard_data` named volume is authoritative production state after first initialization. First start seeds it from the checked-in dashboard snapshots.

The API supports public reads plus authenticated category-scoped upsert/full-feed restore operations.

## Local development

Requirements:

- Node.js >= 22.12
- npm

```bash
npm ci
npm run dev
```

Production build:

```bash
npm run build
npm run preview
```

The dashboard frontends are plain static applications under `public/`; when running without the dashboard API they read their checked-in JSON snapshots.

## VPS deployment

The existing VPS edge proxy must share an external Docker network with the application containers.

One-time network setup:

```bash
docker network create fluxology-edge
docker network connect fluxology-edge <existing-caddy-container-name>
```

Configure `.env`:

```bash
cp .env.example .env
chmod 600 .env
```

Generate independent dashboard write tokens with `openssl rand -hex 32`, then set:

```dotenv
OFFICE_INGEST_TOKEN=...
DEALS_INGEST_TOKEN=...
JOBS_INGEST_TOKEN=...
```

Start/update the application stack:

```bash
docker compose up -d --build
```

Detailed instructions:

- [`docs/DEPLOYMENT-VPS.md`](./docs/DEPLOYMENT-VPS.md) — operator guide
- [`docs/CADDY-INTEGRATION.md`](./docs/CADDY-INTEGRATION.md) — VPS-wide edge routing
- [`DOCKER-DEPLOYMENT.md`](./DOCKER-DEPLOYMENT.md) — container reference

## Persistent data and backups

Two named volumes contain non-reproducible state:

- `fluxology_inquiry_data` — contact-form inquiries
- `fluxology_dashboard_data` — live dashboard feeds and write audit log

Back both up. Do not run `docker compose down -v` unless permanent deletion is intentional.

## Repository structure

```text
fluxology-site/
├── astro.config.mjs
├── package.json
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── docker/apache/
├── services/
│   ├── contact-api/
│   └── dashboard-api/
├── docs/
│   ├── DEPLOYMENT-VPS.md
│   ├── CADDY-INTEGRATION.md
│   └── DASHBOARDS-V3.md
├── src/
│   ├── pages/
│   ├── components/
│   ├── layouts/
│   ├── data/
│   ├── assets/
│   └── styles/
├── public/
│   ├── office-scout/
│   ├── deals/
│   ├── jobs/
│   └── images/
└── scripts/
```
