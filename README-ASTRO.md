# Fluxology Website — Astro Architecture

This document covers the Astro/Svelte application architecture and local developer workflow. Production operations live in `docs/DEPLOYMENT-VPS.md`; edge routing lives in `docs/CADDY-INTEGRATION.md`.

## Technology stack

- Astro 7 static output
- Svelte 5 islands via `@astrojs/svelte`
- TypeScript strict configuration
- `astro:fonts` for build-time self-hosted font assets
- `astro:assets` + `sharp` for responsive images
- `@astrojs/sitemap`
- Vite/Rolldown build pipeline
- terser production JavaScript minification

Node.js `>=22.12.0` is required for local development and the build stage.

## Static-first architecture

Astro renders the corporate website to static HTML. Svelte is used only where browser interactivity is required.

Primary routes:

- `/`
- `/fabrication/`
- `/3d-lab/`
- `/greenhouse/`
- `/orchard/`
- `/contact-received/`
- `/404.html`

`src/pages/[dba].astro` generates the DBA detail routes from `src/data/dbaPlans.ts`.

## Component split

Static Astro components include navigation markup, hero/about content, DBA sections, the operating model, roadmap, detail-page content, and footer.

Svelte islands provide:

- contact-form interactivity;
- mobile-navigation behavior;
- scroll progress;
- section theme/reveal behavior;
- back-to-top behavior;
- particle effects;
- cursor effects.

Hydration strategy:

- `client:load` for behavior needed immediately;
- `client:visible` for below-the-fold islands;
- `client:idle` for decorative site-wide enhancement.

Reactive islands use Svelte 5 runes where useful. Lifecycle-only islands may remain in supported legacy/lifecycle form when they simply attach observers or event listeners.

## Shared data

`src/data/dbaPlans.ts` is the source of truth for the four DBA routes and their homepage/detail content. Image references are imported as Astro image metadata from `src/assets/images/` rather than hard-coded public string paths.

## Styling

Global styles live under `src/styles/` and are imported by `BaseLayout.astro` so Astro bundles, hashes, and injects them in a deterministic cascade order.

Component-local Svelte styles stay inside the corresponding component.

## Fonts

Fonts are declared through `astro:fonts` and emitted into the built site. The corporate and DBA themes use the generated CSS font variables from the Astro configuration.

Because font files are fetched and emitted during the production build, the build environment needs outbound network access at build time.

## Images

Source imagery under `src/assets/images/` is processed through `astro:assets`. `sharp` is present as a development dependency for image processing.

Stable public assets such as favicons, PWA icons, service-worker files, and specific public images live under `public/` and are copied into the static output.

## Build pipeline

```bash
npm ci
npm run sync
npm run build
```

`npm run build` produces `dist/` and then runs the configured postbuild tasks:

1. minify the copied service worker with terser;
2. prune unreferenced original image artifacts.

For local preview:

```bash
npm run preview
```

For development with HMR:

```bash
npm run dev
```

## Contact form

`ContactForm.svelte` submits to the self-hosted same-origin endpoint `/api/contact`.

Hydrated clients send JSON. Native no-JavaScript submission uses form-urlencoded data and receives a redirect to `/contact-received/`.

The backend is `services/contact-api/` and provides:

- server-side validation;
- `website` honeypot handling;
- per-IP rate limiting;
- durable JSONL persistence before success response;
- optional SMTP notification.

The contact API is a production runtime service, not part of the Astro dev server. During ordinary `npm run dev`, the UI is available but the backend must be run separately if end-to-end form testing is required.

## Research dashboards

Three isolated static dashboard frontends also live in `public/`:

- `public/office-scout/`
- `public/deals/`
- `public/jobs/`

They are copied into the same static Apache image but exposed publicly on dedicated hostnames by the VPS edge configuration.

Each dashboard asks for `./data/listings.json`. In local/static development that resolves to the checked-in snapshot. In production the edge proxy routes that path to `services/dashboard-api`, which serves the authoritative persistent live feed.

Dashboard architecture and feed ownership are documented in `docs/DASHBOARDS-V3.md`.

## Production application containers

This repository's Compose project contains only:

- `fluxology-apache` — internal port 6080;
- `fluxology-contact-api` — internal port 8081;
- `fluxology-dashboard-api` — internal port 8082.

They publish no host ports. All join the external Docker network `fluxology-edge`, shared with the VPS-wide edge proxy managed outside this repository.

The static Astro build is performed inside the root Dockerfile's Node builder stage and copied into the Apache runtime image. Website code/content changes therefore require rebuilding the Apache image:

```bash
docker compose up -d --build apache
```

Dashboard feed writes through the live API do not require rebuilding the frontend image.

## Service worker / progressive enhancement

The site keeps content accessible without JavaScript. Scroll-reveal behavior is enhancement rather than a prerequisite for content visibility, and the base layout includes a no-JavaScript reveal fallback.

The service worker does not cache API traffic. API routes remain network-only.

## Security model relevant to frontend work

- frontend API calls are same-origin;
- public dashboard JavaScript never contains write credentials;
- contact and dashboard writes are handled server-side;
- CSP should retain `connect-src 'self'` compatibility;
- server/TLS headers are infrastructure concerns, not emitted from Astro components.

## Developer references

- `README.md` — overall repository architecture
- `ASTRO-MIGRATION.md` — concise migration/end-state record
- `docs/DEPLOYMENT-VPS.md` — production operator guide
- `docs/CADDY-INTEGRATION.md` — integration with the VPS-wide edge proxy
- `docs/DASHBOARDS-V3.md` — dashboard transport and ownership
- `services/contact-api/README.md` — contact API
- `services/dashboard-api/README.md` — dashboard API
