# Fluxology, Inc. Website

A static corporate-planning website for Fluxology, Inc., built with
[Astro](https://astro.build/) and [Svelte](https://svelte.dev/). The homepage
remains a long-form, single-page overview; four generated DBA routes provide
deeper operating-plan content. Interactive Svelte islands add themed particles,
scroll progress, responsive navigation, and a Netlify-backed inquiry form.

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
  hydrated with `client:load` / `client:visible`
- **TypeScript** — strict config (`astro/tsconfigs/strict`)
- **[astro:fonts](https://docs.astro.build/en/guides/fonts/)** — self-hosted
  Google Fonts with generated fallback metrics
- **[Netlify Forms](https://docs.netlify.com/forms/setup/)** — serverless
  contact form handling

### Build toolchain

- CSS is minified by **lightningcss** (Astro's default for the static build).
- Client JavaScript is minified by **terser** with `drop_console` enabled and
  two compress passes (configured in `astro.config.mjs` under `vite.build`).
- HTML whitespace is handled by Astro's default `compressHTML: 'jsx'`.

There is no separate manual minification step, no `astro-compress`, and no
legacy `cleancss` / `uglifyjs` workflow.

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
├── astro.config.mjs            # Astro config: Svelte integration, fonts, terser
├── svelte.config.js            # Svelte preprocessing (vitePreprocess)
├── tsconfig.json               # Strict TypeScript config
├── netlify.toml                # Netlify build + security headers
├── Dockerfile                  # Multi-stage build (Node → Apache)
├── docker-compose.yml          # Local/self-hosted container orchestration
├── src/
│   ├── pages/
│   │   ├── index.astro         # Long-form, single-page company overview
│   │   └── [dba].astro         # Generates the four DBA detail routes
│   ├── data/
│   │   └── dbaPlans.ts         # Shared source for homepage and detail-page content
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
│   │   ├── ContactForm.svelte   # Netlify contact form (runes)
│   │   ├── ParticleSystem.svelte# Themed ambient particles (runes)
│   │   ├── NavigationMenu.svelte# Mobile menu + smooth scroll (legacy mode)
│   │   ├── BackToTop.svelte     # Back-to-top button (runes)
│   │   ├── ScrollProgress.svelte# Scroll progress bar (runes)
│   │   └── ThemeTransition.svelte# Section theme transitions (legacy mode)
│   └── styles/
│       ├── reset.css            # CSS reset
│       ├── variables.css        # Custom properties: colors, fonts, spacing
│       ├── base.css             # Base element styles
│       ├── themes.css           # Per-division theme definitions
│       ├── transitions.css      # Animations and transitions
│       ├── utilities.css        # Utility classes
│       └── responsive.css       # Media queries
├── public/
│   ├── favicon.svg
│   └── service-worker.js        # PWA offline support
└── scripts/
```

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

`ContactForm`, `ParticleSystem`, `BackToTop`, and `ScrollProgress` use Svelte 5
runes (`$state`, `$props`). `NavigationMenu` and `ThemeTransition` remain in
Svelte legacy (lifecycle-only) mode.

### Fonts

Fonts are **self-hosted** through `astro:fonts` (Google provider). Nine families
are configured in `astro.config.mjs`: Outfit, Open Sans, Inter, Rajdhani, Space
Grotesk, DM Sans, Sora, Nunito, and Quicksand. The above-the-fold corporate
fonts (Outfit, Open Sans) are preloaded in `BaseLayout.astro`; the rest load on
demand. There are **no** manual font files and **no** Google Fonts `<link>` in
`<head>`.

Three additional families are referenced in `src/styles/variables.css`
(`Poppins`, `JetBrains Mono`, `Fira Code`) but are **not** self-hosted, so they
fall back to system fonts where used.

### Progressive enhancement

Above-the-fold hero content renders immediately without JavaScript. Scroll-reveal
content (`.observe-fade`, `.observe-slide-up`, `.observe-scale`) is hidden by
default and revealed via JavaScript; a `<noscript>` block in `BaseLayout.astro`
forces it visible when JavaScript is disabled, so nothing is permanently hidden.

The mobile navigation menu closes on `Escape`. There are no other global
keyboard shortcuts.

## Contact Form (Netlify Forms)

The contact form is wired for [Netlify Forms](https://docs.netlify.com/forms/setup/):

- The **visible** form is a hydrated Svelte island (`ContactForm.svelte`).
- A **hidden static detection form** in `index.astro` mirrors the field names so
  Netlify's build bot can register the form by parsing the static HTML at deploy
  time (it cannot see the client-rendered island).
- Both forms carry `data-netlify="true"`, a `form-name` hidden input, and a
  `bot-field` honeypot (`netlify-honeypot="bot-field"`).
- On submit, the Svelte form performs a real URL-encoded AJAX `POST` to `/`
  (`application/x-www-form-urlencoded`) and shows in-page success/error states.

The form only records submissions when the site is deployed to Netlify. Locally,
the UI works but submissions are not captured.

## Deployment

### Netlify (primary)

Configured in `netlify.toml`:

- Build command: `npm run build`
- Publish directory: `dist`
- `NODE_VERSION = 22`
- Security headers applied to every response (see below)
- Long-cache, immutable headers for content-hashed assets under `/_assets/*`
- `no-cache` header for `/service-worker.js`

### Docker + Apache (alternative)

A multi-stage `Dockerfile` builds the site with `node:22-alpine` and serves the
static output with `httpd:2.4-alpine` (Apache). `docker-compose.yml` orchestrates
the container.

> The container serves **plaintext HTTP** on port 80 by design and **must** sit
> behind a TLS terminator (reverse proxy / load balancer) that handles HTTPS,
> HSTS, and the HTTP→HTTPS redirect. See **[DOCKER-DEPLOYMENT.md](./DOCKER-DEPLOYMENT.md)**
> for the full container setup.

## Security

Hardened HTTP response headers are configured for both deployment targets:

- **Content-Security-Policy** with `base-uri 'self'`, `form-action 'self'`,
  `object-src 'none'`, and `frame-ancestors 'self'`
- **X-Frame-Options:** `SAMEORIGIN`
- **X-Content-Type-Options:** `nosniff`
- **X-XSS-Protection:** `0` (legacy auditor disabled in favor of CSP)
- **Referrer-Policy:** `strict-origin-when-cross-origin`
- **Permissions-Policy:** geolocation, microphone, and camera disabled
- **Strict-Transport-Security (HSTS)** — sent by Netlify (always HTTPS)

The service worker (`public/service-worker.js`) uses a **network-first** strategy
for navigations (so content and security fixes reach already-visited clients) and
a **cache-first** strategy for static assets, backed by a **versioned** runtime
cache that is evicted on each release.

## Validation

The production build emits the homepage, 404 page, and four DBA routes. Before
publishing, run `npm run sync`, `npm run build`, `tsc --noEmit`, an internal
route/image check, and fresh desktop/mobile browser audits. Historical
Lighthouse figures are not treated as current after major content or layout
changes.

## Progressive Web App

`public/service-worker.js` provides offline support:

- **Cache-first** for content-hashed static assets (CSS/JS/fonts under
  `/_assets`)
- **Network-first** for HTML navigations, falling back to cache when offline
- Versioned caches evicted on each release to avoid serving stale content

The worker is registered from `BaseLayout.astro` on `window.load`.

## Customization

### Business content

Company and DBA content lives in `src/data/dbaPlans.ts`. Each record contains a
homepage overview and the corresponding detail-page content, keeping status,
classification, scope, milestones, and image references synchronized. The
production image map and outstanding coverage gaps are documented in
`docs/IMAGE-ASSET-INVENTORY.md`.

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
**Last Updated:** July 2026 — full rewrite for the Astro 7 + Svelte 5 stack
