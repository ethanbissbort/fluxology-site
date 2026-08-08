# Fluxology, Inc. Website — Astro Architecture

This document describes the **Astro + Svelte** architecture and developer
workflow for the Fluxology Inc. site. For the business overview, division
descriptions, and general project information, see [`README.md`](./README.md).

The site is statically generated and ships little JavaScript. The homepage is
a long-form single-page overview, while a dynamic Astro route generates four
DBA detail pages from shared typed data. Static content is pre-rendered to HTML;
only a small set of interactive Svelte "islands" hydrate in the browser.

## Technology Stack

- **[Astro 7.1.3](https://astro.build)** — static site generator (`output: 'static'`)
- **[Svelte 5.56](https://svelte.dev)** — interactive islands, using **runes** (`$state`, `$props`) where reactive
- **[@astrojs/svelte 9.0.1](https://docs.astro.build/en/guides/integrations-guide/svelte/)** — Svelte integration for Astro
- **TypeScript 5.7** — `astro/tsconfigs/strict`, JSX preserved with `jsxImportSource: "svelte"`
- **[astro:fonts](https://docs.astro.build/en/guides/fonts/)** — self-hosted Google Fonts (no manual font files)
- **[astro:assets](https://docs.astro.build/en/guides/images/)** — responsive optimized images from `src/assets/images/` (sharp devDependency)
- **[@astrojs/sitemap](https://docs.astro.build/en/guides/integrations-guide/sitemap/)** — build-time sitemap generation; built-in **prefetch** (`prefetchAll`, viewport strategy) warms cross-page links

### Requirements

- **Node.js >= 22.12.0** (enforced via `engines` in `package.json`)
- npm

## Build Pipeline

Astro 7 builds on **Vite + Rolldown** (Astro's Rust-based bundler). Minification
is configured in `astro.config.mjs`:

- **CSS** — minified by **lightningcss** (Astro's default in v7).
- **JavaScript** — minified by **terser** with `drop_console: true` and
  `passes: 2`, so `console.*` / `debugger` calls are stripped from the
  production client bundle.
- **HTML** — Astro's built-in `compressHTML` (`'jsx'` mode) handles HTML
  minification.

There is **no separate `astro-compress` step** — Vite/terser minify JS/CSS and
`compressHTML` handles HTML, so it would be redundant.

After `astro build`, the npm **`postbuild`** hook runs automatically (via
`npm run build`): it terser-minifies `dist/service-worker.js` (files in
`public/` bypass the bundler) and then runs `scripts/prune-unused-images.mjs`,
which deletes `.webp` originals in `dist/_assets` that no built HTML/CSS/JS
references (Vite copies every imported source image even when only the
`astro:assets` renditions are used).

## Project Structure

```
fluxology-site/
├── public/
│   ├── images/corporate/         # Two stable-URL WebP files only (CSS texture, og:image)
│   ├── favicon.svg / favicon-32.png / apple-touch-icon.png
│   ├── icon-192.png, icon-512.png (+ maskable), badge-72.png   # PWA icons
│   ├── site.webmanifest          # PWA manifest
│   ├── robots.txt                # Points at the generated /sitemap-index.xml
│   ├── offline.html              # Service-worker offline fallback page
│   └── service-worker.js         # PWA service worker (minified postbuild)
├── src/
│   ├── assets/
│   │   └── images/               # Source WebP images, optimized via astro:assets
│   ├── components/
│   │   ├── Navigation.astro      # Static: fixed navigation markup
│   │   ├── Hero.astro            # Static: hero section
│   │   ├── About.astro           # Static: about section
│   │   ├── DBASection.astro      # Static: reusable business-division template
│   │   ├── DBADetailPage.astro   # Static: reusable detailed DBA route
│   │   ├── OperatingModel.astro  # Static: company operating architecture
│   │   ├── Roadmap.astro         # Static: staged implementation roadmap
│   │   ├── Footer.astro          # Static: footer
│   │   ├── ScrollProgress.svelte # Island (runes): scroll progress bar
│   │   ├── ThemeTransition.svelte# Island (legacy): scroll-driven theme switch
│   │   ├── ParticleSystem.svelte # Island (runes): themed particle animation
│   │   ├── ContactForm.svelte    # Island (runes): contact form + validation
│   │   ├── NavigationMenu.svelte # Island (legacy): mobile menu behaviour + focus trap
│   │   ├── BackToTop.svelte      # Island (runes): back-to-top button
│   │   └── CursorEffects.svelte  # Island (runes): themed cursor for fine pointers
│   ├── layouts/
│   │   └── BaseLayout.astro      # HTML wrapper, CSS imports, fonts, service worker
│   ├── pages/
│   │   ├── index.astro           # Long-form company homepage
│   │   ├── [dba].astro           # Four generated DBA detail pages
│   │   ├── contact-received.astro# Landing page for no-JS form submits (noindex)
│   │   └── 404.astro             # Branded 404 (noindex)
│   ├── data/
│   │   └── dbaPlans.ts           # Shared plan-based content and image map
│   └── styles/
│       ├── reset.css             # CSS reset
│       ├── variables.css         # Design tokens + font CSS variables
│       ├── base.css              # Base styles
│       ├── themes.css            # Per-division theme styles
│       ├── transitions.css       # Animations / transitions
│       ├── utilities.css         # Performance / utility classes
│       └── responsive.css        # Media queries
├── scripts/
│   └── prune-unused-images.mjs   # Postbuild pruning of unreferenced dist/_assets images
├── services/
│   └── contact-api/              # Self-hosted contact form service (Node 22, own Dockerfile)
├── caddy/
│   └── Caddyfile                 # Edge proxy: TLS, redirects, /api/* routing
├── docker/
│   └── apache/                   # httpd.conf + vhost.conf for the static-site origin
├── docker-compose.yml            # caddy + apache + contact-api
├── Dockerfile                    # Static site image (node:22-alpine → httpd:2.4-alpine)
├── astro.config.mjs              # Astro configuration (integrations, prefetch, fonts, Vite)
├── svelte.config.js              # Svelte preprocessing (required by @astrojs/svelte 9)
├── tsconfig.json                 # TypeScript config (strict)
└── package.json
```

All production images are **WebP**; sources live in `src/assets/images/` and
are emitted as content-hashed responsive renditions by `astro:assets`. The
sitemap is generated at build time by `@astrojs/sitemap` (not in `public/`).

## The Island Architecture

Astro renders everything to static HTML by default. Interactive components are
**islands** — self-contained Svelte components that hydrate independently in the
browser via a `client:*` directive. The rest of the page ships zero JavaScript.

### Static Astro components

Pre-rendered to HTML at build time, no client JavaScript:

- `BaseLayout.astro` — HTML shell, meta tags, global CSS imports, fonts, service worker
- `Navigation.astro`, `Hero.astro`, `About.astro`, `Footer.astro`
- `DBASection.astro` — reusable template for each business division. It renders
  status and classification, image-backed scope cards, workflow, operating
  boundary, responsive galleries, and a detail-page link.
- `DBADetailPage.astro` — reusable detail route with scope and capital tables,
  operating controls, milestones, gallery, and local page navigation.
- `OperatingModel.astro` and `Roadmap.astro` — company architecture and staged
  2026-2035 plan.

### Svelte islands and their directives

The directives below are used across the homepage and DBA routes:

| Component | Directive | Reactivity | Purpose |
|---|---|---|---|
| `ScrollProgress` | `client:load` | Runes (`$state`) | Top scroll-progress bar |
| `ThemeTransition` | `client:load` | Legacy | Switches theme on scroll (Intersection Observer) |
| `BackToTop` | `client:load` | Runes (`$state`) | Back-to-top button |
| `NavigationMenu` | `client:load` | Legacy | Mobile menu open/close behaviour |
| `ParticleSystem` | `client:visible` | Runes (`$state`, `$props`) | Themed particle animation per section |
| `ContactForm` | `client:visible` | Runes (`$state`) | Contact form: client-side validation + JSON `POST` to `/api/contact` |
| `CursorEffects` | `client:idle` | Runes (`$state`) | Themed cursor dot/ring, site-wide from `BaseLayout.astro` |

- **`client:load`** — hydrates as soon as the page loads. Used for chrome that
  must respond to scroll immediately (progress bar, theme, back-to-top, mobile menu).
- **`client:visible`** — hydrates only when the component scrolls into view.
  Used for the per-section particle systems and the contact form, which live
  further down the page.
- **`client:idle`** — hydrates when the browser goes idle. Used for the
  decorative `CursorEffects` island, which is enhancement-only (fine pointers,
  no `prefers-reduced-motion`).

### Svelte 5 runes vs legacy mode

Svelte 5 supports both runes and the legacy reactivity model, and this repo uses
both intentionally:

- **Runes** (`$state` / `$props`): `ScrollProgress`, `BackToTop`, `ParticleSystem`,
  `ContactForm`, `CursorEffects` — components with genuine reactive component state.
- **Legacy mode**: `NavigationMenu` and `ThemeTransition` — these run
  imperative `onMount` DOM logic (Intersection Observer, class toggling) and
  don't need rune-based reactivity.

> `svelte.config.js` at the repo root is **required** by `@astrojs/svelte 9`. It
> applies `vitePreprocess()`, enabling TypeScript, PostCSS, and other
> preprocessing inside `.svelte` files.

## Fonts (astro:fonts)

Fonts are **self-hosted through `astro:fonts`** — there are no manual `.woff2`
files in the repo. Nine Google families are configured in `astro.config.mjs`,
each exposing a CSS variable consumed by `src/styles/variables.css`:

| Family | CSS variable | Weights |
|---|---|---|
| Outfit | `--font-outfit` | `100 900` (variable) |
| Open Sans | `--font-open-sans` | `300 800` (variable) |
| Inter | `--font-inter` | `100 900` (variable) |
| Rajdhani | `--font-rajdhani` | `300, 400, 500, 600, 700` (discrete) |
| Space Grotesk | `--font-space-grotesk` | `300 700` (variable) |
| DM Sans | `--font-dm-sans` | `100 1000` (variable) |
| Sora | `--font-sora` | `100 800` (variable) |
| Nunito | `--font-nunito` | `200 1000` (variable) |
| Quicksand | `--font-quicksand` | `300 700` (variable) |

All families use the `latin` subset and a `sans-serif` fallback. In
`BaseLayout.astro`, each family is emitted with an `<Font>` component. Preloads
are **theme-aware**: every page preloads the corporate fonts (`--font-outfit`,
`--font-open-sans`), and each themed page additionally preloads its hero
heading family — Rajdhani (narrowed to the weight-700 file) on `/fabrication/`,
Space Grotesk on `/3d-lab/`, Sora on `/greenhouse/` and `/orchard/`. The
remaining fonts load on demand. `astro:fonts` generates **fallback metrics
automatically**, which is a key contributor to the site's **CLS of 0**.

## Styling

- **Global CSS** lives in `src/styles/*.css` and is **imported in the
  `BaseLayout.astro` frontmatter** so Astro bundles, hashes, and injects it. Import
  order is preserved to match the intended cascade.
  - Do **not** reference these files via `<link href="/src/styles/*.css">` —
    `src/` is not served in a production build, so that approach only appears to
    work in dev and breaks in `dist/`.
- **Component-scoped CSS** lives inside each `.svelte` component's `<style>` block.

## Contact Form (self-hosted API)

`ContactForm.svelte` posts to **`/api/contact`**, a small Node service in
`services/contact-api/` that runs as its own container on the same origin (Caddy
proxies `/api/*` to it). There is no third-party form service.

The form works with and without JavaScript:

1. **Hydrated path.** The island validates client-side, then `fetch`es
   `/api/contact` with a JSON body and renders the result in place — success,
   inline per-field errors from a `400 {"fields": {...}}` response, or a
   distinct message for `429` (rate limited). No page navigation.
2. **No-JS path.** The form element itself carries
   `action="/api/contact" method="POST"`, so a native submit sends
   `application/x-www-form-urlencoded` to the same endpoint. The API answers
   with a `303` redirect to `/contact-received/`, or
   `/contact-received/?error=1` on a validation failure —
   `src/pages/contact-received.astro` renders both outcomes (it is `noindex` and
   filtered out of the sitemap).

`novalidate` is **hydration-gated** (`novalidate={hydrated || undefined}`), so
the server-rendered HTML keeps native `required`/`email` validation for
pre-hydration and no-JS submits and only hands over to `validate()` once the
island is live.

Spam protection is a honeypot input named **`website`** — off-screen via CSS,
inside an `aria-hidden` container, `tabindex="-1"`, `autocomplete="off"`. A
filled honeypot receives a normal success response and is silently discarded.

The service validates and rate-limits server-side, appends each inquiry to a
JSONL log **before** reporting success, and only then attempts an optional
email. See [`services/contact-api/README.md`](./services/contact-api/README.md).

## Development Workflow

```bash
npm install          # install dependencies (Node >= 22.12)

npm run dev          # dev server with HMR at http://localhost:4321
npm run build        # static build → dist/
npm run preview      # preview the production build locally
npm run sync         # regenerate Astro-generated types (.astro/types.d.ts)
```

Run `npm run sync` after changing content collections or when TypeScript
complains about missing generated types.

## Performance validation

The island model, deferred hydration, minification, and generated font fallback
metrics remain in place. Re-run Lighthouse on desktop and mobile after any
substantial content or layout change; older scores are historical and should
not be quoted as current without a fresh audit.

## Deployment

The site is **self-hosted on the company's own VPS** — three Docker containers:
Caddy at the edge (TLS, Let's Encrypt, reverse proxy), Apache serving the built
static site, and the `contact-api` service behind `/api/*`. Only Caddy publishes
ports.

```bash
docker compose up -d --build
```

The static build happens **inside** the image (`node:22-alpine` builder stage),
and `dist/` is copied into the Apache stage — it is not bind-mounted, so content
changes need a rebuild rather than a restart.

- [`docs/DEPLOYMENT-VPS.md`](./docs/DEPLOYMENT-VPS.md) — the primary operator
  guide (DNS, certificates, first deploy, inquiries, backups, email, sub-sites,
  troubleshooting).
- [`DOCKER-DEPLOYMENT.md`](./DOCKER-DEPLOYMENT.md) — container reference (image
  internals, Apache/Caddy configuration, cache and compression policy).

## What Changed in the Astro 7 / Svelte 5 Upgrade

For context, if you're coming from the older Astro 4 + Svelte 4 setup:

- **Astro 4 → 7**, **Svelte 4 → 5** (runes), **`@astrojs/svelte` → 9**; Node
  minimum raised to **22.12**.
- Added a root **`svelte.config.js`** (now required by `@astrojs/svelte 9`).
- **`astro-compress` was removed** — Vite/terser minify JS/CSS and
  `compressHTML: 'jsx'` handles HTML, so it was redundant.
- Custom Rollup `manualChunks` splitting (e.g. isolating `svelte/internal`) is no
  longer used; Astro 7's Rolldown-based bundler handles chunking.
- **Fonts moved to `astro:fonts`** — the old manual `/fonts/*.woff2` files and
  `@font-face` declarations were dropped in favour of self-hosted Google Fonts
  with generated fallback metrics.
- Global CSS is now **imported in `BaseLayout` frontmatter** rather than linked
  via `<link href="/src/styles/*.css">` (which does not work in production).

---

For business/division content and the top-level project overview, see
[`README.md`](./README.md).
