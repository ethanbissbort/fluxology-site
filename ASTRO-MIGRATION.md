# Astro Migration Guide

## Migration Status: COMPLETE — Astro 7 / Svelte 5

This document tracks how the Fluxology Inc. website reached its current
architecture. The site started life as a single-page vanilla HTML/CSS/JS build,
was first migrated to Astro 4 + Svelte 4, and has since been fully overhauled to
**Astro 7 + Svelte 5 (runes)**. The current end state is described below;
earlier phases are kept for historical context.

### Current stack (verified against source)

| Concern      | Current state |
|--------------|---------------|
| Framework    | Astro `^7.1.3`, `output: 'static'` |
| Islands      | Svelte `^5.56.7` via `@astrojs/svelte` `^9.0.1` |
| Language     | TypeScript `^5.7.2` |
| Runtime      | Node `>=22.12.0` (`engines` + Dockerfile) |
| Fonts        | Self-hosted via `astro:fonts` (9 Google families) |
| Images       | `astro:assets` responsive renditions from `src/assets/images/` (`sharp` devDependency) |
| SEO          | `@astrojs/sitemap` generated sitemap; built-in prefetch (viewport strategy) |
| Forms        | Self-hosted `services/contact-api` (`POST /api/contact`), JSON from the island + urlencoded no-JS fallback |
| Minify       | Vite + terser (`drop_console`, 2 passes); Rolldown replaces esbuild/rollup; npm `postbuild` terser pass minifies `dist/service-worker.js` and prunes unreferenced image originals |
| Build output | `dist/` static site, built inside the Docker image and served by Apache behind Caddy on the company VPS |

Package version is `2.0.0`.

---

## Phase 0 — Original site (pre-Astro)

The site began as a hand-authored single-page app: `src/index.html` plus a set
of plain scripts under `src/scripts/*.js`, styled by the modular CSS system that
survives to this day. Those pre-Astro artifacts have since been **deleted**
(`src/index.html` and `src/scripts/*.js`) now that all behavior lives in Astro
components and Svelte islands.

## Phase 1 — Astro 4 + Svelte 4 (initial migration)

✅ **Completed**

- Astro 4.x + Svelte 4.x + Vite 5.x installed and configured.
- Project restructured into `src/layouts`, `src/components`, `src/pages`,
  `src/styles`.
- The existing modular CSS system was preserved and enhanced (reset, variables,
  base, themes, transitions, utilities, responsive).
- Static content moved into Astro components; interactive behavior moved into
  Svelte 4 components using `export let`, top-level reactive `let`, `on:event`
  handlers, and `onMount` lifecycle.

This is the phase the original version of this document described. Everything
below supersedes it.

## Phase 2 — Astro 7 + Svelte 5 overhaul (CURRENT)

✅ **Completed**

The most recent major upgrade moved the project to Astro 7 and Svelte 5, adopted
`astro:fonts`, added a working contact form, and hardened/optimized the site.

---

## Component inventory (current)

### Static Astro components (`src/components/`)

- `Navigation.astro` — fixed nav bar, smooth-scroll anchors.
- `Hero.astro` — hero section (renders immediately; see performance notes).
- `About.astro` — company overview, values grid, stats cards.
- `DBASection.astro` — reusable template for all four DBA homepage sections,
  fed by a `DbaOverview` from `src/data/dbaPlans.ts`. Required props: `id`,
  `theme`, `name`, `status`, `classification`, `description`, `facts`,
  `services`, `processTitle`, `processSteps`, `boundary`, `detailHref`;
  optional: `eyebrow`, `servicesTitle`, `servicesIntro`, `processIntro`,
  `showcaseImages`, `sectionBackground`, `ctaText`, `ctaNote`,
  `particleVariant`. Image props are `ImageMetadata` (astro:assets). Slots for
  particles.
- `DBADetailPage.astro` — reusable detail route rendered by `[dba].astro`
  (scope/capital tables, controls, milestones, gallery, local nav).
- `OperatingModel.astro` / `Roadmap.astro` — company architecture and staged
  2026-2035 plan sections.
- `Footer.astro` — footer content.

### Interactive Svelte islands (`src/components/`)

| Component               | Mode   | Runes used            | Notes |
|-------------------------|--------|-----------------------|-------|
| `ContactForm.svelte`    | Runes  | `$state`              | JSON submit to `/api/contact`, validation, `website` honeypot, no-JS native POST fallback |
| `ParticleSystem.svelte` | Runes  | `$props`, `$state`    | Themed particles; respects `prefers-reduced-motion` |
| `BackToTop.svelte`      | Runes  | `$state`              | Scroll-threshold button |
| `ScrollProgress.svelte` | Runes  | `$state`              | Scroll progress bar |
| `CursorEffects.svelte`  | Runes  | `$state`              | Themed cursor dot/ring (fine pointers, reduced-motion aware) |
| `NavigationMenu.svelte` | Legacy | — (`onMount` only)    | Mobile menu toggle, focus trap, active-link tracking |
| `ThemeTransition.svelte`| Legacy | — (`onMount` only)    | IntersectionObserver theme + nav-link updates |

