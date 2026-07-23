# Claude Development Documentation

**Project**: Fluxology Inc. Website
**Type**: Single-page scrollable corporate website
**Stack**: Astro 7 (static) + Svelte 5 islands + TypeScript
**Version**: 2.0.0
**Last Updated**: July 2026

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

Fluxology Inc. is a Canadian Controlled Private Corporation (CCPC) operating four distinct DBAs (Doing Business As), each rendered as its own themed section on a single scrollable page:

1. **Fluxology Fabrication & Welding** — NAICS 332710 (Machine Shops) — `industrial` theme
2. **Fluxology 3D Lab** — NAICS 541990 (Professional/Scientific/Technical Services) — `tech` theme
3. **Fluxology Greenhouse** — NAICS 111419 (Food Crops Grown Under Cover) — `natural` theme
4. **Fluxology Orchard & Food Forest** — NAICS 111330 (Noncitrus Fruit & Tree Nut Farming) — `natural` theme

The Hero, About, and Contact sections use the `corporate` theme.

### Design Goals

- Single-page scrollable layout with smooth per-section theme transitions
- Distinct visual identity (colors + fonts) per business division
- Performance-first: static HTML, minimal JS shipped only where interactivity is needed
- Accessibility (skip link, ARIA, `prefers-reduced-motion`, `<noscript>` reveal fallback)
- Mobile-first responsive design
- Lighthouse 100 across categories (see [Performance](#performance))

---

## Architecture

### Astro + Svelte Islands

The site is a static Astro app (`output: 'static'`). Astro renders all markup to HTML at build time. Interactivity is added through **Svelte 5 islands** — individual components hydrated on the client via Astro's `client:*` directives — rather than shipping a full SPA. Everything that can be static, is static.

- **Static Astro components** (`.astro`) render to plain HTML with zero client JS: `Navigation`, `Hero`, `About`, `DBASection`, `Footer`.
- **Svelte islands** (`.svelte`) ship JS and hydrate in the browser: `ScrollProgress`, `ThemeTransition`, `BackToTop`, `NavigationMenu`, `ParticleSystem`, `ContactForm`.

The single page is `src/pages/index.astro`. It wraps content in `src/layouts/BaseLayout.astro` and composes the components. The four DBA sections are data-driven: a `dbaSections` array in `index.astro` frontmatter is mapped over `<DBASection>`.

### Hydration Directives

Directives are assigned per component in `index.astro`:

| Component | Directive | Rationale |
|-----------|-----------|-----------|
| `ScrollProgress` | `client:load` | Needs to track scroll immediately |
| `ThemeTransition` | `client:load` | Drives theme + reveal animations from first paint |
| `BackToTop` | `client:load` | Listens for scroll from the start |
| `NavigationMenu` | `client:load` | Wires up the nav rendered by the static `Navigation` component |
| `ParticleSystem` | `client:visible` | Decorative; hydrate only when its section scrolls into view |
| `ContactForm` | `client:visible` | Below the fold; defer hydration until visible |

### Svelte 5 Runes vs. Legacy Mode

Svelte 5 is used. Components fall into two styles:

- **Runes mode** (`$state`, `$props`): `ContactForm`, `ParticleSystem`, `BackToTop`, `ScrollProgress`. These hold reactive UI state.
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
├── astro.config.mjs            # Astro config: svelte integration, fonts, vite/terser
├── svelte.config.js            # Svelte preprocess config
├── tsconfig.json               # Extends astro/tsconfigs/strict, svelte JSX
├── netlify.toml                # Primary deploy: build + security headers
├── Dockerfile                  # Alternative deploy: node builder -> Apache
├── package.json                # v2.0.0, Node >= 22.12
├── DOCKER-DEPLOYMENT.md         # Docker/Apache deployment guide
├── public/                     # Copied verbatim into dist/
│   ├── favicon.svg             # SVG favicon (no favicon.ico)
│   ├── service-worker.js       # PWA offline caching

├── scripts/
└── src/
    ├── pages/
    │   └── index.astro         # The single page; contains the dbaSections data array
    ├── layouts/
    │   └── BaseLayout.astro    # <head>, global CSS imports, <Font> tags, SW registration
    ├── components/
    │   ├── Navigation.astro     # Static nav bar markup (+ skip link)
    │   ├── Hero.astro           # Static hero (LCP region)
    │   ├── About.astro          # Static about section
    │   ├── DBASection.astro     # Static reusable DBA section (props-driven)
    │   ├── Footer.astro         # Static footer
    │   ├── ScrollProgress.svelte    # Island: top scroll progress bar
    │   ├── ThemeTransition.svelte   # Island: IntersectionObserver theme + reveal driver
    │   ├── BackToTop.svelte         # Island: back-to-top button
    │   ├── NavigationMenu.svelte    # Island: mobile menu toggle + smooth scroll
    │   ├── ParticleSystem.svelte    # Island: per-theme decorative particles
    │   └── ContactForm.svelte       # Island: validated Netlify Forms contact form
    └── styles/                  # 7 global stylesheets (imported by BaseLayout)
        ├── reset.css
        ├── variables.css        # Design tokens (colors, type, spacing, fonts, --current-*)
        ├── base.css
        ├── themes.css           # [data-theme] + section-id theme mappings
        ├── transitions.css      # Animations, keyframes, .observe-* reveal classes
        ├── utilities.css        # Perf/containment utility classes
        └── responsive.css       # Mobile-first media queries
```

> The previous vanilla implementation (`src/index.html`, `src/scripts/*.js`) no longer exists. There is no `main.js`, `scroll-controller.js`, `theme-manager.js`, `animations.js`, or `form-handler.js` — that behavior now lives in the Svelte islands above.

---

## Components

### Static Astro components

- **`Navigation.astro`** — Renders the fixed nav bar: logo, hamburger `#navToggle`, and `#navLinks` list (Home / About / Fabrication / 3D Lab / Greenhouse / Orchard / Contact). Includes the skip-to-content link. Ships no JS; behavior is added by `NavigationMenu.svelte` and `ThemeTransition.svelte`, which query these elements by id/class.
- **`Hero.astro`** — Above-the-fold hero (`#hero`, `corporate` theme). Renders immediately (no `.observe-*` gating) because it is the LCP region.
- **`About.astro`** — `#about` (`corporate`). Uses `.observe-fade` / `.observe-slide-up` for reveal.
- **`DBASection.astro`** — Reusable, props-driven section (`id`, `theme`, `name`, `naics`, `description`, `services[]`, `ctaText`). Renders the header, description, a services grid, a showcase placeholder, and a CTA button, plus a `<slot name="particles">` filled by `ParticleSystem`. Applies CSS containment (`content-visibility: auto; contain: layout style paint`) via scoped `<style>`.
- **`Footer.astro`** — Site footer with division/company links and a `#currentYear` span populated by an inline script in `BaseLayout`.

### Svelte islands

- **`ScrollProgress.svelte`** (runes) — Fixed top progress bar. `$state` `progress`; a `requestAnimationFrame`-throttled passive scroll listener updates width. Exposes `role="progressbar"` with live `aria-valuenow`.
- **`ThemeTransition.svelte`** (legacy) — See [Theme + Reveal System](#theme--reveal-system-themetransitionsvelte). No visual output.
- **`BackToTop.svelte`** (runes) — Fixed button; `$state` `visible` becomes true past 500px scroll (rAF-throttled). Smooth-scrolls to top on click.
- **`NavigationMenu.svelte`** (legacy) — On mount, wires `#navToggle`/`#navLinks`: toggles the `.open` class and `aria-expanded`, closes on link click / outside click / Escape, and installs smooth-scroll for all `a[href^="#"]` with a 70px fixed-nav offset. No visual output.
- **`ParticleSystem.svelte`** (runes) — Props: `theme`. Generates 15 particles (8 on mobile, `< 768px`) with randomized position/size/duration/delay into `$state`. Skips entirely when `prefers-reduced-motion: reduce`. Particle CSS class is chosen by theme: `spark-particle` (industrial), `digital-particle` (tech), `leaf-particle` (natural), else `particle` (corporate). Keyframes live in the component's scoped `<style>`.
- **`ContactForm.svelte`** (runes) — See [Contact Form](#contact-form).

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
- **Four color palettes** — full color scales for `corporate`, `industrial`, `tech`, and `natural`.
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

Fonts are **self-hosted and optimized by Astro's built-in `astro:fonts`** — there are no manually committed `.woff2` files and no Google Fonts `<link>` tags. `public/fonts/` contains only a README.

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

**Rendering** (`BaseLayout.astro`): a `<Font cssVariable="…">` component is emitted for each family. Only the above-the-fold corporate fonts (`--font-outfit`, `--font-open-sans`) use `preload`; the rest load on demand. Astro generates optimized fallback metrics so CLS stays 0. `variables.css` maps each generated `--font-*` to a semantic role.

> `Poppins` (`--font-corporate-accent`), `JetBrains Mono` (`--font-industrial-technical`), and `Fira Code` (`--font-tech-technical`) are still *referenced* in `variables.css` but are **not** loaded via `astro:fonts`; they fall back to system `sans-serif`/`monospace` stacks.

---

## Contact Form

`ContactForm.svelte` (runes mode) handles the contact section and submits through **Netlify Forms**.

- **State**: `formData` (`$state`) holds the fields (`companyName`, `fullName`, `email`, `phone`, `serviceInterest`, `message`); separate `$state` for `botField`, `errors`, `isSubmitting`, `submitStatus`, `submitMessage`.
- **Validation**: client-side `validate()` requires `fullName` (≥2 chars), a valid `email`, a selected `serviceInterest`, and `message` (≥10 chars). Errors render inline with `role="alert"` and `aria-invalid`; typing into a field clears its error.
- **Submission**: `handleSubmit` `preventDefault`s, validates, then AJAX-POSTs `application/x-www-form-urlencoded` data (including `form-name` and the honeypot `bot-field`) to `/`. Netlify intercepts the POST to `/`. Success resets the form and shows an in-page success message; failure shows an error with a fallback email address. No page navigation occurs.
- **Spam protection**: the `bot-field` honeypot (declared via `netlify-honeypot="bot-field"`) is visually hidden but submitted; bots that fill it are silently rejected.

**Netlify form detection**: Netlify's build bot registers forms by parsing *static* HTML at deploy time, but the real form is a client-hydrated Svelte island invisible to the bot. To bridge this, `index.astro` includes a **hidden static `<form name="contact" data-netlify="true">`** whose field names match the Svelte form. This registers the "contact" form so the island's AJAX submissions are accepted.

---

## Service Worker / PWA

`public/service-worker.js` provides offline support and runtime caching. It is registered by an inline script in `BaseLayout.astro` on `window.load`.

- **Cache names** are versioned (`fluxology-v2.2.0`, `fluxology-runtime-v2.2.0`); the `activate` handler deletes any cache not in the current set, so releases evict stale entries.
- **Precache** is only the app shell: `ASSETS_TO_CACHE = ['/']`. Content-hashed CSS/JS and font `.woff2` files under `/_assets` are cached lazily at runtime — listing hashed names would go stale each build and a single 404 would fail `cache.addAll`.
- **Fetch strategy**:
  - Non-GET and cross-origin requests pass straight through (so the contact form POST is untouched).
  - **Navigations / HTML**: network-first, caching successful basic responses, falling back to cache (then `/`) offline — so content and security fixes reach returning visitors.
  - **Other same-origin assets**: cache-first, populating the runtime cache on miss (only `status 200`, `type: 'basic'`).
- Includes stubbed `push` / `notificationclick` handlers for future notification support (referencing `/icon-192.png`, `/badge-72.png`, which are not yet shipped).

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

Measured targets for the current build:

- **Lighthouse**: 100 desktop across Performance / Accessibility / Best Practices / SEO; 99 mobile performance.
- **LCP**: ~0.5s desktop / ~2.1s mobile
- **CLS**: 0 (font fallback metrics + no layout-shifting reveals)
- **TBT**: 0

Contributing techniques:

- Static HTML with islands — client JS ships only for the six hydrated components, each hydrated at the cheapest safe moment (`client:visible` for below-the-fold/decorative ones).
- Hero LCP region renders without hydration or reveal gating.
- Fonts preloaded selectively with generated fallback metrics.
- CSS containment (`content-visibility`, `contain`) on DBA sections and particle containers.
- Scroll handlers are passive and `requestAnimationFrame`-throttled.
- Particles reduced on mobile and disabled under `prefers-reduced-motion`.
- Production JS minified by **terser** with `drop_console: true` and 2 passes; CSS minified by **lightningcss**; HTML compression via Astro's default `compressHTML: 'jsx'`. (The old `astro-compress` integration and manual `manualChunks`/`svelte/internal` config have been removed.)

---

## Build & Deploy

### Toolchain

- **Astro 7.1.3**, **Svelte 5.56.7**, **@astrojs/svelte 9.0.1**, **TypeScript 5.7.2**.
- Dev dependencies: `sharp` (image optimization), `terser` (JS minification), `typescript`.
- **Node >= 22.12** (required by Astro 7).
- Astro 7 builds on **Vite + Rolldown**; native toolchain binaries arrive via `optionalDependencies` (so `npm ci --ignore-scripts` is safe).

### npm scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `dev` | `astro dev` | Local dev server with HMR |
| `build` | `astro build` | Static build to `dist/` |
| `preview` | `astro preview` | Serve the built `dist/` locally |
| `sync` | `astro sync` | Regenerate Astro type definitions |

`astro.config.mjs` sets `output: 'static'` and `build.assets: '_assets'` (custom asset directory instead of the default `_astro`).

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
- The service worker aggressively caches; bump the `CACHE_NAME` / `RUNTIME_CACHE` versions in `public/service-worker.js` when shipping changes that must reach returning visitors immediately.

---

## Common Modifications

### Add or edit a DBA section

Edit the `dbaSections` array in `src/pages/index.astro` (add an object with `id`, `theme`, `name`, `naics`, `description`, `services[]`, `ctaText`). Then:

1. Add a nav link in `Navigation.astro` and a footer link in `Footer.astro`.
2. If introducing a **new theme**, add its palette to `variables.css`, a `[data-theme="…"]` block plus section-id styling to `themes.css`, and a matching entry in the `themes` object in `ThemeTransition.svelte`. Add a particle class in `ParticleSystem.svelte` if desired.

A `<ParticleSystem slot="particles" theme={dba.theme} client:visible />` is already wired for every mapped section.

### Change a color or font

- **Color**: edit the token in `variables.css`; all `var(...)` consumers update automatically.
- **Font**: add/edit the entry in the `fonts` array in `astro.config.mjs`, add a matching `<Font cssVariable="…" />` in `BaseLayout.astro` (with `preload` only if above the fold), then reference it via a semantic `--font-*` variable in `variables.css`.

### Adjust reveal behavior

Reveal is driven by `.observe-fade` / `.observe-slide-up` / `.observe-scale` classes (defined in `transitions.css`) plus the `.observed` toggle applied by `ThemeTransition.svelte`. Add these classes to any element to have it animate in as its section enters the viewport. Do **not** add them to LCP-critical hero content.

---

**Document Version**: 2.0.0
**Last Updated**: July 2026
**Next Review**: When the component set, theme system, or deploy targets change.
