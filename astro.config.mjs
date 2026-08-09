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
  image: {
    // Per-format encoder options for the built-in sharp service. This is the
    // only way to give AVIF its own quality: `quality` on <Picture> applies to
    // EVERY format it emits, so it would drag the WebP fallback down with it.
    //
    // AVIF q60 was chosen by measurement, not by feel. On the five largest
    // renditions, against the shipped WebP q80 baseline:
    //
    //   rendition                     webp q80   avif q50   avif q60   avif q70
    //   showcase-understory @1200      266,250    131,139    193,440    266,463
    //   orchard/showcase-main @1200    237,366    115,366    169,245    234,683
    //   wireframe-background @1536     222,478    135,690    192,383    250,576
    //   fruit-tree-production @800     221,508    104,945    151,152    208,283
    //   perennial-crops @800           218,816    102,376    147,472    203,295
    //
    // q70 is pointless (1-6% off WebP, and it re-inflates wireframe-background
    // to 250,576 B against a 217,476 B source). q50 is visibly mushy: at 3x
    // magnification the leaf litter in showcase-understory loses individual
    // leaf edges. q60 is indistinguishable from the shipped WebP at 1:1 on
    // photographs — and every rendition on this site is displayed downscaled
    // from its ladder step — while cutting the corpus by ~28%.
    //
    // Chroma subsampling is deliberately left at sharp's 4:4:4 default.
    // '4:2:0' buys a further ~5% and encodes ~20% faster, but it visibly
    // desaturates the fine magenta micro-text in 3d-lab/wireframe-background;
    // 5% is not worth a format that damages one of the assets.
    //
    // `effort` is left at sharp's default 4: measured at q60, effort 6 and 7
    // cost 2.5-3.5x the encode time for no byte saving at all (understory
    // 193,440 B at e4 vs 195,350 B at e6).
    service: {
      entrypoint: 'astro/assets/services/sharp',
      config: {
        avif: { quality: 60 },
      },
    },
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
      // `build.inlineStylesheets: 'auto'` (Astro's default) inlines a style
      // chunk only while it stays under this limit, so the default 4096 is a
      // cliff: the largest chunk here measured 4,059 B, and ~37 B of new CSS
      // in those components would silently convert an inlined block into a
      // third render-blocking <link>. Neither side of that cliff is wrong —
      // inline costs bytes on every HTML fetch, external buys a year of
      // caching — but flipping between them as a side effect of an unrelated
      // style edit is. Raising the limit keeps the choice deliberate.
      //
      // This changes nothing today: every emitted CSS chunk is either far
      // below it (11 inline blocks, largest 4,059 B) or far above it (17-41 kB
      // route bundles, already external), and no font or image asset is under
      // 8 KB, so nothing new gets base64-inlined either.
      assetsInlineLimit: 8192,
    },
  },
});
