# Fluxology, Inc. Website

A static corporate-planning website for Fluxology, Inc., built with
[Astro](https://astro.build/) and [Svelte](https://svelte.dev/). The homepage
remains a long-form, single-page overview; four generated DBA routes provide
deeper operating-plan content. Interactive Svelte islands add themed particles,
scroll progress, responsive navigation, and an inquiry form backed by a
self-hosted API. The site is deployed on the company's own VPS — see
[`docs/DEPLOYMENT-VPS.md`](./docs/DEPLOYMENT-VPS.md).

## Overview

Fluxology, Inc. is a federally incorporated, one-owner Canadian-controlled
private corporation registered to operate in Ontario. Commercial activity is
planned no earlier than 2029. The four operating names are proposed and not yet
registered:

1. **Fluxology Fabrication & Welding** — mobile repair, local fabrication, and
   selective shop overflow; provisional primary NAICS 811310 if repair work
   leads actual corporate revenue.
2. **Fluxology 3D Lab** — scanning, modelling, FDM printing, and hybrid
   fabrication support; provisional service NAICS 541420.
3. **Fluxology Greenhouse** — household food infrastructure with genuine
   surplus sales only; secondary NAICS 111419 when commercial activity exists.
4. **Fluxology Orchard & Food Forest** — perennial household food and land
   improvement with late-stage surplus; secondary NAICS 111330 when applicable.

The homepage explains the shared operating model and 2026-2035 roadmap. Each
DBA detail page adds the relevant scope table, workflow, capital gates,
controls, milestones, and full image gallery.

## Tech Stack

- **[Astro](https://astro.build/) 7** — static site generator
  (`output: 'static'`), Vite + Rolldown build pipeline
- **[Svelte](https://svelte.dev/) 5** — interactive islands via
  [`@astrojs/svelte`](https://github.com/withastro/astro/tree/main/packages/integrations/svelte),
  hydrated with `client:load` / `client:visible` / `client:idle`
- **TypeScript** — strict config (`astro/tsconfigs/strict`)
- **[astro:fonts](https://docs.astro.build/en/guides/fonts/)** — self-hosted
  Google Fonts with generated fallback metrics
- **[astro:assets](https://docs.astro.build/en/guides/images/)** — responsive,
  build-time-optimized images (via `sharp`)
- **[@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/)**
  — generated `sitemap-index.xml` (`/404` and `/contact-received` excluded)
- **`services/contact-api`** — a small self-hosted Node 22 service (built-in
  `node:http`, `nodemailer` as its only dependency) that handles contact form
  submissions. No third-party form service is involved.
- **Caddy + Apache in Docker** — Caddy terminates TLS at the edge and proxies
  to Apache (static site) and contact-api (`/api/*`), all on the company's own
  VPS

### Build toolchain

- CSS is minified by **lightningcss** (Astro's default for the static build).
- Client JavaScript is minified by **terser** with `drop_console` enabled and
  two compress passes (configured in `astro.config.mjs` under `vite.build`).
- HTML whitespace is handled by Astro's default `compressHTML: 'jsx'`.

- After `astro build`, the npm **`postbuild`** hook minifies
  `dist/service-worker.js` with terser (files in `public/` bypass the bundler)
  and runs `scripts/prune-unused-images.mjs` to delete image originals in
  `dist/_assets` that no built HTML/CSS/JS references.

There is no `astro-compress` and no legacy `cleancss` / `uglifyjs` workflow.

## Requirements

- **Node.js `>= 22.12`** (see `engines` in `package.json`; Astro 7 requires it)
- npm

## Getting Started

```bash
# Install dependencies
npm install

# Start the dev server (http://localhost:4321 by default)
npm run dev

# Type-check / generate Astro types
npm run sync

# Build the production site into ./dist
npm run build

# Preview the production build locally
npm run preview

```

There is no "open `index.html` in a browser" or `python -m http.server`
workflow — the site is a compiled Astro project and must be built or served
through the Astro dev server.

## Project Structure

```
fluxology-site/
├── astro.config.mjs            # Astro config: Svelte + sitemap integrations, prefetch, fonts, terser
├── svelte.config.js            # Svelte preprocessing (vitePreprocess)
├── tsconfig.json               # Strict TypeScript config
├── Dockerfile                  # Multi-stage build for the static site (Node → Apache)
├── docker-compose.yml          # The three-service stack: caddy + apache + contact-api
├── .env.example                # Every variable docker-compose.yml consumes
├── caddy/
│   └── Caddyfile               # Edge: TLS/Let's Encrypt, redirects, /api/* routing, sub-site template
├── docker/
│   └── apache/                 # httpd.conf + vhost.conf for the internal static-site origin
├── services/
│   └── contact-api/            # Self-hosted contact form service (own Dockerfile + README)
├── docs/
│   ├── DEPLOYMENT-VPS.md       # PRIMARY operator guide: VPS → live site
│   ├── FONTS.md
│   ├── IMAGE-ASSET-INVENTORY.md
│   └── AUDIT-2026-08-02.md
├── src/
│   ├── pages/
│   │   ├── index.astro         # Long-form company overview homepage
│   │   ├── [dba].astro         # Generates the four DBA detail routes
│   │   ├── contact-received.astro # Landing page for no-JS form submits (noindex)
│   │   └── 404.astro           # Branded 404 page (noindex)
│   ├── data/
│   │   └── dbaPlans.ts         # Shared source for homepage and detail-page content
│   ├── assets/
│   │   └── images/             # Source images (WebP) optimized via astro:assets
│   ├── layouts/
│   │   └── BaseLayout.astro     # <head>, font preloads, global CSS imports, SW registration
│   ├── components/
│   │   ├── Navigation.astro     # Static nav bar
│   │   ├── Hero.astro           # Above-the-fold hero
│   │   ├── About.astro          # About section
│   │   ├── DBASection.astro     # Reusable business-division section
│   │   ├── DBADetailPage.astro  # Reusable detailed DBA page
│   │   ├── OperatingModel.astro # Company operating architecture
│   │   ├── Roadmap.astro        # 2026-2035 staged roadmap
│   │   ├── Footer.astro         # Static footer
│   │   ├── ContactForm.svelte   # Contact form posting to /api/contact (runes)
│   │   ├── ParticleSystem.svelte# Themed ambient particles (runes)
│   │   ├── NavigationMenu.svelte# Mobile menu, focus trap, smooth scroll (legacy mode)
│   │   ├── BackToTop.svelte     # Back-to-top button (runes)
│   │   ├── ScrollProgress.svelte# Scroll progress bar (runes)
│   │   ├── ThemeTransition.svelte# Section theme transitions (legacy mode)
│   │   └── CursorEffects.svelte # Themed cursor dot/ring for fine pointers (runes)
│   └── styles/
│       ├── reset.css            # CSS reset
│       ├── variables.css        # Custom properties: colors, fonts, spacing
│       ├── base.css             # Base element styles
│       ├── themes.css           # Per-division theme definitions
│       ├── transitions.css      # Animations and transitions
│       ├── utilities.css        # Utility classes
│       └── responsive.css       # Media queries
├── public/
│   ├── favicon.svg / favicon-32.png / apple-touch-icon.png
│   ├── icon-192.png, icon-512.png (+ maskable variants), badge-72.png
│   ├── site.webmanifest         # PWA manifest (theme/background #1B3A4B)
│   ├── robots.txt               # Points at the generated /sitemap-index.xml
│   ├── offline.html             # Service-worker offline fallback page
│   ├── service-worker.js        # PWA offline support (minified in postbuild)
│   └── images/corporate/        # Two stable-URL files only: flux-background.webp,
│                                #   logo-medallion.webp (CSS texture + og:image)
└── scripts/
    └── prune-unused-images.mjs  # Postbuild: removes unreferenced image originals from dist/_assets
```

The sitemap (`/sitemap-index.xml` + `/sitemap-0.xml`) is **generated at build
time** by `@astrojs/sitemap` — it is not checked into `public/`.

Global stylesheets are imported in the `BaseLayout.astro` frontmatter (not via
`<link>` tags) so Astro bundles, hashes, and injects them. The cascade order
matches the import order shown above.

> **Note:** there is no `src/index.html` and no `src/scripts/` directory. Those
> were part of a previous vanilla-JavaScript build and have been removed.

## Architecture Notes

### Astro components vs. Svelte islands

The homepage is assembled in `src/pages/index.astro`; `src/pages/[dba].astro`
generates the four detail routes from `src/data/dbaPlans.ts`. Static content is
rendered by Astro components, while interactive behavior lives in Svelte
islands hydrated only where needed:

| Component            | Hydration        | Notes                                    |
| -------------------- | ---------------- | ---------------------------------------- |
| `ScrollProgress`     | `client:load`    | Svelte 5 runes                           |
| `ThemeTransition`    | `client:load`    | Svelte legacy mode (lifecycle only)      |
| `BackToTop`          | `client:load`    | Svelte 5 runes                           |
| `NavigationMenu`     | `client:load`    | Svelte legacy mode (lifecycle only)      |
| `ParticleSystem`     | `client:visible` | Svelte 5 runes; themed section ambience  |
| `ContactForm`        | `client:visible` | Svelte 5 runes                           |
| `CursorEffects`      | `client:idle`    | Svelte 5 runes; site-wide (rendered by `BaseLayout.astro`) |

`ContactForm`, `ParticleSystem`, `BackToTop`, `ScrollProgress`, and
`CursorEffects` use Svelte 5 runes (`$state`, `$props`). `NavigationMenu` and
`ThemeTransition` remain in Svelte legacy (lifecycle-only) mode.

### Fonts

Fonts are **self-hosted** through `astro:fonts` (Google provider). Nine families
are configured in `astro.config.mjs`: Outfit, Open Sans, Inter, Rajdhani, Space
Grotesk, DM Sans, Sora, Nunito, and Quicksand. Preloading is theme-aware in
`BaseLayout.astro`: every page preloads the corporate fonts (Outfit, Open Sans),
and each DBA detail page additionally preloads its own hero heading family
(Rajdhani, Space Grotesk, or Sora). The rest load on demand. There are **no**
manual font files and **no** Google Fonts `<link>` in `<head>`.

All font variables in `src/styles/variables.css` resolve to loaded families or
system stacks — the previously referenced `Poppins`, `JetBrains Mono`, and
`Fira Code` were remapped (Outfit and system monospace respectively).

### Progressive enhancement

Above-the-fold hero content renders immediately without JavaScript. Scroll-reveal
content (`.observe-fade`, `.observe-slide-up`, `.observe-scale`) is hidden by
default and revealed via JavaScript; a `<noscript>` block in `BaseLayout.astro`
forces it visible when JavaScript is disabled, so nothing is permanently hidden.

The collapsed mobile navigation manages keyboard focus: opening it focuses the
first link, `Tab`/`Shift+Tab` are trapped inside the open overlay, and `Escape`
or an outside click closes it and returns focus to the toggle. There are no
other global keyboard shortcuts.

## Contact Form (self-hosted)

The contact form posts to **`POST /api/contact`**, served by the
`services/contact-api` container on the same origin. Nothing leaves the VPS
unless an SMTP relay is deliberately configured.

- The form is a hydrated Svelte island (`ContactForm.svelte`) carrying
  `action="/api/contact" method="POST"`.
- With JavaScript, submit is intercepted and sent as **JSON**; the API answers
  `200 {"ok":true}`, or `400` with a `fields` map that is rendered as inline
  per-field errors, or `429` when rate limited.
- **Without JavaScript** the native form posts `application/x-www-form-urlencoded`
  to the same endpoint, and the API replies with a `303` redirect to
  `/contact-received/` (or `/contact-received/?error=1` on a validation
  failure) — a real Astro page, noindex, kept out of the sitemap.
- Spam protection is a honeypot field named **`website`**, off-screen,
  `aria-hidden`, `tabindex="-1"`. A filled honeypot gets a normal success
  response and the submission is silently discarded.
- `novalidate` is applied only after hydration, so the server-rendered form
  keeps native `required`/`email` validation for pre-hydration and no-JS
  submits; the status message region stays permanently in the DOM
  (`aria-live`) so screen readers announce submit results.

Every valid inquiry is appended to a JSONL log (`/data/inquiries.jsonl` on a
named Docker volume) and fsync'd **before** the visitor is told it succeeded.
Email notification is optional and best-effort on top: it stays off until
`SMTP_HOST` is set. Until then that log file is the **only** copy of an inquiry
— see [`docs/DEPLOYMENT-VPS.md`](./docs/DEPLOYMENT-VPS.md) for how to read and
back it up, and [`services/contact-api/README.md`](./services/contact-api/README.md)
for the full endpoint, field, and environment-variable reference.

Locally (`npm run dev`), the UI works but there is no API behind it unless you
run the service yourself — its README documents a standalone `npm start`.

## Deployment

The site is **self-hosted on the company's own VPS** as three Docker
containers: Caddy at the edge (TLS + Let's Encrypt + reverse proxy), Apache
serving the built static site, and the Node contact API. Only Caddy publishes
ports.

```bash
docker compose up -d --build
```

- **[`docs/DEPLOYMENT-VPS.md`](./docs/DEPLOYMENT-VPS.md)** — the primary
  operator guide: DNS prerequisites, first deploy, reading inquiries, backups,
  enabling email later, adding a sub-site, operational warnings, troubleshooting.
- **[`DOCKER-DEPLOYMENT.md`](./DOCKER-DEPLOYMENT.md)** — container reference:
  image internals, Apache and Caddy configuration, cache policy, compression.

The built `dist/` is **copied into the Apache image at build time**, not
bind-mounted, so content changes require `docker compose up -d --build` rather
than a restart.

## Security

Hardened HTTP response headers are set at two layers:

- Apache (`docker/apache/httpd.conf`) sets them on static responses:
  - **Content-Security-Policy** with `base-uri 'self'`, `form-action 'self'`,
    `object-src 'none'`, `connect-src 'self'`, and `frame-ancestors 'self'` —
    the contact API is same-origin, so no third-party sources are needed
  - **X-Frame-Options:** `SAMEORIGIN`
  - **X-Content-Type-Options:** `nosniff`
  - **X-XSS-Protection:** `0` (legacy auditor disabled in favor of CSP)
  - **Referrer-Policy:** `strict-origin-when-cross-origin`
  - **Permissions-Policy:** geolocation, microphone, and camera disabled
- Caddy (`caddy/Caddyfile`, the `(site-defaults)` snippet) adds
  **Strict-Transport-Security** (`max-age=31536000; includeSubDomains`) and
  `nosniff`, and suppresses the `Server` header. HSTS is emitted **only** here —
  Caddy is the TLS terminator, and both Apache files carry a do-not-add note.

The service worker (`public/service-worker.js`) uses a **network-first** strategy
for navigations (so content and security fixes reach already-visited clients),
**cache-first** for content-hashed `/_assets/*`, and **stale-while-revalidate**
for other same-origin assets, backed by **versioned** caches that are evicted on
each release.

## Validation

The production build emits the homepage, 404 page, four DBA routes, the
`/contact-received/` page, and a generated sitemap (`sitemap-index.xml` +
`sitemap-0.xml`; the two noindex routes are filtered out). Before publishing,
run `npm run sync`, `npm run build` (which includes the `postbuild` service
worker minification and image pruning), `tsc --noEmit`, an internal route/image
check, and fresh desktop/mobile browser audits. Historical
Lighthouse figures are not treated as current after major content or layout
changes.

## Progressive Web App

`public/service-worker.js` provides offline support (source is readable; the
deployed copy is minified by the `postbuild` terser step):

- **Precache + priming**: `/` and `/offline.html` are precached at install,
  then the runtime cache is primed by crawling the shell's real subresources
  (island scripts, self-hosted fonts, CSS imagery), so a previously visited
  page renders styled and hydrated offline.
- **Network-first** for HTML navigations; when offline, the cached copy of the
  requested URL is served, else the branded `offline.html` page with a **503**
  status (an uncached route is never impersonated with a 200).
- **Cache-first** for content-hashed static assets under `/_assets/`
- **Stale-while-revalidate** for other same-origin assets (unhashed images,
  icons, manifest), with genuine background revalidation
- A single `CACHE_VERSION` constant derives both cache names; stale caches are
  evicted on activate.

The worker is registered from `BaseLayout.astro` on `window.load`. Installable
PWA metadata lives in `public/site.webmanifest` (theme/background `#1B3A4B`)
with the icon set in `public/`.

## Customization

### Business content

Company and DBA content lives in `src/data/dbaPlans.ts`. Each record contains a
homepage overview and the corresponding detail-page content, keeping status,
classification, scope, milestones, and image references synchronized. Images
are typed ESM imports from `src/assets/images/` and are rendered as responsive
renditions via `astro:assets`; only two stable-URL files remain in
`public/images/corporate/`. The production image map and outstanding coverage
gaps are documented in `docs/IMAGE-ASSET-INVENTORY.md`.

### Colors and fonts

Color and font custom properties are defined in `src/styles/variables.css`.
Color groups map to the site themes:

- **Corporate** — Hero, About, Contact
- **Industrial** — Fabrication & Welding
- **Tech** — 3D Lab
- **Natural** — Greenhouse & Orchard

Per-theme background/foreground mappings are defined in `src/styles/themes.css`
via `[data-theme="…"]` selectors. Add or adjust a theme there, then reference it
by setting `theme` (and `data-theme`) on the corresponding section.

Because fonts are self-hosted through `astro:fonts`, adding a new Google font
means adding an entry to the `fonts` array in `astro.config.mjs` (and a
matching `<Font>` tag in `BaseLayout.astro` if you want it preloaded) — not
editing a `<head>` `<link>`.

## Contact

- Email: [info@fluxology.ca](mailto:info@fluxology.ca)

## License

All rights reserved © Fluxology Inc.

---

**Version:** 2.0.0
**Last Updated:** August 2026 — audit remediation pass (responsive images,
sitemap generation, prefetch, service-worker rework, accessibility fixes)
