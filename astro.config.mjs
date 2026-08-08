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
  // Prefetch cross-page links when they enter the viewport — this is a
  // 6-page MPA with ~11-19 KB gz HTML per page, so speculative fetches are
  // cheap and make navigations near-instant.
  prefetch: {
    prefetchAll: true,
    defaultStrategy: 'viewport',
  },
  build: {
    // Custom asset directory (default is '_astro').
    assets: '_assets',
  },
  fonts: [
    googleFont('Outfit', '--font-outfit', ['100 900']),
    googleFont('Open Sans', '--font-open-sans', ['300 800']),
    googleFont('Inter', '--font-inter', ['100 900']),
    googleFont('Rajdhani', '--font-rajdhani', [300, 400, 500, 600, 700]),
    googleFont('Space Grotesk', '--font-space-grotesk', ['300 700']),
    googleFont('DM Sans', '--font-dm-sans', ['100 1000']),
    googleFont('Sora', '--font-sora', ['100 800']),
    googleFont('Nunito', '--font-nunito', ['200 1000']),
    googleFont('Quicksand', '--font-quicksand', ['300 700']),
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
