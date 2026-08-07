# Claude Development Documentation

**Project**: Fluxology Inc. Website
**Type**: Multi-route static corporate website (long-form homepage + four DBA detail routes + 404)
**Stack**: Astro 7 (static) + Svelte 5 islands + TypeScript
**Version**: 2.0.0
**Last Updated**: August 2026

This document is the technical reference for AI assistants and developers working on the Fluxology website. Every file path, component name, and API below is verified against the current codebase. When you change the architecture, update this file to match.

---

## Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Directory Layout](#directory-layout)
4. [Components](#components)
5. [Styling & Theming](#styling--theming)
6. [Fonts](#fonts)
7. [Contact Form](#contact-form)
8. [Service Worker / PWA](#service-worker--pwa)
9. [Security](#security)
10. [Performance](#performance)
11. [Build & Deploy](#build--deploy)
12. [Development Workflow](#development-workflow)
13. [Common Modifications](#common-modifications)

---

## Project Overview

### Business Context

Fluxology Inc. is a Canadian Controlled Private Corporation (CCPC) planning four proposed DBAs (Doing Business As). Each DBA is rendered as a themed section on the long-form homepage *and* as its own generated detail route:

1. **Fluxology Fabrication & Welding** (`/fabrication/`) — provisional primary NAICS **811310** if repair work leads actual corporate revenue — `industrial` theme
2. **Fluxology 3D Lab** (`/3d-lab/`) — provisional service NAICS **541420** — `tech` theme
3. **Fluxology Greenhouse** (`/greenhouse/`) — secondary NAICS **111419** only when commercial covered-crop activity exists — `natural` theme
4. **Fluxology Orchard & Food Forest** (`/orchard/`) — secondary NAICS **111330** when fruit/tree-nut sales become a real activity — `natural` theme

> **`src/data/dbaPlans.ts` is the source of truth** for all DBA names, status, classification (NAICS) language, scope, and imagery. Do not restate classification claims from memory — quote `dbaPlans.ts`.

The Hero, About, Operating Model, Roadmap, and Contact sections use the `corporate` theme.

### Design Goals

- Long-form scrollable homepage with smooth per-section theme transitions, plus a themed detail page per DBA
- Distinct visual identity (colors + fonts) per business division
- Performance-first: static HTML, minimal JS shipped only where interactivity is needed
- Accessibility (skip link, ARIA, `prefers-reduced-motion`, `<noscript>` reveal fallback)
- Mobile-first responsive design
- Lighthouse 100 across categories (see [Performance](#performance))

---

## Architecture

### Astro + Svelte Islands

The site is a static Astro app (`output: 'static'`). Astro renders all markup to HTML at build time. Interactivity is added through **Svelte 5 islands** — individual components hydrated on the client via Astro's `client:*` directives — rather than shipping a full SPA. Everything that can be static, is static.

- **Static Astro components** (`.astro`) render to plain HTML with zero client JS: `Navigation`, `Hero`, `About`, `OperatingModel`, `DBASection`, `Roadmap`, `DBADetailPage`, `Footer`.
- **Svelte islands** (`.svelte`) ship JS and hydrate in the browser: `ScrollProgress`, `ThemeTransition`, `BackToTop`, `NavigationMenu`, `ParticleSystem`, `ContactForm`, `CursorEffects`.

### Routes & Data Flow

The build emits **six routes**: `/`, `/fabrication/`, `/3d-lab/`, `/greenhouse/`, `/orchard/`, and `/404.html`.

- **`src/pages/index.astro`** — the long-form homepage. It wraps content in `src/layouts/BaseLayout.astro` and composes Hero, About, OperatingModel, the four DBA sections, Roadmap, and Contact. The DBA sections are data-driven: `index.astro` imports `dbaOverviews` from **`src/data/dbaPlans.ts`** and maps each overview over `<DBASection {...dba}>` (with a slotted `<ParticleSystem>`).
- **`src/pages/[dba].astro`** — a dynamic route whose `getStaticPaths()` maps `dbaPlans` to the four DBA slugs; each page renders `<DBADetailPage plan={plan} />` (scope/capital tables, controls, milestones, gallery, local page nav).
- **`src/pages/404.astro`** — branded 404 with full site navigation; passes `noindex` to `BaseLayout` so no canonical/`og:url` is emitted.
- **`src/data/dbaPlans.ts`** — the single typed data layer. Each `DbaPlan` holds a `slug`, `shortName`, an `overview` (consumed by the homepage `DBASection`) and a `detail` (consumed by `DBADetailPage`). Image references are typed `ImageMetadata` ESM imports from `src/assets/images/` (astro:assets), not string paths.

### Hydration Directives

Directives are assigned in `index.astro`, `404.astro`, `DBADetailPage.astro`, and `BaseLayout.astro`:

| Component | Directive | Rationale |
|-----------|-----------|-----------|
| `ScrollProgress` | `client:load` | Needs to track scroll immediately |
| `ThemeTransition` | `client:load` | Drives theme + reveal animations from first paint |
| `BackToTop` | `client:load` | Listens for scroll from the start |
| `NavigationMenu` | `client:load` | Wires up the nav rendered by the static `Navigation` component |
| `ParticleSystem` | `client:visible` | Decorative; hydrate only when its section scrolls into view |
| `ContactForm` | `client:visible` | Below the fold; defer hydration until visible |
| `CursorEffects` | `client:idle` | Site-wide cursor enhancement (rendered from `BaseLayout.astro`); purely decorative, hydrate when the browser is idle |

### Svelte 5 Runes vs. Legacy Mode

Svelte 5 is used. Components fall into two styles:

- **Runes mode** (`$state`, `$props`): `ContactForm`, `ParticleSystem`, `BackToTop`, `ScrollProgress`, `CursorEffects`. These hold reactive UI state.
- **Legacy / lifecycle-only** (`onMount` + imperative DOM, no runes): `NavigationMenu` and `ThemeTransition`. These render no visual output of their own; they attach listeners and observers to DOM produced by the static Astro components.

`svelte.config.js` enables `vitePreprocess()` for TypeScript/PostCSS inside `.svelte` files.

### Theme + Reveal System (`ThemeTransition.svelte`)

This legacy-mode island is the heart of the scroll experience. On mount it:

1. Selects every `[data-theme]` section and attaches a single `IntersectionObserver` (`rootMargin: '-20% 0px -20% 0px'`, `threshold: 0`) — a section is "active" when it occupies the middle 60% of the viewport.
2. When a section intersects, it:
   - Calls `applyTheme(theme)` — writes the section's palette/fonts to `--current-*` CSS custom properties on `:root` (an in-component `themes` object mirrors the CSS values). CSS transitions animate the color change.
   - Calls `updateActiveNavLink(sectionId)` — toggles `.active` / `aria-current` on the matching `.nav-link`.
   - Adds `.observed` to that section's `.observe-fade` / `.observe-slide-up` / `.observe-scale` elements, triggering their reveal animations (defined in `transitions.css`).
3. Separately, a throttled scroll handler toggles `.scrolled` on `#mainNav` past 100px.

**Reveal-on-scroll** works purely through CSS: `.observe-*` elements start at `opacity: 0` (and a transform), and gain `.observed` to animate to their resting state.

**LCP exemption**: the Hero's above-the-fold content is *not* wrapped in `.observe-*` classes, so it paints immediately without waiting for JS hydration.

**No-JS fallback**: `BaseLayout.astro` includes a `<noscript>` block that forces all `.observe-*` elements to `opacity: 1; transform: none`, so content is never permanently hidden when JavaScript is unavailable.

---

## Directory Layout

```
fluxology-site/
├── astro.config.mjs            # Astro config: svelte + sitemap integrations, prefetch, fonts, vite/terser
├── svelte.config.js            # Svelte preprocess config
├── tsconfig.json               # Extends astro/tsconfigs/strict, svelte JSX
├── netlify.toml                # Primary deploy: build + security/cache headers
├── Dockerfile                  # Alternative deploy: node builder -> Apache
├── docker-compose.yml          # Container orchestration for the Docker deploy
├── package.json                # v2.0.0, Node >= 22.12
├── DOCKER-DEPLOYMENT.md         # Docker/Apache deployment guide
├── public/                     # Copied verbatim into dist/
│   ├── favicon.svg             # SVG favicon (no favicon.ico)
│   ├── favicon-32.png          # PNG favicon fallback
│   ├── apple-touch-icon.png    # iOS home-screen icon
│   ├── icon-192.png / icon-512.png            # PWA icons ("any")
│   ├── icon-192-maskable.png / icon-512-maskable.png  # PWA icons ("maskable")
│   ├── badge-72.png            # Notification badge (referenced by the SW push handler)
│   ├── site.webmanifest        # PWA manifest (theme/background #1B3A4B)
│   ├── robots.txt              # Points at /sitemap-index.xml
│   ├── offline.html            # Branded SW offline fallback page
│   ├── service-worker.js       # PWA offline caching (readable source; minified postbuild)
│   └── images/corporate/       # ONLY flux-background.webp + logo-medallion.webp
│                               #   (stable URLs for a CSS background and og:image)
├── scripts/
│   └── prune-unused-images.mjs # Postbuild: deletes unreferenced .webp originals from dist/_assets
└── src/
    ├── assets/
    │   └── images/             # Source images (WebP) processed by astro:assets:
    │                           #   corporate/, fabrication/, 3d-lab/, greenhouse/, orchard/
    ├── pages/
    │   ├── index.astro         # Long-form homepage; maps dbaOverviews over DBASection
    │   ├── [dba].astro         # getStaticPaths over dbaPlans -> four DBA detail routes
    │   └── 404.astro           # Branded 404 (noindex, full navigation)
    ├── data/
    │   └── dbaPlans.ts         # Typed DBA content: overview + detail per plan (source of truth)
    ├── layouts/
    │   └── BaseLayout.astro    # <head>, global CSS imports, <Font> tags, SW registration, CursorEffects island
    ├── components/
    │   ├── Navigation.astro     # Static nav bar markup (+ skip link)
    │   ├── Hero.astro           # Static hero (LCP region)
    │   ├── About.astro          # Static about section
    │   ├── OperatingModel.astro # Static company operating architecture section
    │   ├── DBASection.astro     # Static reusable DBA homepage section (props-driven)
    │   ├── DBADetailPage.astro  # Static reusable DBA detail page (tables, gallery, local nav)
    │   ├── Roadmap.astro        # Static 2026-2035 staged roadmap section
    │   ├── Footer.astro         # Static footer
    │   ├── ScrollProgress.svelte    # Island: top scroll progress bar
    │   ├── ThemeTransition.svelte   # Island: IntersectionObserver theme + reveal driver
    │   ├── BackToTop.svelte         # Island: back-to-top button
    │   ├── NavigationMenu.svelte    # Island: mobile menu toggle, focus trap, smooth scroll
    │   ├── ParticleSystem.svelte    # Island: per-theme decorative particles
    │   ├── ContactForm.svelte       # Island: validated Netlify Forms contact form
    │   └── CursorEffects.svelte     # Island: themed cursor dot/ring (fine pointers only)
    └── styles/                  # 7 global stylesheets (imported by BaseLayout)
        ├── reset.css
        ├── variables.css        # Design tokens (colors, type, spacing, fonts, --current-*)
        ├── base.css
        ├── themes.css           # [data-theme] + section-id theme mappings
        ├── transitions.css      # Animations, keyframes, .observe-* reveal classes
        ├── utilities.css        # Perf/containment utility classes
        └── responsive.css       # Mobile-first media queries
```

> `sitemap-index.xml` / `sitemap-0.xml` are **generated at build time** by `@astrojs/sitemap` — they live in `dist/`, not `public/`.

> The previous vanilla implementation (`src/index.html`, `src/scripts/*.js`) no longer exists. There is no `main.js`, `scroll-controller.js`, `theme-manager.js`, `animations.js`, or `form-handler.js` — that behavior now lives in the Svelte islands above.

---

## Components

### Static Astro components

- **`Navigation.astro`** — Renders the fixed nav bar: logo, hamburger `#navToggle`, and `#navLinks` list (Company / Model / Fabrication / 3D Lab / Greenhouse / Orchard / Roadmap / Contact — the four DBA links point at the detail routes; the rest are homepage anchors). Includes the skip-to-content link. Ships no JS; behavior is added by `NavigationMenu.svelte` and `ThemeTransition.svelte`, which query these elements by id/class.
- **`Hero.astro`** — Above-the-fold hero (`#hero`, `corporate` theme). Renders immediately (no `.observe-*` gating) because it is the LCP region.
- **`About.astro`** — `#about` (`corporate`). Uses `.observe-fade` / `.observe-slide-up` for reveal. Renders four operating-principle images via astro:assets `<Image>`.
- **`OperatingModel.astro`** — `#operating-model` (`corporate`). Company operating architecture (lanes, capital rules).
- **`DBASection.astro`** — Reusable, props-driven homepage section fed by a `DbaOverview` from `dbaPlans.ts`. Props interface (see the file for authority): required `id`, `theme`, `name`, `status`, `classification`, `description`, `facts[]`, `services[]`, `processTitle`, `processSteps[]`, `boundary`, `detailHref`; optional `eyebrow`, `servicesTitle`, `servicesIntro`, `processIntro`, `showcaseImages[]`, `sectionBackground`, `ctaText`, `ctaNote`, `particleVariant`. Image props are typed `ImageMetadata` and rendered responsively with astro:assets `<Image>` (480/800/1200 width ladder); `sectionBackground` becomes a `getImage()`-optimized CSS texture URL. Includes a `<slot name="particles">` filled by `ParticleSystem`. CSS containment (`contain: layout style paint`) comes from `utilities.css` (`content-visibility` was removed — its intrinsic-size estimates broke anchor scrolling).
- **`Roadmap.astro`** — `#roadmap` (`corporate`). Staged 2026-2035 implementation roadmap with capital rules.
- **`DBADetailPage.astro`** — Reusable full detail page rendered by `[dba].astro` from a `DbaPlan`. Hero image (eager, `fetchpriority=high`), role/scope, offer and capital tables, operating controls, milestones, gallery (lazy astro:assets images), local sticky section nav, and planning note.
- **`Footer.astro`** — Site footer with division/company links and a `#currentYear` span populated by an inline script in `BaseLayout`.

### Svelte islands

- **`ScrollProgress.svelte`** (runes) — Fixed top progress bar. `$state` `progress`; a `requestAnimationFrame`-throttled passive scroll listener updates width. Exposes `role="progressbar"` with live `aria-valuenow`.
- **`ThemeTransition.svelte`** (legacy) — See [Theme + Reveal System](#theme--reveal-system-themetransitionsvelte). No visual output.
- **`BackToTop.svelte`** (runes) — Fixed button; `$state` `visible` becomes true past 500px scroll (rAF-throttled). Smooth-scrolls to top on click.
- **`NavigationMenu.svelte`** (legacy) — On mount, wires `#navToggle`/`#navLinks`: toggles the `.open` class and `aria-expanded`, closes on link click / outside click / Escape. While the collapsed overlay is open it **manages focus**: moves focus to the first `.nav-link` on open, traps `Tab`/`Shift+Tab` in a wrap-around cycle over the toggle + links, and returns focus to the toggle on Escape / outside click / in-page navigation (never stranding focus in the hidden panel). No visual output.
- **`ParticleSystem.svelte`** (runes) — Props: `theme`, optional `variant` (`'spark' | 'digital' | 'leaf' | 'mist' | 'dot'`; defaults derive from the theme). Generates 15 particles (8 below 768px) with randomized position/size/duration/delay into `$state`; density **regenerates** on debounced viewport media-query changes instead of freezing at hydration. Yields zero particles under `prefers-reduced-motion: reduce` (re-checked at each regeneration). Particle CSS class by variant: `spark-particle`, `digital-particle`, `leaf-particle`, `mist-particle`, or `particle`. Keyframes live in the component's scoped `<style>`.
- **`ContactForm.svelte`** (runes) — See [Contact Form](#contact-form).
- **`CursorEffects.svelte`** (runes, `client:idle` from `BaseLayout.astro` on every page) — Layered custom cursor: a precise dot plus a lerped trailing ring that grows over interactive elements and pulses on click, colored by `--current-accent-primary` so it re-themes per section. Enabled only for `(hover: hover) and (pointer: fine)` and never under `prefers-reduced-motion`; both media queries are watched at runtime with `change` listeners that start/stop the rAF loop and listeners rather than sampling once at mount.

---

## Styling & Theming

### CSS architecture

Seven global stylesheets are imported (not `<link>`ed) in the frontmatter of `BaseLayout.astro`, in cascade order:

```
reset.css → variables.css → base.css → themes.css → transitions.css → utilities.css → responsive.css
```

> Global CSS must be **imported** in a component/layout so Astro bundles, hashes, and injects it. `<link href="/src/styles/*.css">` does not work in a production build because `src/` is not served. Svelte components additionally use scoped `<style>` blocks for component-local styling.

### Design tokens (`variables.css`)

`:root` defines the full design system:

- **Typography** — Major Third (1.250) scale, `--font-size-xs` … `--font-size-4xl`; line heights, letter spacing, font weights.
- **Semantic font families** — e.g. `--font-corporate-heading: var(--font-outfit)`, `--font-industrial-heading: var(--font-rajdhani)`, mapping the astro-generated `--font-*` variables to design roles (see [Fonts](#fonts)).
- **Four color palettes** — full color scales for `corporate`, `industrial`, `tech`, and `natural`, plus WCAG-AA companion tokens (`*-text`, `*-ink`, `*-deep`, `*-pressed`, `*-bright`) that shift lightness only, used where the canonical brand hue cannot reach 4.5:1 contrast (CTA text/surfaces, accent copy on dark surfaces, form errors, placeholders).
- **Spacing, layout, z-index, transitions/easings, radii, shadows.**
- **`--current-*` variables** — the *active* theme's background/text/accent/font values. Default to the corporate palette; overwritten at runtime by `ThemeTransition.svelte` and by the static `[data-theme="…"]` rules.

### Theme mapping (`themes.css`)

Two mechanisms map a section to its theme:

1. **`[data-theme="…"]` selectors** set the `--current-*` variables statically (so the correct theme applies before/without JS).
2. **Section-id selectors** (`#fabrication`, `#\33 d-lab`, `#greenhouse`, `#orchard`, `#contact`) apply gradients, textures, and per-theme component styling (service-card borders, CTA variants, name/naics typography, etc.).

> `#3d-lab` is escaped as `#\33 d-lab` in CSS because an id selector cannot begin with a digit.

At runtime `ThemeTransition.applyTheme()` additionally writes `--current-*` inline on `:root` as sections scroll by, letting fixed-position islands (progress bar, back-to-top) recolor to the active theme via `var(--current-accent-primary)`.

---

## Fonts

Fonts are **self-hosted and optimized by Astro's built-in `astro:fonts`** — there are no manually committed `.woff2` files and no Google Fonts `<link>` tags. See `docs/FONTS.md` for the workflow.

**Configuration** (`astro.config.mjs`): nine Google families are declared via `fontProviders.google()`, each exposing a CSS variable and subset to `latin`:

| Family | Variable | Used by (semantic role) |
|--------|----------|-------------------------|
| Outfit | `--font-outfit` | corporate heading |
| Open Sans | `--font-open-sans` | corporate body |
| Inter | `--font-inter` | industrial body |
| Rajdhani | `--font-rajdhani` | industrial heading |
| Space Grotesk | `--font-space-grotesk` | tech heading |
| DM Sans | `--font-dm-sans` | tech body |
| Sora | `--font-sora` | natural heading |
| Nunito | `--font-nunito` | natural body |
| Quicksand | `--font-quicksand` | natural accent |

**Rendering** (`BaseLayout.astro`): a `<Font cssVariable="…">` component is emitted for each family. Preloads are **theme-aware**: every page preloads the corporate fonts (`--font-outfit`, `--font-open-sans` — nav wordmark, links, body copy), and themed pages additionally preload their hero heading family — Rajdhani (filtered to the single weight-700 file, since Rajdhani ships discrete weights) for `industrial`, Space Grotesk for `tech`, Sora for `natural`. The theme resolves from an optional `theme` prop on `BaseLayout`, else from the URL via `dbaPlans` slugs, else `corporate`. The rest load on demand. Astro generates optimized fallback metrics so CLS stays 0. `variables.css` maps each generated `--font-*` to a semantic role.

> `Poppins`, `JetBrains Mono`, and `Fira Code` are **no longer referenced**: `--font-corporate-accent` now maps to `var(--font-outfit)` (loaded), and `--font-industrial-technical` / `--font-tech-technical` map to a system monospace stack.

---

## Contact Form

`ContactForm.svelte` (runes mode) handles the contact section and submits through **Netlify Forms**.

- **State**: `formData` (`$state`) holds the fields (`companyName`, `fullName`, `email`, `phone`, `serviceInterest`, `message`); separate `$state` for `botField`, `errors`, `isSubmitting`, `submitStatus`, `submitMessage`.
- **Validation**: `novalidate` is **hydration-gated** (`novalidate={hydrated || undefined}`) — the server-rendered HTML carries no `novalidate`, so native `required`/`email` validation guards pre-hydration and no-JS submits; after hydration, client-side `validate()` takes over. It requires `fullName` (≥2 chars), a valid `email`, a selected `serviceInterest`, and `message` (≥10 chars). Errors render inline with `role="alert"` and `aria-invalid`; typing into a field clears its error. The submit status region is **permanently in the DOM** (`aria-live` with a `role="status"`/`"alert"` swap) so screen readers hear submit results.
- **Submission**: `handleSubmit` `preventDefault`s, validates, then AJAX-POSTs `application/x-www-form-urlencoded` data (including `form-name` and the honeypot `bot-field`) to `/`. Netlify intercepts the POST to `/`. Success resets the form and shows an in-page success message; failure shows an error with a fallback email address. No page navigation occurs.
- **Spam protection**: the `bot-field` honeypot (declared via `netlify-honeypot="bot-field"`) is visually hidden but submitted; bots that fill it are silently rejected.

**Netlify form detection**: Netlify's build bot registers forms by parsing *static* HTML at deploy time, but the real form is a client-hydrated Svelte island invisible to the bot. To bridge this, `index.astro` includes a **hidden static `<form name="contact" data-netlify="true">`** whose field names match the Svelte form. This registers the "contact" form so the island's AJAX submissions are accepted.

---

## Service Worker / PWA

`public/service-worker.js` provides offline support and runtime caching. It is registered by an inline script in `BaseLayout.astro` on `window.load`.

- **Cache versioning**: a single `CACHE_VERSION` constant (currently `v2.4.0` — check the file, don't trust docs) derives both cache names (`fluxology-<v>`, `fluxology-runtime-<v>`); one bump rotates both, and the `activate` handler deletes any cache not in the current set.
- **Precache**: `ASSETS_TO_CACHE = ['/', '/offline.html']`, fetched with `cache: 'reload'` so entries come from the network. Install then **primes the runtime cache** by crawling the shell's real subresources — HTML asset attributes (incl. Astro island `component-url`/`renderer-url`), inline-`<style>` `url()` refs (astro:fonts emits `@font-face` inline), fetched CSS `url()` refs, and JS import specifiers — so a single visit makes the site render styled *and* hydrated offline. The crawl is best-effort; a missing asset cannot fail the install.
- **Fetch strategy** (three branches):
  - Non-GET and cross-origin requests pass straight through (contact form POST untouched). Origin is compared via `new URL(request.url).origin`, not a string prefix.
  - **Navigations / HTML**: network-first, caching successful basic responses; offline fallback is the cached copy of the requested URL, else the precached `/offline.html` **re-served with status 503** (an uncached route is never impersonated as a 200).
  - **`/_assets/*`** (content-hashed): cache-first forever — the hash changes when content does.
  - **All other same-origin assets** (unhashed `public/` files: images, icons, manifest, robots…): **stale-while-revalidate** — serve the cache, refresh in the background with `cache: 'no-cache'` so replaced files reach returning visitors without a version bump.
- Includes stubbed `push` / `notificationclick` handlers for future notification support; the referenced `/icon-192.png` and `/badge-72.png` **ship in `public/`**.
- There is **no `SKIP_WAITING` message handler** — install calls `skipWaiting()` unconditionally and activate claims clients, so a waiting worker never exists.
- **Minification**: the `postbuild` npm script runs terser over `dist/service-worker.js` (public/ files bypass the bundler); the source copy stays readable.

PWA installability comes from `public/site.webmanifest` (`theme_color`/`background_color` `#1B3A4B`, matching the rendered site background and the `<meta name="theme-color">` in `BaseLayout`) plus the icon set in `public/`.

`netlify.toml` sends `Cache-Control: no-cache, no-store, must-revalidate` for `/service-worker.js` so it is always revalidated.

---

## Security

Hardened HTTP headers are configured in **`netlify.toml`** (Netlify deploys) and mirrored in **`docker/apache/httpd.conf`** (Docker/Apache deploys):

- `Content-Security-Policy`: `default-src 'self'`; `script-src`/`style-src 'self' 'unsafe-inline'`; `img-src 'self' data: https:`; `font-src 'self' data:`; `connect-src 'self'`; `frame-ancestors 'self'`; **`base-uri 'self'`**; **`form-action 'self'`**; **`object-src 'none'`**.
- `X-Frame-Options: SAMEORIGIN`
- `X-Content-Type-Options: nosniff`
- `X-XSS-Protection: 0` (the CSP supersedes the legacy auditor)
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: geolocation=(), microphone=(), camera=()`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains` (Netlify serves over HTTPS)

Content-hashed assets under `/_assets/*` are served `Cache-Control: public, max-age=31536000, immutable`.

---

## Performance

Historical baseline (pre-expansion single-page build): Lighthouse 100 desktop / 99 mobile performance, LCP ~0.5s desktop, CLS 0, TBT 0. Re-audit after material changes rather than quoting these as current.

Contributing techniques:

- Static HTML with islands — client JS ships only for the seven hydrated components, each hydrated at the cheapest safe moment (`client:visible` for below-the-fold, `client:idle` for the decorative cursor).
- Hero LCP region renders without hydration or reveal gating; hero/LCP images load eager with `fetchpriority="high"`.
- **Responsive images via astro:assets** — `<Image>` with a 480/800/1200 width ladder, per-slot `sizes`, intrinsic dimensions from image metadata, lazy + async below the fold.
- **Prefetch** — `prefetch: { prefetchAll: true, defaultStrategy: 'viewport' }` in `astro.config.mjs` warms cross-page navigation.
- Fonts preloaded selectively (corporate + per-theme heading family) with generated fallback metrics.
- CSS containment (`contain: layout style paint`) on page sections (`content-visibility` was removed — its intrinsic-size estimates broke anchor targeting).
- Scroll handlers are passive and `requestAnimationFrame`-throttled.
- Particles reduced on mobile (and hidden by CSS below 768px), disabled under `prefers-reduced-motion`.
- Production JS minified by **terser** with `drop_console: true` and 2 passes; CSS minified by **lightningcss**; HTML compression via Astro's default `compressHTML: 'jsx'`. (The old `astro-compress` integration and manual `manualChunks`/`svelte/internal` config have been removed.)
- **Postbuild pipeline** (`npm run build` → npm `postbuild` hook): terser-minifies `dist/service-worker.js`, then `scripts/prune-unused-images.mjs` deletes `.webp` originals in `dist/_assets` that no built HTML/CSS/JS references (Vite copies every imported original even when only renditions are used).

---

## Build & Deploy

### Toolchain

- **Astro 7.1.3**, **Svelte 5.56.7**, **@astrojs/svelte 9.0.1**, **TypeScript 5.7.2**.
- Dev dependencies: `@astrojs/sitemap` (generated sitemap), `sharp` (image processing for astro:assets), `terser` (JS/SW minification), `typescript`.
- **Node >= 22.12** (required by Astro 7).
- Astro 7 builds on **Vite + Rolldown**; native toolchain binaries arrive via `optionalDependencies` (so `npm ci --ignore-scripts` is safe).

### npm scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `astro dev` | Local dev server with HMR |
| `build` | `astro build` | Static build to `dist/` (triggers `postbuild`) |
| `postbuild` | `terser dist/service-worker.js … && node scripts/prune-unused-images.mjs` | Runs automatically after `npm run build`: minifies the SW, prunes unreferenced image originals from `dist/_assets` |
| `preview` | `astro preview` | Serve the built `dist/` locally |
| `sync` | `astro sync` | Regenerate Astro type definitions |

> Pipelines that invoke `astro build` directly (instead of `npm run build`) skip the `postbuild` step.

`astro.config.mjs` sets `site: 'https://fluxology.ca'`, `output: 'static'`, `build.assets: '_assets'` (custom asset directory instead of the default `_astro`), the `@astrojs/sitemap` integration (emits `/sitemap-index.xml` + `/sitemap-0.xml`, filtering out the 404 page), and viewport-strategy prefetch.

### Netlify (primary)

`netlify.toml`: `command = "npm run build"`, `publish = "dist"`, `NODE_VERSION = "22"`, plus the security/cache headers above. The build requires outbound access to Google Fonts (astro:fonts downloads at build time).

### Docker + Apache (alternative)

Multi-stage `Dockerfile`: `node:22-alpine` builder runs `npm ci --ignore-scripts && npm run build`, then `httpd:2.4-alpine` serves `dist/` with `docker/apache/httpd.conf` + `docker/apache/vhost.conf` (including a health check). See **`DOCKER-DEPLOYMENT.md`** for full Docker instructions rather than duplicating them here.

---

## Development Workflow

1. `npm install` (Node ≥ 22.12).
2. `npm run dev` — edit components/styles with HMR.
3. TypeScript is strict (`astro/tsconfigs/strict`); run `npm run sync` after adding content collections or when types drift.
4. `npm run build && npm run preview` to validate the production output (minification, hashed assets, service worker) before deploying.
5. Commit; Netlify builds on push. For Docker, `docker build` per `DOCKER-DEPLOYMENT.md`.

Notes:
- `drop_console: true` strips `console.*` from the production client bundle, so debug logging only appears in dev.
- The service worker caches aggressively; bump the single `CACHE_VERSION` constant in `public/service-worker.js` when shipping SW-behavior changes. Unhashed assets no longer strictly need a bump (they are stale-while-revalidated), but a bump on behavior changes is still good hygiene.

---

## Common Modifications

### Add or edit a DBA

Edit **`src/data/dbaPlans.ts`** — the `dbaPlans` array is the single source of truth. Each `DbaPlan` needs a `slug`, `shortName`, an `overview` (drives the homepage `DBASection`: `id`, `theme`, `name`, `status`, `classification`, `description`, `facts`, `services`, `processSteps`, `boundary`, `showcaseImages`, `detailHref`, …) and a `detail` (drives the `/slug/` page via `DBADetailPage`: hero image, offer/capital tables, controls, milestones, gallery, planning note). Image fields are typed `ImageMetadata` — add source files under `src/assets/images/<dba>/` and import them at the top of `dbaPlans.ts`. Then:

1. Add a nav link in `Navigation.astro` and a footer link in `Footer.astro`.
2. If introducing a **new theme**, add its palette to `variables.css`, a `[data-theme="…"]` block plus section-id styling to `themes.css`, and a matching entry in the `themes` object in `ThemeTransition.svelte`. Add a particle variant in `ParticleSystem.svelte` if desired.

The homepage section, the generated `/slug/` route, the sitemap entry, and the per-theme font preload all follow automatically from the new `dbaPlans` entry. A `<ParticleSystem slot="particles" theme={dba.theme} variant={dba.particleVariant} client:visible />` is already wired for every mapped section.

### Change a color or font

- **Color**: edit the token in `variables.css`; all `var(...)` consumers update automatically.
- **Font**: add/edit the entry in the `fonts` array in `astro.config.mjs`, add a matching `<Font cssVariable="…" />` in `BaseLayout.astro` (with `preload` only if above the fold), then reference it via a semantic `--font-*` variable in `variables.css`.

### Adjust reveal behavior

Reveal is driven by `.observe-fade` / `.observe-slide-up` / `.observe-scale` classes (defined in `transitions.css`) plus the `.observed` toggle applied by `ThemeTransition.svelte`. Add these classes to any element to have it animate in as its section enters the viewport. Do **not** add them to LCP-critical hero content.

---

**Document Version**: 2.1.0
**Last Updated**: August 2026
**Next Review**: When the component set, theme system, or deploy targets change.
