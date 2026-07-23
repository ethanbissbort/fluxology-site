# Fonts

Fonts are **no longer downloaded or committed manually**. They are self-hosted
and optimized automatically by [`astro:fonts`](https://docs.astro.build/en/guides/fonts/).

## How it works

- Families are declared in `astro.config.mjs` under `fonts:` (via
  `fontProviders.google()`), each exposing a CSS variable (e.g. `--font-outfit`).
- At build time Astro downloads the fonts from Google, subsets them (`latin`),
  generates optimized fallback metrics (to prevent layout shift), and emits
  content-hashed `.woff2` files under `dist/_assets/fonts/`.
- `src/layouts/BaseLayout.astro` renders `<Font>` components that inject the
  `@font-face` rules and preload the above-the-fold corporate fonts.
- `src/styles/variables.css` maps the generated `--font-*` variables to the
  design's semantic roles (e.g. `--font-corporate-heading: var(--font-outfit)`).

## Adding or changing a font

1. Add/edit an entry in the `fonts` array in `astro.config.mjs`.
2. Add a matching `<Font cssVariable="--font-…" />` in `BaseLayout.astro`
   (add `preload` only for above-the-fold fonts).
3. Reference it via a semantic variable in `src/styles/variables.css`.

The build requires outbound access to Google Fonts. This directory intentionally
contains no font files.
