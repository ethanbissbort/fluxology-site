# Astro Migration Guide

## Status: complete — Astro 7 / Svelte 5

This document records the current end state of the Fluxology website after its migration from the original hand-authored frontend to Astro and Svelte. Historical implementation details that no longer affect the repository are intentionally omitted; current source and deployment documents are authoritative.

## Current application stack

| Concern | Current state |
|---|---|
| Static framework | Astro `^7.1.3`, `output: 'static'` |
| Interactive islands | Svelte `^5.56.7` via `@astrojs/svelte` |
| Language | TypeScript 5.7 strict configuration |
| Build runtime | Node `>=22.12.0` |
| Fonts | `astro:fonts`, emitted as self-hosted build assets |
| Images | `astro:assets` + `sharp` |
| Sitemap | `@astrojs/sitemap` |
| Static origin | Apache container, internal port 6080 |
| Contact backend | `services/contact-api`, internal port 8081 |
| Dashboard backend | `services/dashboard-api`, internal port 8082 |
| Public edge | Existing VPS-wide reverse proxy, managed outside this repository |

The production application is entirely self-hosted on the company's VPS.

## Migration result

The original monolithic HTML/CSS/JavaScript implementation was replaced with:

- static Astro pages and reusable `.astro` components;
- Svelte islands only for browser behavior that actually needs hydration;
- typed shared business data under `src/data/`;
- build-time font and image processing;
- a self-hosted contact API;
- three isolated static research dashboards;
- a persistent dashboard feed API supporting authenticated direct ingestion.

The old `src/index.html` and legacy `src/scripts/` frontend implementation are no longer part of the application.

## Astro architecture

The corporate site is statically generated. Primary routes include:

- `/`
- `/fabrication/`
- `/3d-lab/`
- `/greenhouse/`
- `/orchard/`
- `/contact-received/`
- `/404.html`

`src/pages/[dba].astro` generates the four DBA detail routes from the typed data in `src/data/dbaPlans.ts`.

Static content is rendered by Astro components. Svelte is reserved for interactive islands such as:

- contact form behavior;
- navigation/menu behavior;
- scroll progress;
- section theme transitions;
- back-to-top control;
- particle effects;
- cursor effects.

Hydration uses `client:load`, `client:visible`, and `client:idle` according to how early each behavior is needed.

## Svelte 5 migration

Reactive islands use Svelte 5 runes where state is required, including `$state` and `$props`. Lifecycle-only islands can remain in Svelte's supported legacy style when they simply attach imperative observers/listeners and render no stateful UI of their own.

`svelte.config.js` uses `vitePreprocess()` for Svelte TypeScript/preprocessing support.

## Build changes

The current build pipeline uses Astro 7's Vite/Rolldown toolchain.

- JavaScript minification uses terser with production tuning in `astro.config.mjs`.
- CSS is minified through the Astro/Vite pipeline.
- HTML compression uses Astro's configured HTML compression.
- `npm run build` triggers the `postbuild` hook, which minifies the copied service worker and prunes unreferenced image originals.
- Global styles are imported by `BaseLayout.astro` so Astro bundles and hashes them correctly.
- Fonts are downloaded at build time through `astro:fonts` and served locally from the built site.

Production output is copied into the Apache image during the multi-stage Docker build. A code/content change therefore requires rebuilding the Apache image.

## Self-hosted APIs

### Contact API

`services/contact-api` handles the corporate contact form on the same origin.

- `POST /api/contact`
- `GET /api/health`
- JSON submission for hydrated clients
- form-urlencoded fallback for no-JavaScript clients
- server-side validation
- `website` honeypot
- per-IP rate limiting
- durable JSONL persistence before success response
- optional SMTP notification on top of local persistence

### Dashboard API

`services/dashboard-api` is the authoritative production feed service for:

- Office Scout
- Deals
- Jobs

It stores live data on the `dashboard_data` Docker volume and provides public feed reads plus category-scoped authenticated write operations.

The static dashboard frontends remain under:

- `public/office-scout/`
- `public/deals/`
- `public/jobs/`

Each frontend still requests `./data/listings.json`. In production, the VPS edge routes that path to the appropriate live API feed, so the browser remains same-origin and does not hold a write credential.

## Production container boundary

This repository's Compose project contains only application services:

```text
fluxology-apache:6080
fluxology-contact-api:8081
fluxology-dashboard-api:8082
fluxology-mcp:8083
```

All join the external Docker network `fluxology-edge` and publish no host ports. The VPS-wide edge container is managed separately and joins the same network.

See:

- `docs/DEPLOYMENT-VPS.md`
- `docs/CADDY-INTEGRATION.md`
- `DOCKER-DEPLOYMENT.md`
- `docs/DASHBOARDS-V3.md`

## Persistence

The two critical named volumes are:

- `fluxology_inquiry_data` — contact inquiries;
- `fluxology_dashboard_data` — live office/deals/jobs feeds and dashboard write audit log.

Both are non-reproducible production state and must be backed up independently from Git.

## Commands

Development:

```bash
npm ci
npm run dev
```

Production build test:

```bash
npm run build
npm run preview
```

VPS application update:

```bash
git pull --ff-only
docker compose up -d --build
```

Routine dashboard feed updates arriving through the dashboard API do not require an application rebuild or restart.

## Source-of-truth rule

For current behavior, prefer the implementation and current operator documents over this migration record. In particular:

- business/DBA content: `src/data/dbaPlans.ts`;
- application deployment: `docs/DEPLOYMENT-VPS.md`;
- external edge routing: `docs/CADDY-INTEGRATION.md`;
- dashboard transport and ownership: `docs/DASHBOARDS-V3.md`;
- direct feed API: `services/dashboard-api/README.md`.