`NavigationMenu` and `ThemeTransition` are lifecycle-only components (no
component-local reactive state), so they remain in Svelte 5 legacy mode, which
is fully supported. There was no need to convert them to runes.

### Layout

- `BaseLayout.astro` — imports the seven global stylesheets in frontmatter,
  emits `<Font>` tags from `astro:fonts` (with theme-aware preloads), renders
  the site-wide `CursorEffects` island (`client:idle`), supports a `noindex`
  prop (used by 404 to suppress canonical/`og:url`), includes a `<noscript>`
  reveal fallback, registers the service worker, and sets the footer year.

### Pages

- `pages/index.astro` — composes the layout, static components, and islands.
  Client directives in use: `client:load` for `ScrollProgress`,
  `ThemeTransition`, `BackToTop`, and `NavigationMenu`; `client:visible` for
  `ParticleSystem` and `ContactForm`.
- `pages/[dba].astro` — `getStaticPaths()` over `dbaPlans` generates the four
  detail routes (`/fabrication/`, `/3d-lab/`, `/greenhouse/`, `/orchard/`),
  each rendering `DBADetailPage`.
- `pages/contact-received.astro` — landing page for no-JS form submissions
  (`noindex`); renders the confirmation, or the failure variant when the API
  redirects with `?error=1`.
- `pages/404.astro` — branded 404 with full navigation, `noindex`.

---

## Svelte 4 → 5 migration (runes)

The following changes were applied when moving islands to Svelte 5:

- `export let foo` → `let { foo } = $props()`
  (e.g. `ParticleSystem`: `let { theme = 'corporate' } = $props()`).
