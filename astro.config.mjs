import { defineConfig } from 'astro/config';
import svelte from '@astrojs/svelte';
import compress from 'astro-compress';

// https://astro.build/config
export default defineConfig({
  integrations: [
    svelte(),
    compress({
      CSS: true,
      HTML: {
        removeAttributeQuotes: false,
        removeComments: true,
      },
      Image: false, // We'll handle images separately with Sharp
      JavaScript: true,
      SVG: true,
    }),
  ],
  output: 'static',
  build: {
    inlineStylesheets: 'auto',
    assets: '_assets',
  },
  vite: {
    build: {
      cssCodeSplit: false,
      rollupOptions: {
        output: {
          manualChunks: {
            'svelte-runtime': ['svelte', 'svelte/internal'],
          },
        },
      },
      minify: 'terser',
      terserOptions: {
        compress: {
          drop_console: true,
          passes: 2,
        },
      },
    },
    css: {
      devSourcemap: true,
    },
  },
});
