# Fluxology Development Ground Truth

**Project:** Fluxology Inc. Website
**Stack:** Astro 7 static output + Svelte 5 islands + TypeScript
**Production:** self-hosted on the company's VPS
**Last architecture refresh:** August 2026

This file is the concise technical ground truth for AI assistants and developers. Read the repository before changing architecture; do not reconstruct old deployment patterns from memory.

## Deployment ground truth

The VPS already has one independently managed **Caddy** container that owns public ports 80/443 and TLS for multiple services. **Caddy is not part of this repository's Compose project.**

The Fluxology repository runs three application containers only:

```text
existing VPS Caddy
      │
      └── external Docker network: fluxology-edge
            ├── fluxology-apache:6080
            ├── fluxology-contact-api:8081
            └── fluxology-dashboard-api:8082
```

Rules:

- Never add a Caddy service to `docker-compose.yml`.
- Never publish Apache, contact-api, or dashboard-api ports to the host.
- The existing Caddy container and all three Fluxology containers must share `fluxology-edge`.
- Caddy configuration for Fluxology is documented as integration instructions in `docs/CADDY-INTEGRATION.md`; the actual VPS-wide Caddyfile lives outside this repository.
- Do not put TLS certificates or ACME state in this repository or its Compose volumes.
- Never run/recommend `docker compose down -v` casually: it destroys non-reproducible inquiry and dashboard data.

Primary deployment docs:

- `docs/DEPLOYMENT-VPS.md`
- `docs/CADDY-INTEGRATION.md`
- `DOCKER-DEPLOYMENT.md`

## Runtime services

### `fluxology-apache`

Built from the root `Dockerfile`. Node 22 compiles the static Astro site; the final image is Apache and listens internally on 6080.

The image also contains the isolated static dashboard frontends copied from `public/`:

- `/office-scout/`
- `/deals/`
- `/jobs/`

### `fluxology-contact-api`

Source: `services/contact-api/`.

Internal port: 8081.

Endpoints:

- `POST /api/contact`
- `GET /api/health`

Valid inquiries are persisted to `/data/inquiries.jsonl` on the `inquiry_data` named volume before success is returned. SMTP notification is optional and must not replace local persistence.

The contact form remains same-origin. The honeypot field is `website`.

### `fluxology-dashboard-api`

Source: `services/dashboard-api/`.

Internal port: 8082.

Persistent volume: `dashboard_data`.

Files:

```text
/data/office.json
/data/deals.json
/data/jobs.json
/data/audit.jsonl
```

The API is the authoritative production feed store after first initialization. It seeds itself from the checked-in dashboard JSON snapshots only when the corresponding live file does not yet exist.

Internal endpoints:

- `GET /health`
- `GET /v1/{office|deals|jobs}/feed`
- `POST /v1/{office|deals|jobs}/upsert`
- `PUT /v1/{office|deals|jobs}/feed`

Writes require a category-scoped bearer token:

- `OFFICE_INGEST_TOKEN`
- `DEALS_INGEST_TOKEN`
- `JOBS_INGEST_TOKEN`

Never put those credentials in public JavaScript, checked-in JSON, screenshots, documentation examples with real values, or browser local storage.

## Dashboard public routing

Production hostnames:

- `office.fluxology.ca`
- `deals.fluxology.ca`
- `jobs.fluxology.ca`

The existing Caddy container internally maps each hostname to the corresponding static directory on Apache.

Each dashboard frontend still fetches `./data/listings.json`. Caddy intercepts `/data/listings.json` and rewrites it to that dashboard's API feed. This keeps frontend requests same-origin and requires no browser credential.

Direct write endpoints exposed by the edge:

- `POST https://office.fluxology.ca/api/upsert`
- `POST https://deals.fluxology.ca/api/upsert`
- `POST https://jobs.fluxology.ca/api/upsert`

Routine writers use upsert, not full-feed replacement.

## Dashboard transport strategy

Preferred:

```text
category skill / trusted automation
  -> authenticated dashboard API upsert
  -> persistent live feed
  -> dashboard hourly refresh
```

Fallback for runtimes that cannot call the direct write tool:

```text
skill
  -> GitHub snapshot JSON
  -> .github/workflows/sync-dashboard-feeds.yml
  -> dashboard API upsert
  -> live dashboard
```

The GitHub workflow watches only the three dashboard listing snapshot files and requires matching repository secrets for the three ingest tokens.

Do not make the frontend dependent on GitHub at runtime.

## Dashboard data ownership

### Office

Frontend: `public/office-scout/`

Schema: Office Scout v2.5.

Important invariants:

- `mandatoryFeesKnown:true` is required before an office can be treated as verified.
- Verified all-in cost must include HST, TMI, utilities, internet, cleaning, and every mandatory recurring charge.
- Unknown costs stay unknown.
- Preserve `priceHistory`.
- `lastVerified` is freshness; `lastChanged` is material change.

Browser-local workflow states: Unreviewed, Saved, Contacted, Tour booked, Rejected, Leased.

### Deals

Frontend: `public/deals/`.

Schema: v3.

Multiple searches share one feed using stable `id`, `category`, and `searchName`.

For weight-based searches, `landedCadPerLb` is item price plus shipping in CAD divided by stated weight. If destination shipping is not confirmed, `shippingResolved` must remain false and proxy shipping must not be presented as resolved.

Browser-local workflow states: Unreviewed, Watch, Saved, Purchased, Rejected.

### Jobs

Frontend: `public/jobs/`.

Schema: v3.

T176 ranking keeps overall fit separate from career/training value. Direct trade exposure should outrank generic labour when the user's training objective is better served.

Browser-local workflow states: Unreviewed, Saved, Applied, Interview, Rejected, Offer.

## Browser-local state

Scheduled skills and server-side feed writers do not own personal workflow status or personal notes. Those remain in browser `localStorage` and must not be injected into feed JSON.

## Repository structure

```text
fluxology-site/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── astro.config.mjs
├── package.json
├── docker/apache/
├── services/
│   ├── contact-api/
│   └── dashboard-api/
├── docs/
│   ├── DEPLOYMENT-VPS.md
│   ├── CADDY-INTEGRATION.md
│   └── DASHBOARDS-V3.md
├── public/
│   ├── office-scout/
│   ├── deals/
│   ├── jobs/
│   └── images/
├── src/
│   ├── assets/
│   ├── components/
│   ├── data/
│   ├── layouts/
│   ├── pages/
│   └── styles/
└── scripts/
```

## Main site architecture

The corporate site is a static Astro application. Static content renders to HTML; Svelte islands hydrate only where browser interactivity is required.

Key routes:

- `/`
- `/fabrication/`
- `/3d-lab/`
- `/greenhouse/`
- `/orchard/`
- `/contact-received/`
- `/404.html`

`src/data/dbaPlans.ts` is the source of truth for DBA names, descriptions, scope, classifications, milestones, and image references. Do not restate business/classification details from memory when the data file can be checked.

## Build and update

Local:

```bash
npm ci
npm run dev
npm run build
```

VPS application update:

```bash
git pull --ff-only
docker compose up -d --build
```

Dashboard feed updates arriving through the API do not require a rebuild or restart.

## Persistent-data warnings

Non-reproducible volumes:

- `fluxology_inquiry_data`
- `fluxology_dashboard_data`

Back both up. The site source can be rebuilt from Git; those volumes cannot.

## Security rules

- Application containers publish no host ports.
- The external edge proxy is the sole public network entrypoint.
- Dashboard read feeds are public; writes require scoped tokens.
- Contact form and dashboard APIs enforce body-size limits.
- Do not log bearer tokens.
- Do not embed write credentials in frontend code.
- Keep `connect-src 'self'` compatible by preserving same-origin dashboard feed routing.
- HSTS belongs at the external TLS terminator, not Apache.