- Component-local reactive `let` → `$state(...)`
  (e.g. `ContactForm`'s `formData`, `errors`, `isSubmitting`, `submitStatus`;
  `ScrollProgress`'s `progress`; `BackToTop`'s `visible`;
  `ParticleSystem`'s `particles`).
- `on:event` → `onevent`
  (e.g. `onsubmit={handleSubmit}`, `oninput`, `onchange` in `ContactForm`).
- Self-closing non-void tags were given explicit closing tags. Astro 7's Rust
  Svelte compiler is strict about this (e.g. `<textarea ...></textarea>` rather
  than a self-closed textarea).
- A root **`svelte.config.js`** was added with `vitePreprocess()`, which is
  required by `@astrojs/svelte` 9 (it enables TypeScript/PostCSS preprocessing
  in `.svelte` files).

## Astro 4 → 7 migration

Configuration and build changes applied for Astro 7:

- Removed the `svelte/internal` `manualChunks` entry — that module no longer
  exists in Svelte 5.
- Removed the `astro-compress` integration — redundant under Astro 7, where
  Vite/terser handle JS/CSS minification and `compressHTML` handles HTML.
- Simplified the `astro.config.mjs` `vite` block, keeping only the terser
  `drop_console` (plus `passes: 2`) minification tuning.
- `BaseLayout.astro` now **imports** the global stylesheets in frontmatter
  (`import '../styles/reset.css'`, etc.) instead of linking `/src/styles/*.css`.
  Those source-path `<link>`s 404 in a production build because `src/` is not
  served; imports let Astro bundle, hash, and inject the CSS while preserving
  cascade order.
- Escaped a leading-digit CSS ID selector: `#3d-lab` → `#\33 d-lab`. The
  stricter `lightningcss` minifier rejects an ID selector that begins with a
  digit. (The `3d-lab` DBA section id itself is unchanged.)
- Updated `tsconfig.json` `include`/`exclude`.
- Added `.astro/` to `.gitignore`.
- Bumped Node 18 → 22 in the `Dockerfile`, matching the
  `engines.node >= 22.12.0` constraint.
- Deleted dead pre-Astro artifacts: `src/index.html` and `src/scripts/*.js`.

Under the hood, Astro 7's toolchain uses **Rolldown** in place of
esbuild/rollup, which is part of why the dependency tree shrank substantially.

---

## Self-hosted fonts (`astro:fonts`)

Fonts are now self-hosted through Astro's built-in `astro:fonts`, replacing the
previous broken manual `/fonts/*.woff2` references. `astro.config.mjs` declares
**9 Google font families**, each exposing a CSS variable consumed in
`src/styles/variables.css`:

| Family        | CSS variable          | Weights |
|---------------|-----------------------|---------|
| Outfit        | `--font-outfit`       | `100 900` |
| Open Sans     | `--font-open-sans`    | `300 800` |
| Inter         | `--font-inter`        | `100 900` |
| Rajdhani      | `--font-rajdhani`     | `300, 400, 500, 600, 700` (non-variable) |
| Space Grotesk | `--font-space-grotesk`| `300 700` |
| DM Sans       | `--font-dm-sans`      | `100 1000` |
| Sora          | `--font-sora`         | `100 800` |
| Nunito        | `--font-nunito`       | `200 1000` |
| Quicksand     | `--font-quicksand`    | `300 700` |

All families use the `latin` subset and a `sans-serif` fallback. In
`BaseLayout.astro`, preloads are theme-aware: the corporate fonts (Outfit,
Open Sans) are `preload`ed on every page, and each themed page additionally
preloads its hero heading family (Rajdhani weight 700 / Space Grotesk / Sora);
the remaining fonts load on demand with `font-display: swap`.

---

## Contact form: from a hosted form service to a self-hosted API

**Historical note.** During the Astro 7 overhaul the contact form was briefly
wired to a hosted form service (a `data-netlify` island plus a hidden static
detection form in `index.astro`, a `form-name` input, and a `bot-field`
honeypot, POSTing urlencoded data to `/`). That protocol only functions on that
provider's hosting. The site is self-hosted on the company's own VPS, so
submissions went nowhere and no inquiry could ever be received.

**Current implementation.** All of that markup was removed and replaced with a
self-hosted service, `services/contact-api`:

- **`ContactForm.svelte`** is still a hydrated island (`client:visible`), but it
  now carries `action="/api/contact" method="POST"` and submits **JSON** via
  `fetch` when hydrated, mapping the API's `400 {"fields": {...}}` response back
  onto inline per-field errors and handling `429` distinctly.
- **No-JS submissions work.** With scripting disabled the native form posts
  `application/x-www-form-urlencoded` to the same endpoint, and the API responds
  with a `303` to `/contact-received/` (or `/contact-received/?error=1`).
  `src/pages/contact-received.astro` was added for that landing page; both it
  and the 404 are `noindex` and are filtered out of the sitemap via
  `NOINDEX_ROUTES` in `astro.config.mjs`.
- The honeypot was renamed `bot-field` → **`website`** (a neutral name required
  by the API contract). It remains off-screen, `aria-hidden`, `tabindex="-1"`.
  A filled honeypot gets a success response and is silently discarded.
- The hidden detection form, the `form-name` input, `data-netlify`,
  `netlify-honeypot`, and `name="contact"` on the form element are all gone.
- `public/service-worker.js` now explicitly passes `/api` and `/api/*` through
  network-only, so no API response can ever be cached or replayed.

The service validates and rate-limits per IP, appends each inquiry to a JSONL
log and fsyncs it **before** responding, and treats email as optional and
best-effort on top (off until `SMTP_HOST` is set). See
`services/contact-api/README.md` and `docs/DEPLOYMENT-VPS.md`.

---

## Security hardening

- Content Security Policy and security response headers.
- `.dockerignore` added.
- Service worker (`public/service-worker.js`) registered from `BaseLayout.astro`
  for PWA/offline support.

## Historical performance baseline

Before the 2026 content and multi-route expansion, the migration build measured
Lighthouse **100 desktop / 99 mobile**, LCP about **0.5s**, CLS **0**, and TBT
**0**. These are historical baseline figures, not claims about the current
layout; run a fresh audit after material changes.
- The hero renders immediately (no hydration gate on above-the-fold content).
- A `<noscript>` style block reveals all scroll-animated content
  (`.observe-fade`, `.observe-slide-up`, `.observe-scale`) so nothing is ever
  permanently hidden when JavaScript is unavailable — the reveal animation is a
  progressive enhancement.

## Dependency health

- `npm audit`: **19 → 0** vulnerabilities.
- Dependency tree shrank substantially (Rolldown replaces esbuild/rollup;
  `astro-compress` removed).
- Runtime dependencies are now just `astro`, `@astrojs/svelte`, and `svelte`;
  dev dependencies are `@astrojs/sitemap`, `sharp`, `terser`, and `typescript`.
  (`sharp` was removed during the overhaul along with a dead
  image-optimization script, then **reinstalled** when the site adopted
  `astro:assets` responsive images.)

---

## Client directives reference

- `client:load` — hydrate immediately (critical interactive elements:
  `ScrollProgress`, `ThemeTransition`, `BackToTop`, `NavigationMenu`).
- `client:visible` — hydrate when the island scrolls into view
  (`ParticleSystem`, `ContactForm`).
- `client:idle` — hydrate when the browser is idle (`CursorEffects`, rendered
  site-wide from `BaseLayout.astro`).

## Build commands

```bash
# Development
npm run dev

# Production build (also triggers the npm postbuild hook:
# terser-minify dist/service-worker.js + prune unreferenced images)
npm run build

# Preview production build
npm run preview

# Sync Astro types (astro:fonts, content, etc.)
npm run sync
```

## Deployment

`npm run build` emits the static site to `dist/`. In production that build runs
**inside** the Docker image (`node:22-alpine` builder stage in the root
`Dockerfile`), and the result is copied into an `httpd:2.4-alpine` stage served
behind Caddy on the company's own VPS. Node 22 is pinned in the `Dockerfile`.
Pipelines that call `astro build` directly skip the `postbuild` hook.

See `docs/DEPLOYMENT-VPS.md` for the operator guide and `DOCKER-DEPLOYMENT.md`
for the container reference.

## Styles

The modular CSS system in `src/styles/` is unchanged in structure and imported
by `BaseLayout.astro`:

- `reset.css`
- `variables.css` (consumes the `astro:fonts` CSS variables)
- `base.css`
- `themes.css`
- `transitions.css`
- `utilities.css`
- `responsive.css`
