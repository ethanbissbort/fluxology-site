import { defineConfig, fontProviders } from 'astro/config';
import svelte from '@astrojs/svelte';
import sitemap from '@astrojs/sitemap';

// Self-hosted Google fonts via astro:fonts. Each family exposes a CSS
// variable consumed in src/styles/variables.css. Weight ranges mirror the
// original @font-face declarations; only Rajdhani is non-variable on Google
// Fonts (discrete weights). Latin subset keeps downloads small.
const googleFont = (name, cssVariable, weights) => ({
  provider: fontProviders.google(),
  name,
  cssVariable,
  weights,
  subsets: ['latin'],
  styles: ['normal'],
  fallbacks: ['sans-serif'],
});

// Routes rendered with BaseLayout's `noindex` prop. Keep in sync with the
// pages that set it, so the sitemap never advertises a page we tell crawlers
// to ignore.
const NOINDEX_ROUTES = ['/404', '/contact-received'];

// https://astro.build/config
export default defineConfig({
  // Canonical origin — used for the canonical link, Open Graph URLs, and the
  // sitemap. Update here if the production domain ever changes.
  site: 'https://fluxology.ca',
  integrations: [
    svelte(),
    // Generated sitemap (replaces the old hand-maintained public/sitemap.xml,
    // which drifted whenever routes changed). Emits /sitemap-index.xml +
    // /sitemap-0.xml; robots.txt points at the index. Pages that carry
    // noindex must stay out of it: the 404, and the contact-form landing
    // page that only no-JS submitters are redirected to.
    sitemap({
      filter: (page) => !NOINDEX_ROUTES.some((route) => page.includes(route)),
    }),
  ],
  output: 'static',
  // Prefetch cross-page links, but only once the visitor shows intent
  // (hover on a pointer, touchstart on a phone).
  //
  // This depends on a serving-layer contract: HTML must be STORABLE, i.e.
  // docker/apache must not send `no-store` on .html. Under the old
  // `no-cache, no-store, must-revalidate` every prefetched document was
  // discarded on arrival and re-downloaded on click, so prefetch of any
  // strategy was pure loss. httpd.conf now sends
  // `public, max-age=60, must-revalidate`, which is what makes this setting
  // worth anything at all. If that header ever goes back to no-store, set
  // `prefetch: false` rather than leaving speculation on.
  //
  // Given a storable HTML policy, 'hover' still beats 'viewport'. Measured on
  // a desktop /fabrication/ against a header-accurate replica: 'viewport'
  // pulls 5 documents / 69,163 B at load (4 of them speculative, 57,059 B)
  // to make every sibling navigation cost 0 B; 'hover' pulls 1 document /
  // 12,104 B, spends 11,937 B on the one link the visitor points at, and that
  // navigation also costs 0 B. Even a visitor who eventually opens all four
  // siblings transfers less under 'hover' (47,748 B vs 57,059 B), and one who
  // opens a single page transfers 45,122 B less.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'hover',
  },
  build: {
    // Custom asset directory (default is '_astro').
    assets: '_assets',
  },
  // A range ('100 900') asks Google for the variable font; a single number
  // asks for that one static cut. Which is cheaper depends entirely on how
  // many weights a family is actually rendered at:
  //
  //  - Families used at 2+ weights keep the variable file. Measured, statics
  //    LOSE for Outfit (32,228 B variable vs 55,744 B for the 4 cuts it uses),
  //    Open Sans (42,964 vs 53,500), Space Grotesk (22,320 vs 26,124) and
  //    Sora (33,672 vs 30,188 — a 3,484 B saving that costs an extra request).
  //  - Inter, DM Sans, Nunito and Quicksand are each rendered at exactly ONE
  //    weight across every route and both viewports, so they ship that cut.
  //  - Rajdhani is the only non-variable family (discrete files). Headings use
  //    600/700; the 300/400/500 files were built and served on every page's
  //    inline @font-face CSS but never requested by any route.
  //
  // Total: 328,468 -> 220,088 B of woff2 in dist. If you ever style one of the
  // four single-weight families at another weight, put its range back or the
  // browser will synthesise the cut instead of loading a real one.
  //
  // Do NOT "tighten" a variable range as an optimisation: Google returns the
  // identical file for wght@100..900 and wght@500..800.
  fonts: [
    googleFont('Outfit', '--font-outfit', ['100 900']),
    googleFont('Open Sans', '--font-open-sans', ['300 800']),
    googleFont('Inter', '--font-inter', [400]),
    googleFont('Rajdhani', '--font-rajdhani', [600, 700]),
    googleFont('Space Grotesk', '--font-space-grotesk', ['300 700']),
    googleFont('DM Sans', '--font-dm-sans', [400]),
    googleFont('Sora', '--font-sora', ['100 800']),
    googleFont('Nunito', '--font-nunito', [400]),
    googleFont('Quicksand', '--font-quicksand', [500]),
  ],
  vite: {
    build: {
      // Drop console/debugger calls from the production client bundle.
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          passes: 2,
        },
      },
    },
  },
});
