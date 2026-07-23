# Fluxology Inc. Website — Astro Architecture

This document describes the **Astro + Svelte** architecture and developer
workflow for the Fluxology Inc. site. For the business overview, division
descriptions, and general project information, see [`README.md`](./README.md).

The site is a single-page, statically generated marketing site that ships
almost no JavaScript: static content is pre-rendered to HTML, and only a small
set of interactive Svelte "islands" hydrate in the browser.

## Technology Stack

- **[Astro 7.1.3](https://astro.build)** — static site generator (`output: 'static'`)
- **[Svelte 5.56](https://svelte.dev)** — interactive islands, using **runes** (`$state`, `$props`) where reactive
- **[@astrojs/svelte 9.0.1](https://docs.astro.build/en/guides/integrations-guide/svelte/)** — Svelte integration for Astro
- **TypeScript 5.7** — `astro/tsconfigs/strict`, JSX preserved with `jsxImportSource: "svelte"`
- **[astro:fonts](https://docs.astro.build/en/guides/fonts/)** — self-hosted Google Fonts (no manual font files)

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

## Project Structure

```
fluxology-site/
├── public/
│   ├── images/                   # Optimized images (AVIF, WebP, JPG)
│   ├── favicon.svg
│   └── service-worker.js         # PWA service worker
├── src/
│   ├── components/
│   │   ├── Navigation.astro      # Static: fixed navigation markup
│   │   ├── Hero.astro            # Static: hero section
│   │   ├── About.astro           # Static: about section
│   │   ├── DBASection.astro      # Static: reusable business-division template
│   │   ├── Footer.astro          # Static: footer
│   │   ├── ScrollProgress.svelte # Island (runes): scroll progress bar
│   │   ├── ThemeTransition.svelte# Island (legacy): scroll-driven theme switch
│   │   ├── ParticleSystem.svelte # Island (runes): themed particle animation
│   │   ├── ContactForm.svelte    # Island (runes): contact form + validation
│   │   ├── NavigationMenu.svelte # Island (legacy): mobile menu behaviour
│   │   └── BackToTop.svelte      # Island (runes): back-to-top button
│   ├── layouts/
│   │   └── BaseLayout.astro      # HTML wrapper, CSS imports, fonts, service worker
│   ├── pages/
│   │   └── index.astro           # The single page
│   └── styles/
│       ├── reset.css             # CSS reset
│       ├── variables.css         # Design tokens + font CSS variables
│       ├── base.css              # Base styles
│       ├── themes.css            # Per-division theme styles
│       ├── transitions.css       # Animations / transitions
│       ├── utilities.css         # Performance / utility classes
│       └── responsive.css        # Media queries
├── scripts/
├── astro.config.mjs              # Astro configuration (integrations, fonts, Vite)
├── svelte.config.js              # Svelte preprocessing (required by @astrojs/svelte 9)
├── tsconfig.json                 # TypeScript config (strict)
├── netlify.toml                  # Netlify build + headers config
└── package.json
```

## The Island Architecture

Astro renders everything to static HTML by default. Interactive components are
**islands** — self-contained Svelte components that hydrate independently in the
browser via a `client:*` directive. The rest of the page ships zero JavaScript.

### Static Astro components

Pre-rendered to HTML at build time, no client JavaScript:

- `BaseLayout.astro` — HTML shell, meta tags, global CSS imports, fonts, service worker
- `Navigation.astro`, `Hero.astro`, `About.astro`, `Footer.astro`
- `DBASection.astro` — reusable template for each business division; exposes a
  `particles` slot that `index.astro` fills with a `ParticleSystem` island

### Svelte islands and their directives

The directives below are exactly what `src/pages/index.astro` uses:

| Component | Directive | Reactivity | Purpose |
|---|---|---|---|
| `ScrollProgress` | `client:load` | Runes (`$state`) | Top scroll-progress bar |
| `ThemeTransition` | `client:load` | Legacy | Switches theme on scroll (Intersection Observer) |
| `BackToTop` | `client:load` | Runes (`$state`) | Back-to-top button |
| `NavigationMenu` | `client:load` | Legacy | Mobile menu open/close behaviour |
| `ParticleSystem` | `client:visible` | Runes (`$state`, `$props`) | Themed particle animation per section |
| `ContactForm` | `client:visible` | Runes (`$state`) | Contact form with client-side validation + AJAX submit |

- **`client:load`** — hydrates as soon as the page loads. Used for chrome that
  must respond to scroll immediately (progress bar, theme, back-to-top, mobile menu).
- **`client:visible`** — hydrates only when the component scrolls into view.
  Used for the per-section particle systems and the contact form, which live
  further down the page.

### Svelte 5 runes vs legacy mode

Svelte 5 supports both runes and the legacy reactivity model, and this repo uses
both intentionally:

- **Runes** (`$state` / `$props`): `ScrollProgress`, `BackToTop`, `ParticleSystem`,
  `ContactForm` — components with genuine reactive component state.
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
`BaseLayout.astro`, each family is emitted with an `<Font>` component; the two
above-the-fold corporate fonts (`--font-outfit`, `--font-open-sans`) are
`preload`ed, while the theme fonts further down the page load on demand.
`astro:fonts` generates **fallback metrics automatically**, which is a key
contributor to the site's **CLS of 0**.

## Styling

- **Global CSS** lives in `src/styles/*.css` and is **imported in the
  `BaseLayout.astro` frontmatter** so Astro bundles, hashes, and injects it. Import
  order is preserved to match the intended cascade.
  - Do **not** reference these files via `<link href="/src/styles/*.css">` —
    `src/` is not served in a production build, so that approach only appears to
    work in dev and breaks in `dist/`.
- **Component-scoped CSS** lives inside each `.svelte` component's `<style>` block.

## Contact Form (Netlify Forms)

The contact form uses **Netlify Forms** with a two-part setup, because the real
form is a client-hydrated Svelte island and Netlify's build bot only parses
static HTML:

1. A **hidden static detection form** in `index.astro` (`name="contact"`,
   `data-netlify="true"`, `hidden`) with matching field names. Netlify's deploy
   bot parses this to register the `contact` form.
2. The visible **`ContactForm.svelte`** island, which validates input and
   submits via **AJAX** (URL-encoded `POST` to `/`), showing in-page
   success/error states.

Spam protection uses a **`bot-field` honeypot** (`netlify-honeypot="bot-field"`);
a hidden `form-name` input identifies the form to Netlify.

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

## Performance

Measured results for the current build:

- **Lighthouse Performance:** 100 (desktop) / 99 (mobile)
- **Cumulative Layout Shift (CLS):** 0
- **Total Blocking Time (TBT):** 0
- **Largest Contentful Paint (LCP):** ~0.5s (desktop)

These come from the island model (minimal JS), terser/lightningcss
minification, and `astro:fonts` fallback metrics eliminating font-swap layout
shift.

## Deployment

- **Netlify (primary).** Configured via `netlify.toml`. Netlify builds the static
  site and serves `dist/`; Netlify Forms handles contact submissions (see above).
- **Docker + Apache (alternative).** A container-based deployment is documented
  in [`DOCKER-DEPLOYMENT.md`](./DOCKER-DEPLOYMENT.md).

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
