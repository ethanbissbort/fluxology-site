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
| Runtime      | Node `>=22.12.0` (`engines` + Dockerfile + netlify.toml) |
| Fonts        | Self-hosted via `astro:fonts` (9 Google families) |
| Forms        | Netlify Forms (static detection form + AJAX island) |
| Minify       | Vite + terser (`drop_console`, 2 passes); Rolldown replaces esbuild/rollup |
| Build output | `dist/` static site (deployed to Netlify) |

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
`astro:fonts`, added Netlify Forms, and hardened/optimized the site.

---

## Component inventory (current)

### Static Astro components (`src/components/`)

- `Navigation.astro` — fixed nav bar, smooth-scroll anchors.
- `Hero.astro` — hero section (renders immediately; see performance notes).
- `About.astro` — company overview, values grid, stats cards.
- `DBASection.astro` — reusable template for all four DBA sections
  (props: `id`, `theme`, `name`, `naics`, `description`, `services`, `ctaText`;
  slots for particles).
- `Footer.astro` — footer content.

### Interactive Svelte islands (`src/components/`)

| Component               | Mode   | Runes used            | Notes |
|-------------------------|--------|-----------------------|-------|
| `ContactForm.svelte`    | Runes  | `$state`              | Netlify Forms AJAX submit, validation, honeypot |
| `ParticleSystem.svelte` | Runes  | `$props`, `$state`    | Themed particles; respects `prefers-reduced-motion` |
| `BackToTop.svelte`      | Runes  | `$state`              | Scroll-threshold button |
| `ScrollProgress.svelte` | Runes  | `$state`              | Scroll progress bar |
| `NavigationMenu.svelte` | Legacy | — (`onMount` only)    | Mobile menu toggle / active-link tracking |
| `ThemeTransition.svelte`| Legacy | — (`onMount` only)    | IntersectionObserver theme + nav-link updates |

`NavigationMenu` and `ThemeTransition` are lifecycle-only components (no
component-local reactive state), so they remain in Svelte 5 legacy mode, which
is fully supported. There was no need to convert them to runes.

### Layout

- `BaseLayout.astro` — imports the seven global stylesheets in frontmatter,
  emits `<Font>` tags from `astro:fonts`, includes a `<noscript>` reveal
  fallback, registers the service worker, and sets the footer year.

### Page

- `pages/index.astro` — composes the layout, static components, and islands.
  Client directives in use: `client:load` for `ScrollProgress`,
  `ThemeTransition`, `BackToTop`, and `NavigationMenu`; `client:visible` for
  `ParticleSystem` and `ContactForm`. Also contains the hidden Netlify
  detection form (see Netlify Forms below).

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
- Bumped Node 18 → 22 in the `Dockerfile` and `netlify.toml`, matching the
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
`BaseLayout.astro`, only the above-the-fold corporate fonts (Outfit, Open Sans)
are `preload`ed; the theme fonts load on demand with `font-display: swap`.

---

## Netlify Forms contact integration

The contact form is wired to Netlify Forms:

- **`ContactForm.svelte`** is a hydrated island (`client:visible`) with the real,
  validated form. It POSTs an `application/x-www-form-urlencoded` payload to `/`
  via `fetch`, then shows a success/error status.
- Because Netlify's build bot registers forms by parsing **static** HTML at
  deploy time — and the visible form is client-rendered — `index.astro` includes
  a **hidden plain-HTML detection form** with matching field names and
  `data-netlify="true"`. This is what registers the `contact` form with Netlify.
- A **`bot-field` honeypot** (`netlify-honeypot="bot-field"`) is present on both
  forms; it is visually removed via CSS but still submitted, silently rejecting
  naive bots.
- The island's `form-name` (`contact`) matches the detection form so submissions
  are attributed correctly.

---

## Security hardening

- Content Security Policy and security response headers.
- `.dockerignore` added.
- Service worker (`public/service-worker.js`) registered from `BaseLayout.astro`
  for PWA/offline support.

## Performance

Measured results after the overhaul:

- Lighthouse **100 desktop / 99 mobile**.
- LCP ~**0.5s**, CLS **0**, TBT **0**.
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
  dev dependencies are `terser` and `typescript` (`sharp` was removed along with the dead image-optimization script; reinstall it if raster images and `astro:assets` are adopted later).

---

## Client directives reference

- `client:load` — hydrate immediately (critical interactive elements:
  `ScrollProgress`, `ThemeTransition`, `BackToTop`, `NavigationMenu`).
- `client:visible` — hydrate when the island scrolls into view
  (`ParticleSystem`, `ContactForm`).
- `client:idle` — hydrate when the browser is idle (available; not currently
  used).

## Build commands

```bash
# Development
npm run dev

# Production build
npm run build

# Preview production build
npm run preview

# Sync Astro types (astro:fonts, content, etc.)
npm run sync

# Optimize images
```

## Deployment

`npm run build` emits the static site to `dist/`, which is deployed to Netlify.
Node 22 is pinned in both the `Dockerfile` and `netlify.toml`.

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
